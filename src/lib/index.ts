import { Logger } from "tslog";
import { TinySynq } from "./tinysynq.class.js";
import { TinySynqOptions, SyncableTable } from "./types.js";

/**
 * Returns a configured instance of TinySynq
 * 
 * @param config - Configuration object 
 * @returns TinySynq instance
 * 
 * @public
 */
const initTinySynq = (config: TinySynqOptions) => {
  const {
    tables,
    preInit,
    postInit,
    logOptions,
    debug,
  } = config;

  if (!tables?.length) throw new Error('Syncable table data required');

  const log = new Logger({ name: 'tinysync-setup', ...logOptions});
  const ts = new TinySynq(config);

  const getRecordMetaInsertQuery = ({table, remove = false}: {table: SyncableTable, remove?: boolean}) => {
    /* 
    This is kind of insane, but it works. A rundown of what's happening:
    - We're creating a trigger after a row operation (the easy part)
    - Aside from recording the changes, we also need to add record-specific metadata:
      - table name and row identifier,
      - the number of times the record has been touched (including creation)
      - the map of all changes across all devices — a Vector Clock (JSON format)
      - the source of this change
    - Getting the vector clock is tricky, partly because of SQLite limitations
      (no variables, control structures), and partly because it's possible that
      no meta exists for the record.
    - To work around this we do a select to get the meta, but perform a union with
      another select that just selects insert values.
    - Included in both selects is a 'peg' which we use to sort the UNIONed rows to 
      ensure that if a valid row exists, it's the first row returned.
    - Now we select from this union and limit to 1 result. If a record exists
      then we get that record. If not, we get the values ready for insertion.
    - Finally, if there's a conflict on PRIMAY KEY or UNIQUE contraints, we update
      only the relevant columns.
    */
    const version = remove ? 'OLD' : 'NEW';
    const sql = `
    INSERT INTO ${ts.synqPrefix}_record_meta (table_name, row_id, source, mod, vclock)
    SELECT table_name, row_id, source, mod, vclock
    FROM (
      SELECT
        1 as peg,
        '${table.name}' as table_name,
        ${version}.${table.id} as row_id,
        '${ts.deviceId}' as source, 
        IFNULL(json_extract(vclock,'$.${ts.deviceId}'), 0) + 1 as mod, 
        json_set(IFNULL(json_extract(vclock, '$'),'{}'), '$.${ts.deviceId}', IFNULL(json_extract(vclock,'$.${ts.deviceId}'), 0) + 1) as vclock
      FROM ${ts.synqPrefix}_record_meta
      WHERE table_name = '${table.name}'
      AND row_id = ${version}.${table.id}
      UNION
      SELECT 0 as peg, '${table.name}' as table_name, ${version}.${table.id} as row_id, '${ts.deviceId}' as source, 1 as mod, json_object('${ts.deviceId}', 1) as vclock
    )
    ORDER BY peg DESC
    LIMIT 1
    ON CONFLICT DO UPDATE SET
      source = '${ts.deviceId}',
      mod = json_extract(excluded.vclock,'$.${ts.deviceId}'),
      vclock = json_extract(excluded.vclock,'$'),
      modified = '${ts.utils.utcNowAsISO8601().replace('Z', '')}'
    ;`;

    return sql;
  }

  const getChangeUpdateQuery = ({table, remove = false}: {table: SyncableTable, remove?: boolean}) => {
    const version = remove ? 'OLD' : 'NEW';
    const sql = `
      UPDATE ${ts.synqPrefix}_changes
      SET vclock = trm.vclock, source = trm.source
      FROM (
        SELECT vclock, source
        FROM ${ts.synqPrefix}_record_meta
        WHERE table_name = '${table.name}'
        AND row_id = ${version}.${table.id}
      ) AS trm
      WHERE id IN (
        SELECT id FROM ${ts.synqPrefix}_changes
        WHERE table_name = '${table.name}'
        AND row_id = ${version}.${table.id}
        ORDER by id desc
        LIMIT 1
      );
    `;
    return sql;
  }

  const setupTriggersForTable = ({ table }: { table: SyncableTable }) => {
    log.debug('Setting up triggers for', table.name);

    // Template for inserting the new value as JSON in the `*_changes` table.
    const jsonObject = (ts.runQuery<any>({
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
    ts.run({sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_after_insert_${table.name}`});
    ts.run({sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_after_update_${table.name}`});
    ts.run({sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_after_delete_${table.name}`});

    const insertTriggerSql = `
      CREATE TRIGGER IF NOT EXISTS ${ts.synqPrefix}_after_insert_${table.name}
      AFTER INSERT ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${ts.synqPrefix}_meta WHERE meta_name = 'triggers_on')='1'
      BEGIN
        INSERT INTO ${ts.synqPrefix}_changes (table_name, row_id, operation, data)
        VALUES ('${table.name}', NEW.${table.id}, 'INSERT', ${jsonObject.jo});

        ${getRecordMetaInsertQuery({table})}

        ${getChangeUpdateQuery({table})}
      END;`
    ts.run({sql: insertTriggerSql});

    const updateTriggerSql = `
      CREATE TRIGGER IF NOT EXISTS ${ts.synqPrefix}_after_update_${table.name}
      AFTER UPDATE ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${ts.synqPrefix}_meta WHERE meta_name = 'triggers_on')='1'
      BEGIN
        INSERT INTO ${ts.synqPrefix}_changes (table_name, row_id, operation, data)
        VALUES ('${table.name}', NEW.${table.id}, 'UPDATE', ${jsonObject.jo});

        ${getRecordMetaInsertQuery({table})}

        ${getChangeUpdateQuery({table})}

      END;`
    ts.run({sql: updateTriggerSql});

    const deleteTriggerSql = `
      CREATE TRIGGER IF NOT EXISTS ${ts.synqPrefix}_after_delete_${table.name}
      AFTER DELETE ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${ts.synqPrefix}_meta WHERE meta_name = 'triggers_on')='1'
      BEGIN
        INSERT INTO ${ts.synqPrefix}_changes (table_name, row_id, operation) VALUES ('${table.name}', OLD.${table.id}, 'DELETE');
        
        ${getRecordMetaInsertQuery({table, remove: true})}

        ${getChangeUpdateQuery({table, remove: true})}
      END;`
    ts.run({sql: deleteTriggerSql});

    /**
     * All the triggers below will only be executed if `meta_name="debug_on"`
     * has the `meta_value=1` in the *_meta table, regardless of `triggers_on`.
     */

    // Remove previous versions
    ts.run({sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_dump_after_insert_${table.name}`});
    ts.run({sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_dump_after_update_${table.name}`});
    ts.run({sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_dump_after_delete_${table.name}`});
    ts.run({sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_dump_before_insert_record_meta`});
    ts.run({sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_dump_after_insert_record_meta`});
    ts.run({sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_dump_after_update_record_meta`});

    /**
     * @Debugging Do not remove
     * These triggers allow a rudimentary tracing of DB actions on the synced tables.
     */
    ts.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${ts.synqPrefix}_dump_after_insert_${table.name}
      AFTER INSERT ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${ts.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${ts.synqPrefix}_dump (table_name, operation, data)
        VALUES ('${table.name}', 'INSERT', ${jsonObject.jo});
      END;`
    });

    ts.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${ts.synqPrefix}_dump_after_update_${table.name}
      AFTER UPDATE ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${ts.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${ts.synqPrefix}_dump (table_name, operation, data) VALUES ('${table.name}', 'UPDATE', ${jsonObject.jo});
      END;`
    });

    const oldJsonObject = jsonObject.jo.replace(/NEW/g, 'OLD');
    
    ts.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${ts.synqPrefix}_dump_after_delete_${table.name}
      AFTER DELETE ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${ts.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${ts.synqPrefix}_dump (table_name, operation, data) VALUES ('${table.name}', 'DELETE', ${oldJsonObject});
      END;`
    });

    /**
     * @Debugging Do not remove
     * These triggers allow comparison record meta before and after insert.
     */

    ts.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${ts.synqPrefix}_dump_before_insert_record_meta
      BEFORE INSERT ON ${ts.synqPrefix}_record_meta
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${ts.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${ts.synqPrefix}_dump (table_name, operation, data)
        VALUES (NEW.table_name, 'BEFORE_INSERT', json_object('table_name', NEW.table_name, 'row_id', NEW.row_id, 'mod', NEW.mod, 'vclock', NEW.vclock));
      END;`
    });

    ts.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${ts.synqPrefix}_dump_after_insert_record_meta
      AFTER INSERT ON ${ts.synqPrefix}_record_meta
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${ts.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${ts.synqPrefix}_dump (table_name, operation, data)
        VALUES ('${table.name}', 'AFTER_INSERT', json_object('table_name', NEW.table_name, 'row_id', NEW.row_id, 'mod', NEW.mod, 'vclock', NEW.vclock));
      END;`
    });

    ts.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${ts.synqPrefix}_dump_after_update_record_meta
      AFTER UPDATE ON ${ts.synqPrefix}_record_meta
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${ts.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${ts.synqPrefix}_dump (table_name, operation, data)
        VALUES ('${table.name}', 'AFTER_UPDATE', json_object('table_name', NEW.table_name, 'row_id', NEW.row_id, 'mod', NEW.mod, 'vclock', NEW.vclock));
      END;`
    });

    /* END OF DEBUG TRIGGERS */
  }

  // Create a change-tracking table and index
  ts.run({
    sql:`
    CREATE TABLE IF NOT EXISTS ${ts.synqPrefix}_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      data BLOB,
      operation TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
      source TEXT,
      vclock BLOB,
      modified TIMESTAMP DATETIME DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f','NOW'))
    );`
  });
  
  ts.run({
    sql:`CREATE INDEX IF NOT EXISTS ${ts.synqPrefix}_change_modified_idx ON ${ts.synqPrefix}_changes(modified)`
  });
  ts.run({
    sql:`CREATE INDEX IF NOT EXISTS ${ts.synqPrefix}_change_table_row_idx ON ${ts.synqPrefix}_changes(table_name, row_id)`
  });

  // Change *_pending is essentially a clone of *_changes used to hold items that
  // cannot be applied yet because intermediate/preceding changes haven't been received.
  ts.run({
    sql:`
    CREATE TABLE IF NOT EXISTS ${ts.synqPrefix}_pending (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      data BLOB,
      operation TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE',
      source TEXT NOT NULL,
      vclock BLOB NOT NULL,
      modified TIMESTAMP DATETIME DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f','NOW'))
    );`
  });
  
  ts.run({
    sql:`CREATE INDEX IF NOT EXISTS ${ts.synqPrefix}_pending_table_row_idx ON ${ts.synqPrefix}_pending(table_name, row_id)`
  });

  // Create a notice table
  ts.run({
    sql:`
    CREATE TABLE IF NOT EXISTS ${ts.synqPrefix}_notice (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      conflict BLOB,
      message TEXT NOT NULL,
      created TIMESTAMP DATETIME DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f','NOW'))
    );`
  }); 

  // Create record meta table and index
  ts.run({
    sql:`
    CREATE TABLE IF NOT EXISTS ${ts.synqPrefix}_record_meta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      mod INTEGER NOT NULL,
      source TEXT NOT NULL,
      vclock BLOB,
      modified TIMESTAMP DATETIME DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f','NOW'))
    );`
  });

  ts.run({
    sql:`CREATE UNIQUE INDEX IF NOT EXISTS ${ts.synqPrefix}_record_meta_idx ON ${ts.synqPrefix}_record_meta(table_name, row_id)`
  });
  // @TODO: These may actually need to be compound indexes; need to evaluate queries.
  ts.run({
    sql:`CREATE INDEX IF NOT EXISTS ${ts.synqPrefix}_record_meta_source_idx ON ${ts.synqPrefix}_record_meta(source)`
  });
  ts.run({
    sql:`CREATE INDEX IF NOT EXISTS ${ts.synqPrefix}_record_meta_modified_idx ON ${ts.synqPrefix}_record_meta(modified)`
  });

  // Create meta table
  ts.run({
    sql:`
    CREATE TABLE IF NOT EXISTS ${ts.synqPrefix}_meta (
      meta_name TEXT NOT NULL PRIMARY KEY,
      meta_value TEXT NOT NULL
    );
  `});

  ts.run({
    sql: `
    CREATE TABLE IF NOT EXISTS ${ts.synqPrefix}_dump (
      created TIMESTAMP DATETIME DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), 
      table_name TEXT NOT NULL,
      operation TEXT,
      data BLOB
    );
  `});

  ts.run({
    sql: `CREATE INDEX IF NOT EXISTS ${ts.synqPrefix}_meta_name_idx ON ${ts.synqPrefix}_meta(meta_name)`
  });
  
  // Enable debug mode
  if (debug) ts.enableDebug();

  // Set the device ID
  ts.setDeviceId();

  // Run pre-initialisation queries
  if (preInit?.length) {
    for (const preInitQuery of preInit) {
      try {
        log.debug(`\n@@@ preInit\n${preInitQuery}\n@@@`)
        ts.run({
          sql: preInitQuery
        });
      }
      catch(err) {
        log.error('@preInit', err)
      }
    }
  }

  log.debug(`@${ts.synqPrefix}_meta`, ts.runQuery({sql:`SELECT * FROM pragma_table_info('${ts.synqPrefix}_meta')`}));
  log.debug(`@SIMPLE_SELECT`, ts.runQuery({sql:`SELECT '@@@ that was easy @@@'`}));

  for (const table of tables) {
    // Check table exists
    const exists = ts.runQuery<Record<string, any>>({
      sql: `SELECT * FROM pragma_table_info('${table.name}')`
    });
    if (!exists?.length) throw new Error(`${table.name} doesn't exist`);
    
    log.debug('Setting up', table.name, table.id);

    setupTriggersForTable({ table });
    ts.tablesReady();
  }

  if (postInit?.length) {
    for (const postInitQuery of postInit) {
      log.warn(`@@@\npostInit\n${postInitQuery}\n@@@`)
      const result = ts.run({
        sql: postInitQuery
      });
      log.trace(`@@@ postInit RESULT\n`, result);
    }
  }

  return ts;
};

export default initTinySynq;