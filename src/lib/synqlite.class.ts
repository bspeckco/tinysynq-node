import DB from 'better-sqlite3'
import { ApplyChangeParams, Change, LogLevel, SynQLiteOptions, SyncableTable, VClock } from './types.js';
import { Logger, ILogObj } from 'tslog';
import { nanoid } from 'nanoid';
import { VCompare } from './vcompare.class.js';

const log = new Logger({ name: 'synqlite-web-init', minLevel: LogLevel.Info });
const strtimeAsISO8601 = `STRFTIME('%Y-%m-%dT%H:%M:%f','NOW')`;

export class SynQLite {
  private _db: any;
  private _dbName: string;
  private _deviceId: string | undefined;
  private _synqDbId?: string;
  private _synqPrefix?: string;
  private _synqTables?: Record<string, SyncableTable>;
  private _synqBatchSize: number = 20;
  private _wal = true;
  private log: Logger<ILogObj>;

  utils = {
    strtimeAsISO8601,
    nowAsISO8601: strtimeAsISO8601,
    utcNowAsISO8601: (): string => {
      return new Date((new Date()).toUTCString()).toISOString();
    }
  }

  constructor(initData: SynQLiteOptions) {
    if (!initData.filename && !initData.sqlite3) {
      throw new Error('No DB filename or connection provided');
    }
    const _synqTables: Record<string, SyncableTable> = {};
    initData.tables.forEach(t => {
      _synqTables[t.name] = t;
    })
    this._dbName = initData.filename || '';
    this._db = initData.sqlite3 || undefined;
    this._synqPrefix = initData.prefix?.trim().replace(/[^a-z0-9]+$/i, '');
    this._synqTables = _synqTables;
    this._synqBatchSize = initData.batchSize || this._synqBatchSize;
    this._wal = initData.wal ?? false;
    this.log = new Logger({
      name: 'synqlite-node',
      minLevel: LogLevel.Debug,
      type: 'json',
      maskValuesOfKeys: ['password', 'encryption_key'],
      hideLogPositionForProduction: true,
      ...(initData.logOptions || {})
    });

    if (!this.db) {
      this._db = new DB(this.dbName);
      this.db.pragma('journal_mode = WAL');
    }
  }

  get db() {
    return this._db;
  }

  get dbName() {
    return this._dbName;
  }

  get deviceId() {
    return this._deviceId;
  }

  /**
   * Is retrieved from an existing DB, or 
   * generated and set if one isn't assigned yet.
   */
  get synqDbId() {
    return this._synqDbId;
  }

  get synqPrefix() {
    return this._synqPrefix;
  }

  get synqTables() {
    return this._synqTables;
  }

  get synqBatchSize() {
    return this._synqBatchSize;
  }

  get wal() {
    return this._wal;
  }

  getTableIdColumn({table}: {table: string}) {
    return this.synqTables![table]?.id as string;
  }

  setDeviceId() {
    // Set the device ID
    let existing: any;
    try {
      existing = this.runQuery<any[]>({
        sql: `SELECT meta_value FROM ${this.synqPrefix}_meta WHERE meta_name = 'device_id'`
      })[0];
    }
    catch(err) {
      this.log.warn(`Couldn't retrieve device ID`);
    }

    log.warn('@device_id', existing);
    if (!existing?.meta_value) {
      const res = this.runQuery<any[]>({
        sql: `INSERT OR REPLACE INTO ${this.synqPrefix}_meta (meta_name, meta_value) VALUES (?,?) RETURNING *`,
        values: ['device_id', nanoid(16)]
      });
      log.warn('@created record for device_id:', res);
      existing = res[0];
    }
    this._deviceId = existing?.meta_value;
  }

  runQuery<T = any>({sql, values}: {sql: string, values?: any}): T {
    const quid = Math.ceil(Math.random() * 1000000);
    this.log.debug('@runQuery', {quid, sql, values});
    try {
      const result = this.db.prepare(sql).all(values || []);
      this.log.debug({quid, result});
      return result;
    }
    catch(err: any) {
      this.log.error(quid, err);
      return err;
    }
  }

  run<T>({sql, values}: {sql: string, values?: any}): T {
    const quid = Math.ceil(Math.random() * 1000000);
    this.log.debug('@run', quid, sql, values, '/');
    try {
      const result = this.db.prepare(sql).run(values || []);
      this.log.debug({quid, result});
      return result;
    }
    catch(err: any) {
      this.log.error(quid, err);
      return err;
    }
  }

  runMany<T>({sql, values}: {sql: string, values: any[]}) {
    const quid = Math.ceil(Math.random() * 1000000);
    this.log.debug('@run', quid, sql, values, '/');
    try {
      const query = this.db.prepare(sql);
      for (const v of values) {
        query.run(v);
      }
      this.log.debug({quid, result: 'done'});
    }
    catch(err: any) {
      this.log.error(quid, err);
      return err;
    }
  }

  getDeviceId() {
    if (this._deviceId) return this._deviceId;
    const res = this.runQuery<any[]>({
      sql:`
        SELECT meta_value FROM ${this.synqPrefix}_meta
        WHERE meta_name = 'device_id'`
    });
    return res[0].meta_value;
  }

  getLastSync() {
    const res = this.runQuery<any[]>({
      sql:`
        SELECT meta_value FROM ${this.synqPrefix}_meta
        WHERE meta_name = 'last_local_sync'`
    });
    this.log.trace('@getLastSync', res[0]);
    return res[0]?.meta_value;
  }
  
  getChangesSinceLastSync(data?: {lastSync: string}): Change[] {
    let lastLocalSync: string = data?.lastSync || this.getLastSync();
    this.log.debug('@getChangesSinceLastSync', lastLocalSync);
  
    let where: string = '';
  
    if (lastLocalSync) {
      where = 'WHERE c.modified_at > ?'
    }
    const sql = `
      SELECT * FROM ${this._synqPrefix}_changes c
      INNER JOIN ${this._synqPrefix}_record_meta trm
      ON trm.table_name = c.table_name
      AND trm.row_id = c.row_id
      ${where}
      ORDER BY c.modified_at ASC
    `;
    console.log(sql)
    const values = lastLocalSync ? [lastLocalSync] : [];
    this.log.debug(sql, values);
  
    return this.runQuery<Change[]>({sql, values});
  };

  enableDebug() {
    return this.run({
      sql: `
      INSERT OR REPLACE INTO ${this.synqPrefix}_meta (meta_name, meta_value)
      VALUES ('debug_on', '1')
      RETURNING *;`
    });
  }

  disableDebug() {
    return this.run({
      sql: `
      INSERT OR REPLACE INTO ${this.synqPrefix}_meta (meta_name, meta_value)
      VALUES ('debug_on', '0')
      RETURNING *;`
    });
  }
  
  private enableTriggers() {
    return this.run({
      sql: `
      INSERT OR REPLACE INTO ${this.synqPrefix}_meta (meta_name, meta_value)
      VALUES ('triggers_on', '1');`
    });
  }

  private disableTriggers() {
    return this.run({
      sql: `
      INSERT OR REPLACE INTO ${this.synqPrefix}_meta (meta_name, meta_value)
      VALUES ('triggers_on', '0');`
    });
  }

  private beginTransaction(): string {
    const savepoint = `SP${Date.now()}`;
    const sql = `SAVEPOINT ${savepoint};`;
    this.run({sql});
    return savepoint;
  }

  private commitTransaction({savepoint}: {savepoint: string}) {
    const sql = `RELEASE SAVEPOINT ${savepoint};`;
    return this.run({sql});
  }

  private rollbackTransaction({savepoint}: {savepoint: string}) {
    const sql = `ROLLBACK TRANSACTION TO SAVEPOINT ${savepoint};`;
    return this.run({sql});
  }

  private getRecord({table_name, row_id}: {table_name: string, row_id: any}) {
    const idCol = this.getTableIdColumn({table: table_name});
    const sql = `SELECT * FROM ${table_name} WHERE ${idCol} = ?`;
    const res = this.runQuery({sql, values: [row_id]});
    this.log.debug('@getRecord', res);
    return res[0];
  }

  getById<T>({table_name, row_id}: {table_name: string, row_id: any}): T | any {
    return this.getRecord({table_name, row_id});
  }

  insertRecordMeta({change, vclock}: any) {
    this.log.silly('<<< @insertRecordMeta >>>', {change, vclock});
    const { table_name, row_id } = change;
    const mod = vclock[this._deviceId!] || 0;
    const values = {
      table_name,
      row_id,
      mod,
      vclock: JSON.stringify(vclock)
    };
    return this.runQuery({
      sql: `
      INSERT INTO ${this._synqPrefix}_record_meta (table_name, row_id, mod, vclock)
      VALUES (:table_name, :row_id, :mod, :vclock)
      ON CONFLICT DO UPDATE SET mod = :mod, vclock = :vclock
      RETURNING *
      `,
      values,
    });
  }

  getRecordMeta({table_name, row_id}: {table_name: string, row_id: string}) {
    const sql = `
    SELECT *
    FROM ${this.synqPrefix}_record_meta
    WHERE table_name = :table_name
    AND row_id = :row_id`;
    const res = this.db.prepare(sql).get({table_name, row_id});
    return res;
  }

  private validateChange(change: Change): { valid: boolean, reason: string, vclock: VClock } {
    let valid = true;
    let reason = '';
    const { table_name, row_id, vclock: remote = {} } = change;
    const record = this.getRecord({table_name, row_id});
    const meta = this.getRecordMeta({table_name, row_id});
    const local = JSON.parse(meta?.vclock || '{}');
    const localId = this.deviceId!;   

    let latest: VClock = {};

    // If we don't have the record, treat it as new
    if (!record || !local || !local[localId]) {
      latest = change.vclock;
    }
    // Handle all the other scenarios
    else {
      const localV = new VCompare({ local, remote, localId });
      const conflicted = localV.isConflicted({ remote });
      this.log.debug({conflicted});

      if (conflicted) {
        // @TODO: Last write wins
      }
      else {
        latest = localV.merge();
      }
    }
    
    return { valid, reason, vclock: latest };
  }

  createInsertFromObject({data, table}: { data: Record<string, any>, table: string }) {
    this.log.silly('@createInsert...', {data});
    const columnsToInsert = Object.keys(data).join(',');
    const editable = this._synqTables![table].editable;
    const updates = Object.keys(data)
      .filter(key => editable.includes(key))
      .map(k => `${k} = :${k}`)
      .join(',');
    
    if (!updates) throw new Error('No changes availble');
    const insertPlaceholders = Object.keys(data).map(k => `:${k}`).join(',');
    // This really needs to be an INSERT ... ON CONFLICT ...
    // To do so requires knowing the table columns beforehand AND
    // which ones are editable
    const insertSql = `
      INSERT INTO ${table} (${columnsToInsert})
      VALUES (${insertPlaceholders})
      ON CONFLICT DO UPDATE SET ${updates}
      RETURNING *;`;

    return insertSql;
  }

  private async applyChange({
    change,
    savepoint
  }: ApplyChangeParams) {
    try {
      const table = this.synqTables![change.table_name];
      let recordData: any;
      if (change.data) {
        try {
          recordData = JSON.parse(change.data);
        }
        catch(err) {
          this.log.debug(change);
          throw new Error('Invalid data for insert or update');
        }
      }

      // Check vector clock to determine if the change is valid
      const changeStatus = this.validateChange(change);
      if (!changeStatus.valid) {
        this.log.error(changeStatus);
        throw new Error(`Invalid change: ${changeStatus.reason}`)
      }
        
      if (!table) throw new Error(`Unable to find table ${change.table_name}`);
      this.log.silly('@applyChange', {change, table, changeStatus});
      switch(change.operation) {
        case 'INSERT':
        case 'UPDATE':
          const insertSql = this.createInsertFromObject({
            data: recordData,
            table: change.table_name
          })
          await this.run({sql: insertSql, values: recordData});
          break;
        case 'DELETE':
          const sql = `DELETE FROM ${change.table_name} WHERE ${table.id} = ?`;
          this.log.warn('>>> DELETE SQL <<<', sql, change.row_id);
          await this.run({sql, values: [change.row_id]});
          break;
      }

      const metaInsert = this.db.prepare(`INSERT OR REPLACE INTO ${this.synqPrefix}_meta (meta_name, meta_value) VALUES(:name, :value)`);
      const metaInsertMany = this.db.transaction((data: any) => {
        for (const d of data) metaInsert.run(d);
      });
      metaInsertMany([
        { name: 'last_local_sync', value: `STRFTIME('%Y-%m-%d %H:%M:%f','NOW')`},
        { name: 'last_sync', value: change.id }
      ]);

      // Insert merged VClock data
      const updatedRecordMeta = this.insertRecordMeta({change, vclock: changeStatus.vclock});
      this.log.silly({updatedRecordMeta});
    }
    catch (error) {
      await this.rollbackTransaction({savepoint})
      this.log.error(`Error applying change: ${error}`);
      throw error; // Throw the error to trigger rollback
    }
  }
  
  applyChangesToLocalDB({ changes }: { changes: Change[] }) {
    this.disableTriggers();
    // Split changes into batches
    for (let i = 0; i < changes.length; i += this.synqBatchSize) {
      const batch = changes.slice(i, i + this.synqBatchSize);
  
      // Create savepoint and apply each batch within a transaction
      const savepoint = this.beginTransaction();
      try {
        for (const change of batch) {
          this.applyChange({change, savepoint})
        }

        // Commit the changes for this batch
        this.commitTransaction({savepoint});

      } catch (error) {
        this.rollbackTransaction({savepoint})
        this.log.error(`Transaction failed, changes rolled back: ${error}`);
        // Handle transaction failure (e.g., log, retry logic, notification)
      }
    }
    this.enableTriggers();
    this.log.silly(`Applied ${changes.length} change(s)`)
  };

  private getRecordMetaInsertQuery({table, remove = false}: {table: SyncableTable, remove?: boolean}) {
    /* 
    This is kind of insane, but it works. A rundown of what's happening:
    - We're creating a trigger after a deletion (the easy part)
    - Aside from recording the changes, we also need to add record-specific metadata:
      - table and row ID,
      - the number of times the record has been touched (including creation)
      - the map of all changes across all devices, a Vector Clock (JSON format)
    - Getting the vector clock is tricky, partly because of SQLite limitations
      (no variables, control structures), and partly because it's possible that
      no meta exists for the record.
    - To work around this we do a select to get the meta, but perform a union with
      another select that just selects insert values.
    - Included in both selects is
      a 'peg' which we use to sort the UNIONed rows to ensure that if a valid row
      exists, it's the first row returned.
    - Now we select from this union and limit to 1 result. If a record exists
      then we get that record. If not, we get the values ready for insertion.
    - Finally, if there's a conflict on PRIMAY KEY or UNIQUE contraints, we update
      only the columns configured as  editable.
    */
    const version = remove ? 'OLD' : 'NEW';
    const sql = `
    INSERT INTO ${this.synqPrefix}_record_meta (table_name, row_id, mod, vclock)
    SELECT table_name, row_id, mod, vclock
    FROM (
      SELECT
        1 as peg,
        '${table.name}' as table_name,
        ${version}.${table.id} as row_id, 
        IFNULL(json_extract(vclock,'$.${this.deviceId}'), 0) + 1 as mod, 
        json_set(IFNULL(json_extract(vclock, '$'),'{}'), '$.${this.deviceId}', IFNULL(json_extract(vclock,'$.${this.deviceId}'), 0) + 1) as vclock
      FROM ${this.synqPrefix}_record_meta
      WHERE table_name = '${table.name}'
      AND row_id = ${version}.${table.id}
      UNION
      SELECT 0 as peg, '${table.name}' as table_name, ${version}.${table.id} as row_id, 1, json_object('${this.deviceId}', 1) as vclock
    )
    ORDER BY peg DESC
    LIMIT 1
    ON CONFLICT DO UPDATE SET
      mod = json_extract(excluded.vclock,'$.${this.deviceId}'),
      vclock = json_extract(excluded.vclock,'$')
    ;`;
    this.log.silly(sql);
    return sql;
  }

  setupTriggersForTable({ table }: { table: SyncableTable }) {
    this.log.debug('Setting up triggers for', table.name);

    // Template for inserting the new value as JSON in the `*_changes` table.
    const jsonObject = (this.runQuery<any>({
      sql:`
      SELECT 'json_object(' || GROUP_CONCAT('''' || name || ''', NEW.' || name, ',') || ')' AS jo
      FROM pragma_table_info('${table.name}');`
    }))[0];
    this.log.silly('@jsonObject', JSON.stringify(jsonObject, null, 2));

    /**
     * These triggers run for changes originating locally. They are disabled
     * when remote changes are being applied (`triggers_on` in `*_meta` table).
     */

    // Ensure triggers are up to date
    this.run({sql: `DROP TRIGGER IF EXISTS ${this.synqPrefix}_after_insert_${table.name}`});
    this.run({sql: `DROP TRIGGER IF EXISTS ${this.synqPrefix}_after_update_${table.name}`});
    this.run({sql: `DROP TRIGGER IF EXISTS ${this.synqPrefix}_after_delete_${table.name}`});

    const sql = `
      CREATE TRIGGER IF NOT EXISTS ${this.synqPrefix}_after_insert_${table.name}
      AFTER INSERT ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${this.synqPrefix}_meta WHERE meta_name = 'triggers_on')='1'
      BEGIN
        INSERT INTO ${this.synqPrefix}_changes (table_name, row_id, operation, data)
        VALUES ('${table.name}', NEW.${table.id}, 'INSERT', ${jsonObject.jo});

        ${this.getRecordMetaInsertQuery({table})}
      END;`
    this.run({sql});

    this.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${this.synqPrefix}_after_update_${table.name}
      AFTER UPDATE ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${this.synqPrefix}_meta WHERE meta_name = 'triggers_on')='1'
      BEGIN
        INSERT INTO ${this.synqPrefix}_changes (table_name, row_id, operation, data)
        VALUES ('${table.name}', NEW.${table.id}, 'UPDATE', ${jsonObject.jo});

        ${this.getRecordMetaInsertQuery({table})}
      END;`
    });

    this.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${this.synqPrefix}_after_delete_${table.name}
      AFTER DELETE ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${this.synqPrefix}_meta WHERE meta_name = 'triggers_on')='1'
      BEGIN
        INSERT INTO ${this.synqPrefix}_changes (table_name, row_id, operation) VALUES ('${table.name}', OLD.${table.id}, 'DELETE');
        
        ${this.getRecordMetaInsertQuery({table, remove: true})}
      END;`
    });


    /**
     * All the triggers below will only be executed if `meta_name="debug_on"`
     * has the `meta_value=1` in the *_meta table, regardless of `triggers_on`.
     */

    // Remove previous versions
    this.run({sql: `DROP TRIGGER IF EXISTS ${this.synqPrefix}_dump_after_insert_${table.name}`});
    this.run({sql: `DROP TRIGGER IF EXISTS ${this.synqPrefix}_dump_after_update_${table.name}`});
    this.run({sql: `DROP TRIGGER IF EXISTS ${this.synqPrefix}_dump_after_delete_${table.name}`});
    this.run({sql: `DROP TRIGGER IF EXISTS ${this.synqPrefix}_dump_before_insert_record_meta`});
    this.run({sql: `DROP TRIGGER IF EXISTS ${this.synqPrefix}_dump_after_insert_record_meta`});
    this.run({sql: `DROP TRIGGER IF EXISTS ${this.synqPrefix}_dump_after_update_record_meta`});

    /**
     * @Debugging Do not remove
     * These triggers allow a rudimentary tracing of DB actions on the synced tables.
     */
    this.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${this.synqPrefix}_dump_after_insert_${table.name}
      AFTER INSERT ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${this.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${this.synqPrefix}_dump (table_name, operation, data)
        VALUES ('${table.name}', 'INSERT', ${jsonObject.jo});
      END;`
    });

    this.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${this.synqPrefix}_dump_after_update_${table.name}
      AFTER UPDATE ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${this.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${this.synqPrefix}_dump (table_name, operation, data) VALUES ('${table.name}', 'UPDATE', ${jsonObject.jo});
      END;`
    });

    const oldJsonObject = jsonObject.jo.replace(/NEW/g, 'OLD');
    
    this.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${this.synqPrefix}_dump_after_delete_${table.name}
      AFTER DELETE ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${this.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${this.synqPrefix}_dump (table_name, operation, data) VALUES ('${table.name}', 'DELETE', ${oldJsonObject});
      END;`
    });

    /**
     * @Debugging Do not remove
     * These triggers allow comparison record meta before and after insert.
     */

    this.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${this.synqPrefix}_dump_before_insert_record_meta
      BEFORE INSERT ON ${this.synqPrefix}_record_meta
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${this.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${this.synqPrefix}_dump (table_name, operation, data)
        VALUES (NEW.table_name, 'BEFORE_INSERT', json_object('table_name', NEW.table_name, 'row_id', NEW.row_id, 'mod', NEW.mod, 'vclock', NEW.vclock));
      END;`
    });

    this.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${this.synqPrefix}_dump_after_insert_record_meta
      AFTER INSERT ON ${this.synqPrefix}_record_meta
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${this.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${this.synqPrefix}_dump (table_name, operation, data)
        VALUES ('${table.name}', 'AFTER_INSERT', json_object('table_name', NEW.table_name, 'row_id', NEW.row_id, 'mod', NEW.mod, 'vclock', NEW.vclock));
      END;`
    });

    this.run({
      sql:`
      CREATE TRIGGER IF NOT EXISTS ${this.synqPrefix}_dump_after_update_record_meta
      AFTER UPDATE ON ${this.synqPrefix}_record_meta
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${this.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${this.synqPrefix}_dump (table_name, operation, data)
        VALUES ('${table.name}', 'AFTER_UPDATE', json_object('table_name', NEW.table_name, 'row_id', NEW.row_id, 'mod', NEW.mod, 'vclock', NEW.vclock));
      END;`
    });

    this.enableTriggers();
    this.log.debug(`@@@\nTriggers ready\n@@@`);
  }
}