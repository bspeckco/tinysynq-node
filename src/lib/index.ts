import DB from 'better-sqlite3';
import type { Database } from 'better-sqlite3';
import { SYNQLITE_BATCH_SIZE, SYNQLITE_PREFIX } from './constants.js';
import pino from 'pino';

export type SyncableTable = {
  name: string;
  id: string;
}

export type SynQLiteOptions = {
  database: string;
  prefix: string;
  tables: SyncableTable[];
  batchSize?: number;
  options?: DB.Options;
}

export type SynqlDatabase = Database & {
  synqPrefix?: string;
  synqTables?: SyncableTable[];
  synqBatchSize: number;
  utils: {
    utcNowAsISO8601: () => string;
    strtimeAsISO8601: string;
  }
}

const utcNowAsISO8601 = (): string => {
  return new Date((new Date()).toUTCString()).toISOString();
}

const strtimeAsISO8601 = `STRFTIME('%Y-%m-%dT%H:%M:%f','NOW')`;

const setupDatabase = ({
  database,
  prefix = SYNQLITE_PREFIX,
  tables,
  batchSize = SYNQLITE_BATCH_SIZE,
  options
}: SynQLiteOptions) => {
  /*
  @TODO:
   - check if DB path exists (throw if not)
   - check if table names have been provided (throw if not)
   - check if table names exist (throw if not)
  */
  const db = new DB(database, options) as SynqlDatabase;
  prefix = prefix?.trim().replace(/[^a-z0-9]+$/i, '');

  console.log({prefix, batchSize})
  db.synqPrefix = prefix;
  db.synqTables = tables;
  db.synqBatchSize = batchSize;
  db.utils = {
    utcNowAsISO8601,
    strtimeAsISO8601
  }

  // Add a 'last_modified' column to each table you want to sync, if not already present.
  // Example for a table named 'items':
  // db.exec('ALTER TABLE items ADD COLUMN last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL');

  // Create a change-tracking table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ${prefix}_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      data BLOB,
      operation TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
      modified_at TIMESTAMP DATETIME DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f','NOW'))
    );`).run()
    
  // Create the index
  db.prepare(`CREATE INDEX IF NOT EXISTS ${prefix}_change_modified_idx ON ${prefix}_changes(modified_at)`).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS ${prefix}_meta (
      meta_name TEXT NOT NULL PRIMARY KEY,
      meta_value TEXT NOT NULL
    );
  `).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS ${prefix}_meta_name_idx ON ${prefix}_meta(meta_name)`).run();

  for (const table of tables) {
    console.debug('Setting up', table.name, table.id);
    const jsonObject = db.prepare(`
      SELECT 'json_object(' || GROUP_CONCAT('''' || name || ''', NEW.' || name, ',') || ')' AS jo
      FROM pragma_table_info('${table.name}');
    `).get() as any;
    console.log(jsonObject, jsonObject.jo)
    const sql = `
      CREATE TRIGGER IF NOT EXISTS ${prefix}_after_insert_${table.name}
      AFTER INSERT ON ${table.name}
      FOR EACH ROW
      BEGIN
        INSERT INTO ${prefix}_changes (table_name, row_id, operation, data)
        VALUES ('${table.name}', NEW.${table.id}, 'INSERT', ${jsonObject.jo});
      END;`
      console.log(sql)
    db.prepare(sql).run();

    db.prepare(`
      CREATE TRIGGER IF NOT EXISTS ${prefix}_after_update_${table.name}
      AFTER UPDATE ON ${table.name}
      FOR EACH ROW
      BEGIN
        INSERT INTO ${prefix}_changes (table_name, row_id, operation, data)
        VALUES ('${table.name}', NEW.${table.id}, 'UPDATE', ${jsonObject.jo});
      END;
    `).run();

    db.prepare(`
      CREATE TRIGGER IF NOT EXISTS ${prefix}_after_delete_${table.name}
      AFTER DELETE ON ${table.name}
      FOR EACH ROW
      BEGIN
        INSERT INTO ${prefix}_changes (table_name, row_id, operation) VALUES ('${table.name}', OLD.${table.id}, 'DELETE');
      END;
    `).run();
  }

  return db;
};

interface SyncItem {
  id: number;
  last_modified: string; // Use a suitable timestamp or versioning format
}

export type Change = {
  id: number;
  table_name: string;
  row_id: string;
  operation: string;
  data: string; // JSON string
  modified_at: string;
}

const resolveConflicts = (localItem: SyncItem, remoteItem: SyncItem) => {
  // @TODO: come back to this conflict resolution (based on last_modified timestamps)
  return new Date(localItem.last_modified) >= new Date(remoteItem.last_modified) ? localItem : remoteItem;
};

const getLastSync = (db: SynqlDatabase) => {
  return db.prepare(`
    SELECT * FROM ${db.synqPrefix}_meta
    WHERE meta_name = 'last_local_sync'`
  ).get();
}

const getChangesSinceLastSync = (db: SynqlDatabase, lastSync?: string) => {
  const record: any = getLastSync(db)
  console.debug('@getChangesSinceLastSync', record);

  let where: string = '';

  if (record) {
    where = 'WHERE modified_at > ?'
  }
  const sql = `
  SELECT * FROM ${db.synqPrefix}_changes
    ${where}
    ORDER BY modified_at ASC
  `;
  console.log(sql)
  const stmt = db.prepare(sql);

  return (record ? stmt.all(record.last_local_sync) : stmt.all()) as Change[];
};

const applyChangesToLocalDB = (db: SynqlDatabase, changes: Change[]) => {
  // Split changes into batches
  for (let i = 0; i < changes.length; i += db.synqBatchSize) {
    const batch = changes.slice(i, i + db.synqBatchSize);

    // Apply each batch within a transaction
    try {
      db.transaction(() => {
        batch.forEach(change => {
          try {
            const table = db.synqTables?.find(t => t.name === change.table_name);
            let recordData: any;
            if (change.data) {
              try {
                recordData = JSON.parse(change.data);
              }
              catch(err) {
                console.debug(change);
                throw new Error('Invalid data for insert or update');
              }
            }
              
            if (!table) throw new Error(`Unable to find table ${change.table_name}`);
            switch(change.operation) {
              case 'UPDATE':
                const columnsToUpdate = Object.keys(recordData).map(key => `${key} = :${key}`).join(', ');
                const updateValues = { ...recordData, [table.id]: change.row_id};
                const updateSql = `UPDATE ${change.table_name} SET ${columnsToUpdate} WHERE ${table.id} = :${table.id}`;
                // console.debug('@performing update... sql:', updateSql, updateValues);
                db.prepare(updateSql).run(updateValues);
                break;
              case 'INSERT':
                const columnsToInsert = Object.keys(recordData).join(',');
                const insertPlaceholders = Object.keys(recordData).map(k => `:${k}`).join(',')
                const insertSql = `INSERT OR REPLACE INTO ${change.table_name} (${columnsToInsert}) VALUES (${insertPlaceholders});`;
                // console.debug('@performing insert... sql:', insertSql, recordData);
                db.prepare(insertSql).run(recordData);
                break;
              case 'DELETE':
                db.prepare(`DELETE FROM ${change.table_name} WHERE ${table.id} = ?`).run(change.row_id);
                break;
            }

            db.prepare(
              `INSERT OR REPLACE INTO ${db.synqPrefix}_meta (meta_name, meta_value) VALUES('last_local_sync', STRFTIME('%Y-%m-%d %H:%M:%f','NOW'))`,
            ).run();
          } catch (error) {
            console.error(`Error applying change: ${error}`);
            throw error; // Throw the error to trigger rollback
          }
        });
      })();
    } catch (error) {
      console.error(`Transaction failed, changes rolled back: ${error}`);
      // Handle transaction failure (e.g., log, retry logic, notification)
    }
  }
};


const purgeOldChanges = (db: Database, days: number) => {
  const purgeBeforeDate = new Date();
  purgeBeforeDate.setDate(purgeBeforeDate.getDate() - days);

  db.prepare(`
    DELETE FROM changes
    WHERE modified_at < ?
  `).run(purgeBeforeDate.toISOString());
};

const SynQLite = {
  applyChangesToLocalDB,
  getChangesSinceLastSync,
  getLastSync,
  setupDatabase,
  utils: {
    nowAsISO8601: `STRFTIME('%Y-%m-%dY%H:%M:%f','NOW')`,
    utcNowAsISO8601,
  }
}

export default SynQLite;