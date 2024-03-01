import { Logger } from "tslog";
import { SYNQLITE_BATCH_SIZE, SYNQLITE_PREFIX } from "./constants.js";
import { SynQLite } from "./synqlite.class.js";
import { SynQLiteOptions } from "./types.js";

const setupDatabase = ({
  filename,
  sqlite3,
  prefix = SYNQLITE_PREFIX,
  tables,
  batchSize = SYNQLITE_BATCH_SIZE,
  preInit,
  postInit,
  logOptions,
  debug,
}: SynQLiteOptions) => {

  if (!tables?.length) throw new Error('Syncable table data required');

  const log = new Logger({ name: 'synqlite-setup', ...logOptions});
  const db = new SynQLite({
    filename,
    sqlite3,
    prefix,
    tables,
    batchSize,
    preInit,
    postInit,
    logOptions,
    debug,
  });

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

    db.setupTriggersForTable({ table });
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