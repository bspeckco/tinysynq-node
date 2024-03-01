import DB from 'better-sqlite3'
import { ApplyChangeParams, Change, LogLevel, SynQLiteOptions, SyncableTable, VClock } from './types.js';
import { Logger, ILogObj } from 'tslog';
import { nanoid } from 'nanoid';
import { VCompare } from './vcompare.class.js';
import { SYNQ_INSERT } from './constants.js';

const log = new Logger({ name: 'synqlite-web-init', minLevel: LogLevel.Info });
const strtimeAsISO8601 = `STRFTIME('%Y-%m-%dT%H:%M:%f','NOW')`;

type PreProcessChangeOptions = {
  change: Change, restore?: boolean
}

type PreProcessChangeResult = { 
  valid: boolean;
  reason: string;
  vclock: VClock;
  checks: Record<string, boolean>
}

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

  getTableIdColumn({table_name}: {table_name: string}) {
    return this.synqTables![table_name]?.id as string;
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
  
  getChangesSinceLastSync(data?: {lastSync?: string, columns?: string[]}): Change[] {
    let lastLocalSync: string = data?.lastSync || this.getLastSync();
    let { columns = ['*'] } = data || {};
    this.log.debug('@getChangesSinceLastSync', lastLocalSync);
  
    let where: string = '';
    let columnSelection = columns.join(','); // @TODO: This is UGLY and UNSAFE
  
    if (lastLocalSync) {
      where = 'WHERE c.modified > ?'
    }
    const sql = `
      SELECT ${columnSelection}
      FROM ${this._synqPrefix}_changes c
      INNER JOIN ${this._synqPrefix}_record_meta trm
      ON trm.table_name = c.table_name
      AND trm.row_id = c.row_id
      ${where}
      ORDER BY c.modified ASC
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
    const idCol = this.getTableIdColumn({table_name: table_name});
    const sql = `SELECT * FROM ${table_name} WHERE ${idCol} = ?`;
    const res = this.runQuery({sql, values: [row_id]});
    this.log.debug('@getRecord', res);
    return res[0];
  }

  getById<T>({table_name, row_id}: {table_name: string, row_id: any}): T | any {
    return this.getRecord({table_name, row_id});
  }

  insertRecordMeta({change, vclock}: any) {
    //this.log.warn('<<< @insertRecordMeta >>>', {change, vclock});
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

  getPending() {
    const sql = `
    SELECT *
    FROM ${this._synqPrefix}_pending
    ORDER BY id ASC
    `;
    const res = this.runQuery({sql});
    return res;
  }

  /**
   * Creates new pending record to be applied later.
   * 
   * @param param0 
   * @returns Newly created pending record
   */
  private processOutOfOrderChange({change}: {change: Change}) {
    const {id, ...data} = change;
    const sql = this.createInsertFromSystemObject({
      data,
      table_name: `${this._synqPrefix}_pending`,
    });
    this.log.trace('@processOutOfOrderChange\n', sql, change);
    const values: any = { ...data};
    values.vclock = JSON.stringify(data.vclock);
    const res = this.runQuery({sql, values});
    this.log.trace('@processOutOfOrderChange\n', {res});
    return res;
  }

  /**
   * Determines whether to treat conflicted change as valid or invalid.
   * 
   * @param param0 
   * @returns boolean 
   */
  private processConflictedChange<T>({ record, change }: {record: T|any, change: Change}): boolean {
    const localMeta = this.getRecordMeta({...change});
    this.log.trace('<<<@ processConflictedChange LLW @>>>', change.id, change.table_name, change.row_id, {record, localMeta, change});
    if (change.modified > localMeta.modified) {
      this.log.trace('<!> INTEGRATING REMOTE', change.id, change.table_name, change.row_id);
      // Update local with the incoming changes
      return true;
    }
    else {
      this.log.warn('<!> KEEPING LOCAL', change.id, change.table_name, change.row_id);
      // Keep the local change, but record receipt of the record.
      return false;
    }
  }

  /**
   * Checks for issues with incoming change to be applied.
   * 
   * @returns 
   */
  private preProcessChange(
    {change, restore}: PreProcessChangeOptions
  ): PreProcessChangeResult {
    let defaultReason = 'unknown';
    let valid = false;
    let reason = defaultReason;
    const localId = this.deviceId!;
    const { table_name, row_id, vclock: remote = {} } = change;
    const record = this.getRecord({table_name, row_id});
    const meta = this.getRecordMeta({table_name, row_id});
    const local = meta?.vclock ? JSON.parse(meta.vclock) : {};

    let latest: VClock = {};
    const localV = new VCompare({ local, remote, localId });
    let displaced = false;
    let conflicted = false;
    let stale = false;

    // If we don't have the record, treat it as new
    if (!restore && !record && change.operation !== SYNQ_INSERT) {
      reason = 'update before insert';
      this.processOutOfOrderChange({change});
    }
    else if (restore || !record || !local || !local[localId]) {
      latest = change.vclock;
    }
    
    validationCondition:
    if (restore) {
      valid = true;
      reason = 'restoration';
      latest = localV.merge();
      break validationCondition;
    }
    else if (displaced = localV.isOutOfOrder()) {  
      reason = 'received out of order';
      this.processOutOfOrderChange({change});
    }
    else if (conflicted = localV.isConflicted()) {
      valid = this.processConflictedChange({record, change});
      if (!valid) {
        reason = 'concurrent writes'; 
      }
      else {
        latest = localV.merge();
      }
    }
    else if (stale = localV.isOutDated()) {
      reason = 'stale';
    }
    else if (reason === defaultReason) {
      valid = true;
      reason = '';
      latest = localV.merge();
    }

    this.log.debug({table_name, row_id, conflicted, displaced, stale});

    return { valid, reason, vclock: latest, checks: { stale, displaced, conflicted } };
  }

  createInsertFromObject({data, table_name: table}: { data: Record<string, any>, table_name: string }) {
    const columnsToInsert = Object.keys(data).join(',');
    const editable = this._synqTables![table].editable;
    const updates = Object.keys(data)
      .filter(key => editable.includes(key))
      .map(k => `${k} = :${k}`)
      .join(',');
    
    if (!updates) throw new Error('No changes availble');
    const insertPlaceholders = Object.keys(data).map(k => `:${k}`).join(',');
    const insertSql = `
      INSERT INTO ${table} (${columnsToInsert})
      VALUES (${insertPlaceholders})
      ON CONFLICT DO UPDATE SET ${updates}
      RETURNING *;`;

    return insertSql;
  }

  private createInsertFromSystemObject({data, table_name: table}: { data: Record<string, any>, table_name: string }) {
    this.log.silly('@createInsert...', {data});
    const columnsToInsert = Object.keys(data).join(',');
    const updates = Object.keys(data)
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

  private updateLastSync({change}: {change: Change}) {
    const metaInsert = this.db.prepare(`INSERT OR REPLACE INTO ${this.synqPrefix}_meta (meta_name, meta_value) VALUES(:name, :value)`);
    const metaInsertMany = this.db.transaction((data: any) => {
      for (const d of data) metaInsert.run(d);
    });
    metaInsertMany([
      { name: 'last_local_sync', value: `STRFTIME('%Y-%m-%d %H:%M:%f','NOW')`},
      { name: 'last_sync', value: change.id }
    ]);
  }

  private async applyChange({
    change,
    restore,
    savepoint
  }: ApplyChangeParams) {
    try {
      // Check that the changes can actually be applied
      const changeStatus = this.preProcessChange({change, restore});
      if (!changeStatus.valid) {
        this.log.warn(changeStatus);
        this.updateLastSync({change});
        return;
      }

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
      else {
        // There's no data so bail
        throw new Error(`Cannot perform update with empty data:\n${JSON.stringify(change, null, 2)}`);
      }
 
      if (!table) throw new Error(`Unable to find table ${change.table_name}`);
      this.log.silly('@applyChange', {change, table, changeStatus});
      switch(change.operation) {
        case 'INSERT':
        case 'UPDATE':
          const insertSql = this.createInsertFromObject({
            data: recordData,
            table_name: change.table_name
          });
          await this.run({sql: insertSql, values: recordData});
          break;
        case 'DELETE':
          const sql = `DELETE FROM ${change.table_name} WHERE ${table.id} = ?`;
          this.log.warn('>>> DELETE SQL <<<', sql, change.row_id);
          await this.run({sql, values: [change.row_id]});
          break;
      }

      this.updateLastSync({change});

      // Insert merged VClock data
      const updatedRecordMeta = this.insertRecordMeta({change, vclock: changeStatus.vclock});
      this.log.silly({updatedRecordMeta});
    }
    catch (error) {
      await this.rollbackTransaction({savepoint})
      this.log.error(`Error applying change: ${error}. Rolled back.`);
      throw error; // Throw the error to trigger rollback
    }
  }
  
  applyChangesToLocalDB({ changes, restore = false }: { changes: Change[], restore?: boolean }) {
    this.disableTriggers();
    // Split changes into batches
    for (let i = 0; i < changes.length; i += this.synqBatchSize) {
      const batch = changes.slice(i, i + this.synqBatchSize);
  
      // Create savepoint and apply each batch within a transaction
      const savepoint = this.beginTransaction();
      try {
        for (const change of batch) {
          this.applyChange({change, restore, savepoint})
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
    this.log.silly(`Applied ${changes.length} change(s)`);
  };

  tablesReady() {
    this.enableTriggers();
  }
}