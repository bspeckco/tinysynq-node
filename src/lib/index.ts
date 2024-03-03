import { Logger } from "tslog";
import { SynQLite } from "./synqlite.class.js";
import { SynQLiteOptions, SyncableTable } from "./types.js";

/**
 * Returns a configured instance of SynQLite
 * 
 * @param config - Configuration object 
 * @returns SynQLite instance
 * 
 * @public
 */
const setupDatabase = (config: SynQLiteOptions) => {
  const {
    tables,
    preInit,
    postInit,
    logOptions,
    debug,
  } = config;

  if (!tables?.length) throw new Error('Syncable table data required');

  const log = new Logger({ name: 'synqlite-setup', ...logOptions});
  const db = new SynQLite(config);

  const getRecordMetaInsertQuery = ({table, remove = false}: {table: SyncableTable, remove?: boolean}) => {
    /* 
    db.is kind of insane, but it works. A rundown of what's happening:
    - We're creating a trigger after a deletion (the easy part)
    - Aside from recording the changes, we also need to add record-specific metadata:
      - table name and row identifier,
      - the number of times the record has been touched (including creation)
      - the map of all changes across all devices — a Vector Clock (JSON format)
    - Getting the vector clock is tricky, partly because of SQLite limitations
      (no variables, control structures), and partly because it's possible that
      no meta exists for the record.
    - To work around db.we do a select to get the meta, but perform a union with
      another select that just selects insert values.
    - Included in both selects is
      a 'peg' which we use to sort the UNIONed rows to ensure that if a valid row
      exists, it's the first row returned.
    - Now we select from db.union and limit to 1 result. If a record exists
      then we get that record. If not, we get the values ready for insertion.
    - Finally, if there's a conflict on PRIMAY KEY or UNIQUE contraints, we update
      only the columns configured as editable.
    */
    const version = remove ? 'OLD' : 'NEW';
    const sql = `
    INSERT INTO ${db.synqPrefix}_record_meta (table_name, row_id, mod, vclock)
    SELECT table_name, row_id, mod, vclock
    FROM (
      SELECT
        1 as peg,
        '${table.name}' as table_name,
        ${version}.${table.id} as row_id, 
        IFNULL(json_extract(vclock,'$.${db.deviceId}'), 0) + 1 as mod, 
        json_set(IFNULL(json_extract(vclock, '$'),'{}'), '$.${db.deviceId}', IFNULL(json_extract(vclock,'$.${db.deviceId}'), 0) + 1) as vclock
      FROM ${db.synqPrefix}_record_meta
      WHERE table_name = '${table.name}'
      AND row_id = ${version}.${table.id}
      UNION
      SELECT 0 as peg, '${table.name}' as table_name, ${version}.${table.id} as row_id, 1, json_object('${db.deviceId}', 1) as vclock
    )
    ORDER BY peg DESC
    LIMIT 1
    ON CONFLICT DO UPDATE SET
      mod = json_extract(excluded.vclock,'$.${db.deviceId}'),
      vclock = json_extract(excluded.vclock,'$')
    ;`;
    log.silly(sql);
    return sql;
  }

  const setupTriggersForTable = ({ table }: { table: SyncableTable }) => {
    log.debug('Setting up triggers for', table.name);

    // Template for inserting the new value as JSON in the `*_changes` table.
    const jsonObject = (db.runQuery<any>({
      sql:`
      SELECT 'json_object(' || GROUP_CONCAT('''' || name || ''', NEW.' || name, ',') || ')' AS jo
      FROM pragma_table_info('${table.name}');`
    }))[0];
    log.silly('@jsonObject', JSON.stringify(jsonObject, null, 2));

    /**
     * These triggers run for changes originating locally. They are disabled
     * when remote changes are being applied (`triggers_on` in `*_meta` table).
     */

    // Ensure triggers are up to date
    db.run({sql: `DROP TRIGGER IF EXISTS ${db.synqPrefix}_after_insert_${table.name}`});
    db.run({sql: `DROP TRIGGER IF EXISTS ${db.synqPrefix}_after_update_${table.name}`});
    db.run({sql: `DROP TRIGGER IF EXISTS ${db.synqPrefix}_after_delete_${table.name}`});

    const sql = `
      CREATE TRIGGER IF NOT EXISTS ${db.synqPrefix}_after_insert_${table.name}
      AFTER INSERT ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${db.synqPrefix}_meta WHERE meta_name = 'triggers_on')='1'
      BEGIN
        INSERT INTO ${db.synqPrefix}_changes (table_name, row_id, operation, data)
        VALUES ('${table.name}', NEW.${table.id}, 'INSERT', ${jsonObject.jo});

        ${getRecordMetaInsertQuery({table})}
      END;`
    db.run({sql});

    db.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${db.synqPrefix}_after_update_${table.name}
      AFTER UPDATE ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${db.synqPrefix}_meta WHERE meta_name = 'triggers_on')='1'
      BEGIN
        INSERT INTO ${db.synqPrefix}_changes (table_name, row_id, operation, data)
        VALUES ('${table.name}', NEW.${table.id}, 'UPDATE', ${jsonObject.jo});

        ${getRecordMetaInsertQuery({table})}
      END;`
    });

    db.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${db.synqPrefix}_after_delete_${table.name}
      AFTER DELETE ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${db.synqPrefix}_meta WHERE meta_name = 'triggers_on')='1'
      BEGIN
        INSERT INTO ${db.synqPrefix}_changes (table_name, row_id, operation) VALUES ('${table.name}', OLD.${table.id}, 'DELETE');
        
        ${getRecordMetaInsertQuery({table, remove: true})}
      END;`
    });

    /**
     * All the triggers below will only be executed if `meta_name="debug_on"`
     * has the `meta_value=1` in the *_meta table, regardless of `triggers_on`.
     */

    // Remove previous versions
    db.run({sql: `DROP TRIGGER IF EXISTS ${db.synqPrefix}_dump_after_insert_${table.name}`});
    db.run({sql: `DROP TRIGGER IF EXISTS ${db.synqPrefix}_dump_after_update_${table.name}`});
    db.run({sql: `DROP TRIGGER IF EXISTS ${db.synqPrefix}_dump_after_delete_${table.name}`});
    db.run({sql: `DROP TRIGGER IF EXISTS ${db.synqPrefix}_dump_before_insert_record_meta`});
    db.run({sql: `DROP TRIGGER IF EXISTS ${db.synqPrefix}_dump_after_insert_record_meta`});
    db.run({sql: `DROP TRIGGER IF EXISTS ${db.synqPrefix}_dump_after_update_record_meta`});

    /**
     * @Debugging Do not remove
     * These triggers allow a rudimentary tracing of DB actions on the synced tables.
     */
    db.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${db.synqPrefix}_dump_after_insert_${table.name}
      AFTER INSERT ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${db.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${db.synqPrefix}_dump (table_name, operation, data)
        VALUES ('${table.name}', 'INSERT', ${jsonObject.jo});
      END;`
    });

    db.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${db.synqPrefix}_dump_after_update_${table.name}
      AFTER UPDATE ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${db.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${db.synqPrefix}_dump (table_name, operation, data) VALUES ('${table.name}', 'UPDATE', ${jsonObject.jo});
      END;`
    });

    const oldJsonObject = jsonObject.jo.replace(/NEW/g, 'OLD');
    
    db.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${db.synqPrefix}_dump_after_delete_${table.name}
      AFTER DELETE ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${db.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${db.synqPrefix}_dump (table_name, operation, data) VALUES ('${table.name}', 'DELETE', ${oldJsonObject});
      END;`
    });

    /**
     * @Debugging Do not remove
     * These triggers allow comparison record meta before and after insert.
     */

    db.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${db.synqPrefix}_dump_before_insert_record_meta
      BEFORE INSERT ON ${db.synqPrefix}_record_meta
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${db.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${db.synqPrefix}_dump (table_name, operation, data)
        VALUES (NEW.table_name, 'BEFORE_INSERT', json_object('table_name', NEW.table_name, 'row_id', NEW.row_id, 'mod', NEW.mod, 'vclock', NEW.vclock));
      END;`
    });

    db.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${db.synqPrefix}_dump_after_insert_record_meta
      AFTER INSERT ON ${db.synqPrefix}_record_meta
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${db.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${db.synqPrefix}_dump (table_name, operation, data)
        VALUES ('${table.name}', 'AFTER_INSERT', json_object('table_name', NEW.table_name, 'row_id', NEW.row_id, 'mod', NEW.mod, 'vclock', NEW.vclock));
      END;`
    });

    db.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${db.synqPrefix}_dump_after_update_record_meta
      AFTER UPDATE ON ${db.synqPrefix}_record_meta
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${db.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${db.synqPrefix}_dump (table_name, operation, data)
        VALUES ('${table.name}', 'AFTER_UPDATE', json_object('table_name', NEW.table_name, 'row_id', NEW.row_id, 'mod', NEW.mod, 'vclock', NEW.vclock));
      END;`
    });

    /* END OF DEBUG TRIGGERS */
  }

  // Create a change-tracking table and index
  db.run({
    sql:`
    CREATE TABLE IF NOT EXISTS ${db.synqPrefix}_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      data BLOB,
      operation TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
      modified TIMESTAMP DATETIME DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f','NOW'))
    );`
  });
  
  db.run({
    sql:`CREATE INDEX IF NOT EXISTS ${db.synqPrefix}_change_modified_idx ON ${db.synqPrefix}_changes(modified)`
  });

  // Change *_pending is essentially a clone of *_changes used to hold items that
  // cannot be applied yet because intermediate/preceding changes haven't been received.
  db.run({
    sql:`
    CREATE TABLE IF NOT EXISTS ${db.synqPrefix}_pending (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      data BLOB,
      operation TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE',
      vclock BLOB NOT NULL,
      modified TIMESTAMP DATETIME DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f','NOW'))
    );`
  });
  
  db.run({
    sql:`CREATE INDEX IF NOT EXISTS ${db.synqPrefix}_pending_table_row_idx ON ${db.synqPrefix}_pending(table_name, row_id)`
  });

  // Create a notice table
  db.run({
    sql:`
    CREATE TABLE IF NOT EXISTS ${db.synqPrefix}_notice (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      conflict BLOB,
      message TEXT NOT NULL,
      created TIMESTAMP DATETIME DEFAULT(STRFTIME('%Y-%m-%dT%H:%M:%f','NOW'))
    );`
  }); 

  // Create record meta table and index
  db.run({
    sql:`
    CREATE TABLE IF NOT EXISTS ${db.synqPrefix}_record_meta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      mod INTEGER,
      vclock BLOB,
      modified TIMESTAMP DATETIME DEFAULT(STRFTIME('%Y-%m-%dT%H:%M:%f','NOW'))
    );`
  });

  db.run({
    sql:`CREATE UNIQUE INDEX IF NOT EXISTS ${db.synqPrefix}_record_meta_idx ON ${db.synqPrefix}_record_meta(table_name, row_id)`
  });

  // Create meta table
  db.run({
    sql:`
    CREATE TABLE IF NOT EXISTS ${db.synqPrefix}_meta (
      meta_name TEXT NOT NULL PRIMARY KEY,
      meta_value TEXT NOT NULL
    );
  `});

  db.run({
    sql: `
    CREATE TABLE IF NOT EXISTS ${db.synqPrefix}_dump (
      created TIMESTAMP DATETIME DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), 
      table_name TEXT NOT NULL,
      operation TEXT,
      data BLOB
    );
  `});

  db.run({
    sql: `CREATE INDEX IF NOT EXISTS ${db.synqPrefix}_meta_name_idx ON ${db.synqPrefix}_meta(meta_name)`
  });
  
  // Enable debug mode
  if (debug) db.enableDebug();

  // Set the device ID
  db.setDeviceId();

  // Run pre-initialisation queries
  if (preInit?.length) {
    for (const preInitQuery of preInit) {
      log.debug(`\n@@@ preInit\n${preInitQuery}\n@@@`)
      db.run({
        sql: preInitQuery
      });
    }
  }

  log.debug(`@${db.synqPrefix}_meta`, db.runQuery({sql:`SELECT * FROM pragma_table_info('${db.synqPrefix}_meta')`}));
  log.debug(`@SIMPLE_SELECT`, db.runQuery({sql:`SELECT '@@@ that was easy @@@'`}));

  for (const table of tables) {
    // Check table exists
    const exists = db.runQuery<Record<string, any>>({
      sql: `SELECT * FROM pragma_table_info('${table.name}')`
    });
    log.debug('@exists?', table.name, exists);
    if (!exists?.length) throw new Error(`${table.name} doesn't exist`);
    
    log.debug('Setting up', table.name, table.id);

    setupTriggersForTable({ table });
    db.tablesReady();
  }

  if (postInit?.length) {
    for (const postInitQuery of postInit) {
      log.debug(`@@@\npostInit\n${postInitQuery}\n@@@`)
      db.run({
        sql: postInitQuery
      });
    }
  }

  return db;
};

export default setupDatabase;