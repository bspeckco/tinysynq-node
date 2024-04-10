var tslog = require('tslog');
require('dotenv/config');
var DB = require('better-sqlite3');
var nanoid = require('nanoid');
var uWS = require('uWebSockets.js');
var worker_threads = require('worker_threads');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

function _interopNamespace(e) {
  if (e && e.__esModule) return e;
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n["default"] = e;
  return n;
}

var DB__default = /*#__PURE__*/_interopDefaultLegacy(DB);
var uWS__namespace = /*#__PURE__*/_interopNamespace(uWS);

const env = process.env;

var TinySynqOperation;
(function (TinySynqOperation) {
  TinySynqOperation["INSERT"] = "INSERT";
  TinySynqOperation["UPDATE"] = "UPDATE";
  TinySynqOperation["DELETE"] = "DELETE";
})(TinySynqOperation || (TinySynqOperation = {}));
var SyncRequestType;
(function (SyncRequestType) {
  SyncRequestType["push"] = "push";
  SyncRequestType["pull"] = "pull";
})(SyncRequestType || (SyncRequestType = {}));
var SyncResponseType;
(function (SyncResponseType) {
  SyncResponseType["ack"] = "ack";
  SyncResponseType["nack"] = "nack";
})(SyncResponseType || (SyncResponseType = {}));
var LogLevel;
(function (LogLevel) {
  LogLevel[LogLevel["Silly"] = 0] = "Silly";
  LogLevel[LogLevel["Trace"] = 1] = "Trace";
  LogLevel[LogLevel["Debug"] = 2] = "Debug";
  LogLevel[LogLevel["Info"] = 3] = "Info";
  LogLevel[LogLevel["Warn"] = 4] = "Warn";
  LogLevel[LogLevel["Error"] = 5] = "Error";
  LogLevel[LogLevel["Fatal"] = 6] = "Fatal";
})(LogLevel || (LogLevel = {}));

class VCompare {
  constructor({
    local,
    remote,
    localId,
    localTime,
    remoteTime
  }) {
    this.local = void 0;
    this.isGreater = false;
    this.isLess = false;
    this.isWrongOrder = false;
    this.remote = {};
    this.localId = void 0;
    this.localTime = void 0;
    this.remoteTime = void 0;
    this.local = local;
    this.remote = typeof remote === 'string' ? JSON.parse(remote) : remote;
    this.localId = localId;
    this.localTime = localTime;
    this.remoteTime = remoteTime;
  }
  setRemote({
    remote
  }) {
    this.remote = remote;
  }
  isConflicted(data) {
    const remote = (data == null ? void 0 : data.remote) || this.remote;
    const keys = Object.keys({
      ...this.local,
      ...remote
    });
    keys.forEach(k => {
      const localCount = this.local[k] || 0;
      const remoteCount = remote[k] || 0;
      this.isGreater = this.isGreater || localCount > remoteCount;
      this.isLess = this.isLess || localCount < remoteCount;
    });
    return this.isGreater && this.isLess;
  }
  isOutDated() {
    // Default localTime to any early date so that 
    // remote always wins when local is empty.
    const {
      remoteTime,
      localTime = '1970-01-01'
    } = this;
    if (!remoteTime || !localTime) throw new Error('Missing modified time');
    return new Date(localTime) >= new Date(remoteTime);
  }
  isOutOfOrder() {
    const {
      remote,
      local,
      localId
    } = this;
    if (!remote || !local) throw new Error('Remote vector clock not set');
    const keys = Object.keys({
      ...this.local,
      ...remote
    }).filter(k => k !== localId);
    for (let i = 0; i < keys.length; i++) {
      var _local$k, _remote$k;
      const k = keys[i];
      const drift = Math.abs(((_local$k = local[k]) != null ? _local$k : 0) - ((_remote$k = remote[k]) != null ? _remote$k : 0));
      this.isWrongOrder = drift > 1;
    }
    return this.isWrongOrder;
  }
  merge() {
    const merged = {};
    const participants = new Set(Object.keys(this.local).concat(Object.keys(this.remote)));
    // If the incoming participant vclock is lower, discard
    for (const p of participants) {
      const localP = this.local[p] || 0;
      const remoteP = this.remote[p] || 0;
      merged[p] = Math.max(localP, remoteP);
    }
    if (merged[this.localId] === undefined) {
      merged[this.localId] = 0;
    }
    return merged;
  }
}

const SYNQ_INSERT = 'INSERT';
const SYNQ_UPDATE = 'UPDATE';
const TINYSYNQ_SAFE_ISO8601_REGEX = /^\d{4}(-\d{2}){2}\s(\d{2}:){2}\d{2}(\.\d{1,3})?$/;

var _env$TINYSYNQ_LOG_LEV;
const log = new tslog.Logger({
  name: 'tinysync-node',
  minLevel: (_env$TINYSYNQ_LOG_LEV = env.TINYSYNQ_LOG_LEVEL) != null ? _env$TINYSYNQ_LOG_LEV : LogLevel.Info,
  type: env.TINYSYNQ_LOG_FORMAT || 'json'
});
const strftimeAsISO8601 = `STRFTIME('%Y-%m-%d %H:%M:%f','NOW')`;
/**
 * The main class for managing SQLite3 synchronisation.
 *
 * @remarks
 * Expects SQLite3 version \>=3.45.1
 *
 * @public
 */
class TinySynq {
  /**
   * Configure new TinySynq instance.
   *
   * @param opts - Configuration options
   */
  constructor(opts) {
    var _opts$prefix, _opts$wal;
    this._db = void 0;
    this._dbPath = void 0;
    this._deviceId = void 0;
    this._synqPrefix = void 0;
    this._synqTables = void 0;
    this._synqBatchSize = 20;
    this._wal = true;
    this.log = void 0;
    /**
     * Basic Helpers.
     *
     * @TODO move to a separate file.
     *
     * @public
     */
    this.utils = {
      strftimeAsISO8601,
      nowAsISO8601: strftimeAsISO8601,
      utcNowAsISO8601: () => {
        return new Date().toISOString().replace(/[TZ]/g, ' ').trim();
      },
      isSafeISO8601: date => {
        return TINYSYNQ_SAFE_ISO8601_REGEX.test(date);
      }
    };
    if (!opts.filePath && !opts.sqlite3) {
      throw new Error('No DB filePath or connection provided');
    }
    const _synqTables = {};
    opts.tables.forEach(t => {
      _synqTables[t.name] = t;
    });
    this._dbPath = opts.filePath || '';
    this._db = opts.sqlite3 || undefined;
    this._synqPrefix = (_opts$prefix = opts.prefix) == null ? void 0 : _opts$prefix.trim().replace(/[^a-z0-9]+$/i, '');
    this._synqTables = _synqTables;
    this._synqBatchSize = opts.batchSize || this._synqBatchSize;
    this._wal = (_opts$wal = opts.wal) != null ? _opts$wal : false;
    this.log = new tslog.Logger({
      name: 'tinysync-node',
      minLevel: LogLevel.Debug,
      type: 'json',
      maskValuesOfKeys: ['password', 'encryption_key'],
      hideLogPositionForProduction: true,
      ...(opts.logOptions || {})
    });
    if (!this.db) {
      this._db = new DB__default["default"](this.dbPath);
      this.db.pragma('journal_mode = WAL');
    }
  }
  /**
   * better-sqlite3 instance (See {@link https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md | BetterSqlite3})
   */
  get db() {
    return this._db;
  }
  /**
   * Path to DB file
   *
   * @example
   *
   * `./app.db` or `/tmp/app.db`
   */
  get dbPath() {
    return this._dbPath;
  }
  /**
   * Automatically generated ID for device's DB instance.
   *
   * @remarks
   *
   * This ID is used by the sync protocol to identify the database.
   * One it is generated once during setup and does not change. The
   * value is stored in the `_meta` table (`meta_name='device_id'`).
   * __Do not edit this value; doing so would corrupt synchronisation__.
   */
  get deviceId() {
    return this._deviceId;
  }
  /**
   * Alias for {@link TinySynq.deviceId}.
   */
  get synqDbId() {
    return this._deviceId;
  }
  /**
   * The prefix used for TinySynq's tables.
   *
   * @defaultValue `tinysync`
   */
  get synqPrefix() {
    return this._synqPrefix;
  }
  /**
   * Object containing {@link SyncableTable}s, keyed by table name.
   *
   * @remarks
   *
   * A {@link SyncableTable} structure is never modified. TinySynq maintains
   * its own tables and triggers for tracking and responding to changes.
   *
   * @returns Record\<string, SyncableTable\>
   */
  get synqTables() {
    return this._synqTables;
  }
  /**
   * Number of records to process in each batch when syncing changes.
   */
  get synqBatchSize() {
    return this._synqBatchSize;
  }
  /**
   * Enable or disable WAL mode.
   *
   * @defaultValue true
   */
  get wal() {
    return this._wal;
  }
  /**
   * Get a random 16-character ID generated by nanoid
   *
   * @returns string
   */
  getNewId() {
    return nanoid.nanoid(16);
  }
  /**
   * Get the column used as identifier for the {@link SyncableTable}.
   *
   * @param params - Details of table for which to retrieve ID column.
   * @returns Column name
   */
  getTableIdColumn(params) {
    var _this$synqTables$tabl;
    const {
      table_name
    } = params;
    return (_this$synqTables$tabl = this.synqTables[table_name]) == null ? void 0 : _this$synqTables$tabl.id;
  }
  /**
   * If not already set, generates and sets deviceId.
   */
  setDeviceId() {
    var _existing, _existing2;
    // Set the device ID
    let existing;
    try {
      existing = this.runQuery({
        sql: `SELECT meta_value FROM ${this.synqPrefix}_meta WHERE meta_name = 'device_id'`
      })[0];
    } catch (err) {
      this.log.warn(`Couldn't retrieve device ID`);
    }
    log.info('@device_id', existing);
    if (!((_existing = existing) != null && _existing.meta_value)) {
      const res = this.runQuery({
        sql: `INSERT OR REPLACE INTO ${this.synqPrefix}_meta (meta_name, meta_value) VALUES (?,?) RETURNING *`,
        values: ['device_id', nanoid.nanoid(16)]
      });
      log.info('@created record for device_id:', res[0].meta_value);
      existing = res[0];
    }
    this._deviceId = (_existing2 = existing) == null ? void 0 : _existing2.meta_value;
  }
  /**
   * Run an operation against the DB
   *
   * @remarks
   * This method does not return any records, only the result of the operation.
   *
   * @param params - The SQL query and optionally any values.
   * @returns
   */
  run(params) {
    const {
      sql,
      values
    } = params;
    const quid = Math.ceil(Math.random() * 1000000);
    this.log.debug('@run', quid, sql, values, '/');
    try {
      const result = this.db.prepare(sql).run(values || []);
      this.log.debug({
        quid,
        result
      });
      return result;
    } catch (err) {
      this.log.error(quid, err);
      return err;
    }
  }
  /**
   * Run multiple operations against the DB
   *
   * @remarks
   * This method does not return any records.
   *
   * @param params - The SQL query and optionally an array of arrays or key/value pairs
   * @returns Undefined or an error, if one occurred
   */
  runMany(params) {
    const {
      sql,
      values
    } = params;
    const quid = Math.ceil(Math.random() * 1000000);
    this.log.debug('@runMany', quid, sql, values, '/');
    try {
      const query = this.db.prepare(sql);
      for (const v of values) {
        query.run(v);
      }
      this.log.debug({
        quid,
        result: 'done'
      });
    } catch (err) {
      this.log.error(quid, err);
      return err;
    }
  }
  /**
   * Run an operation against the DB
   *
   * @param params - The SQL query and optionally any values
   * @returns Array of records returned from the database
   */
  runQuery(params) {
    const {
      sql,
      values
    } = params;
    const quid = Math.ceil(Math.random() * 1000000);
    this.log.debug('@runQuery', {
      quid,
      sql,
      values
    });
    try {
      const result = this.db.prepare(sql).all(values || []);
      this.log.debug({
        quid,
        result
      });
      return result;
    } catch (err) {
      this.log.error(quid, err);
      return err;
    }
  }
  /**
   * Returns the current device's unique TinySynq ID.
   *
   * @returns The device's assigned ID.
   */
  getDeviceId() {
    if (this._deviceId) return this._deviceId;
    const res = this.runQuery({
      sql: `
        SELECT meta_value FROM ${this.synqPrefix}_meta
        WHERE meta_name = 'device_id'`
    });
    return res[0].meta_value;
  }
  /**
   * Returns an ISO8601 formatted date and time of the last successful local sync.
   *
   * @remarks
   *
   * A "local sync" is the process of sending local changes to the remote hub.
   *
   * @returns The time of the last sync.
   */
  getLastSync() {
    var _res$;
    const res = this.runQuery({
      sql: `
        SELECT meta_value FROM ${this.synqPrefix}_meta
        WHERE meta_name = 'last_local_sync'`
    });
    this.log.trace('@getLastSync', res[0]);
    return (_res$ = res[0]) == null ? void 0 : _res$.meta_value;
  }
  /**
   * Returns matching {@link Change} objects since the last local sync.
   *
   * @remarks
   *
   * If `lastLocalSync` is empty, all changes are returned.
   *
   * @param params - Object containing retrieval parameters.
   * @returns An array of {@link Change} objects.
   */
  getChanges(params) {
    let lastLocalSync = (params == null ? void 0 : params.lastLocalSync) || this.getLastSync();
    let {
      columns = []
    } = params || {};
    this.log.debug('@getChanges', lastLocalSync);
    let where = '';
    let columnSelection = columns.map(c => c.replace(/[^*._a-z0-9]+/gi, '')).join(',') || '*';
    if (lastLocalSync) {
      where = 'WHERE c.modified > ?';
    }
    const sql = `
      SELECT ${columnSelection}
      FROM ${this._synqPrefix}_changes c
      ${where}
      ORDER BY c.modified ASC
    `;
    console.log(sql);
    const values = lastLocalSync ? [lastLocalSync] : [];
    this.log.debug(sql, values);
    return this.runQuery({
      sql,
      values
    });
  }
  /**
   * Returns {@link Change} objects since the last local sync.
   *
   * @remarks
   *
   * If `lastLocalSync` is empty, all changes are returned.
   *
   * @param params - Object containing retrieval parameters.
   * @returns An array of {@link Change} objects.
   */
  getChangesSinceLastSync(params) {
    let lastLocalSync = this.getLastSync() || undefined; // @TODO: remove — getChanges already does this.
    return this.getChanges({
      ...params,
      lastLocalSync
    });
  }
  /**
   * Writes debug mode value (true) which disables recording
   * of operations on syncable tables.
   *
   * @remarks
   *
   * The value set by this method is checked by dedicated triggers.
   * If the value is `1`, the active trigger writes the data to the
   * `*_dump` table. It's worth purging the table data once done
   * with debugging.
   *
   * @returns Result of the operation.
   */
  enableDebug() {
    return this.run({
      sql: `
      INSERT OR REPLACE INTO ${this.synqPrefix}_meta (meta_name, meta_value)
      VALUES ('debug_on', '1')
      RETURNING *;`
    });
  }
  /**
   * Writes debug mode value (false) which disables recording
   * of operations on syncable tables.
   *
   * @see {@link TinySynq.enableDebug} for more details.
   *
   * @returns Result of the operation.
   */
  disableDebug() {
    return this.run({
      sql: `
      INSERT OR REPLACE INTO ${this.synqPrefix}_meta (meta_name, meta_value)
      VALUES ('debug_on', '0')
      RETURNING *;`
    });
  }
  /**
   * Empties the `*_dump` table.
   *
   * @see {@link TinySynq.enableDebug} for more details.
   */
  clearDebugData() {
    this.run({
      sql: `DELETE FROM ${this._synqPrefix}_dump`
    });
    this.run({
      sql: `UPDATE SQLITE_SEQUENCE SET seq = 0 WHERE name = ${this._synqPrefix}_dump`
    });
  }
  /**
   * Writes value (true) which determines whether or not triggers on syncable
   * tables are executed.
   *
   * @returns Result of operation.
   */
  enableTriggers() {
    return this.run({
      sql: `
      INSERT OR REPLACE INTO ${this.synqPrefix}_meta (meta_name, meta_value)
      VALUES ('triggers_on', '1');`
    });
  }
  /**
   * Writes value (true) which determines whether or not triggers on syncable
   * tables are executed.
   *
   * @returns Result of operation.
   */
  disableTriggers() {
    return this.run({
      sql: `
      INSERT OR REPLACE INTO ${this.synqPrefix}_meta (meta_name, meta_value)
      VALUES ('triggers_on', '0');`
    });
  }
  beginTransaction() {
    const savepoint = `SP${Date.now()}`;
    const sql = `SAVEPOINT ${savepoint};`;
    this.run({
      sql
    });
    return savepoint;
  }
  commitTransaction({
    savepoint
  }) {
    const sql = `RELEASE SAVEPOINT ${savepoint};`;
    return this.run({
      sql
    });
  }
  rollbackTransaction({
    savepoint
  }) {
    const sql = `ROLLBACK TRANSACTION TO SAVEPOINT ${savepoint};`;
    return this.run({
      sql
    });
  }
  /**
   * Retrieves a single record.
   *
   * @param params - Object containing table/row parameters.
   * @returns
   */
  getRecord(params) {
    const {
      table_name,
      row_id
    } = params;
    const idCol = this.getTableIdColumn({
      table_name: table_name
    });
    const sql = `SELECT * FROM ${table_name} WHERE ${idCol} = ?`;
    const res = this.runQuery({
      sql,
      values: [row_id]
    });
    this.log.debug('@getRecord', res);
    return res[0];
  }
  /**
   * Retrieves a single record by it's ID.
   *
   * @remarks
   *
   * The column used to identify the record is according to the {@link SyncableTable}
   * that was provided in {@link TinySynqOptionsBase.tables} at instantiation.
   *
   * @param params - Object containing table/row parameters.
   * @returns
   */
  getById(params) {
    const {
      table_name,
      row_id
    } = params;
    return this.getRecord({
      table_name,
      row_id
    });
  }
  insertRecordMeta({
    change,
    vclock
  }) {
    if (!this.utils.isSafeISO8601(change.modified)) throw new Error(`Invalid modified data for record meta: ${change.modified}`);
    this.log.debug('<<< @insertRecordMeta >>>', {
      change,
      vclock
    });
    const {
      table_name,
      row_id,
      source
    } = change;
    const mod = vclock[this._deviceId] || 0;
    const values = {
      table_name,
      row_id,
      mod,
      source,
      vclock: JSON.stringify(vclock),
      modified: change.modified
    };
    this.log.debug("@insertRecordMeta", {
      values
    });
    return this.runQuery({
      sql: `
      INSERT INTO ${this._synqPrefix}_record_meta (table_name, row_id, source, mod, vclock, modified)
      VALUES (:table_name, :row_id, :source, :mod, :vclock, :modified)
      ON CONFLICT DO UPDATE SET source = :source, mod = :mod, vclock = :vclock, modified = :modified
      RETURNING *
      `,
      values
    });
  }
  /**
   * Get associated meta data (including `vclock`) for record.
   *
   * @param params - Object containing table/row parameters.
   *
   * @returns Object containing row data from `*_record_meta`.
   */
  getRecordMeta(params) {
    const {
      table_name,
      row_id
    } = params;
    const sql = `
    SELECT *
    FROM ${this.synqPrefix}_record_meta
    WHERE table_name = :table_name
    AND row_id = :row_id`;
    const res = this.db.prepare(sql).get({
      table_name,
      row_id
    });
    return res;
  }
  /**
   * Returns changes that couldn't be applied yet because they
   * were received out of sequence.
   *
   * @returns Array of pending changes.
   */
  getPending() {
    const sql = `
    SELECT *
    FROM ${this._synqPrefix}_pending
    ORDER BY id ASC
    `;
    const res = this.runQuery({
      sql
    });
    return res;
  }
  /**
   * Returns the most recent change for a specific record.
   *
   * @param params
   * @returns A single change record, if one exists
   */
  getMostRecentChange(params) {
    const conditions = ['table_name = :table_name', 'row_id = :row_id'];
    if (params.operation) {
      conditions.push('operation = :operation');
    }
    const sql = `
    SELECT * FROM ${this._synqPrefix}_changes
    WHERE ${conditions.join(' AND ')}
    ORDER BY modified DESC
    LIMIT 1`;
    const res = this.runQuery({
      sql,
      values: params
    });
    return res[0];
  }
  /**
   * Creates new pending record to be applied later.
   *
   * @param opts - Options for processing out-of-order change
   * @returns Newly created pending record
   */
  processOutOfOrderChange({
    change
  }) {
    const {
      id,
      ...data
    } = change;
    const sql = this.createInsertFromSystemObject({
      data,
      table_name: `${this._synqPrefix}_pending`
    });
    this.log.trace('@processOutOfOrderChange\n', sql, change);
    const values = {
      ...data
    };
    values.vclock = JSON.stringify(data.vclock);
    const res = this.runQuery({
      sql,
      values
    });
    this.log.trace('@processOutOfOrderChange\n', {
      res
    });
    return res;
  }
  /**
   * Determines whether to treat conflicted change as valid or invalid.
   *
   * @param opts - Options for processing concurrent change
   * @returns boolean
   */
  processConflictedChange({
    record,
    change
  }) {
    // INSERT won't have a local record so accept the incoming change
    if (change.operation === TinySynqOperation.INSERT) return true;
    const localMeta = this.getRecordMeta({
      ...change
    });
    this.log.trace('<<<@ processConflictedChange LLW @>>>', change.id, change.table_name, change.row_id, {
      record,
      localMeta,
      change
    });
    if (change.modified > localMeta.modified) {
      this.log.trace('<!> INTEGRATING REMOTE', change.id, change.table_name, change.row_id);
      // Update local with the incoming changes
      return true;
    } else {
      this.log.trace('<!> KEEPING LOCAL', change.id, change.table_name, change.row_id);
      // Keep the local change, but record receipt of the record.
      return false;
    }
  }
  /**
   * Checks for and handles issues with incoming change to be applied.
   *
   * @returns Result of pre-processing.
   */
  preProcessChange({
    change,
    restore
  }) {
    let defaultReason = 'unknown';
    let valid = false;
    let reason = defaultReason;
    const localId = this.deviceId;
    const {
      table_name,
      row_id,
      vclock: remote = {}
    } = change;
    const record = this.getRecord({
      table_name,
      row_id
    });
    const meta = this.getRecordMeta({
      table_name,
      row_id
    });
    const local = meta != null && meta.vclock ? JSON.parse(meta.vclock) : {};
    const localTime = (meta == null ? void 0 : meta.modified) || '1970-01-01';
    const remoteTime = change.modified;
    let latest = {};
    const localV = new VCompare({
      local,
      remote,
      localId,
      localTime,
      remoteTime
    });
    let displaced = false;
    let conflicted = false;
    let stale = false;
    // If we don't have the record, treat it as new
    if (!restore && !record && change.operation !== SYNQ_INSERT) {
      // But skip potential update-after-delete, which is handled later
      if (!!meta && change.operation === SYNQ_UPDATE) {
        this.log.warn('SKIPPED: non-existent record with existing meta', meta);
      } else {
        reason = 'update before insert';
        this.processOutOfOrderChange({
          change
        });
      }
    } else if (restore || !record || !local || !local[localId]) {
      latest = change.vclock;
    }
    if (restore) {
      valid = true;
      reason = 'restoration';
      latest = localV.merge();
      return {
        record,
        meta,
        valid,
        reason,
        vclock: latest,
        checks: {
          stale,
          displaced,
          conflicted
        }
      };
    } else if (displaced = localV.isOutOfOrder()) {
      reason = 'received out of order';
      this.processOutOfOrderChange({
        change
      });
    } else if (conflicted = localV.isConflicted()) {
      valid = this.processConflictedChange({
        record,
        change
      });
      if (!valid) {
        reason = 'concurrent writes';
      } else {
        latest = localV.merge();
      }
    } else if (stale = localV.isOutDated()) {
      reason = 'stale';
    } else if (reason === defaultReason) {
      valid = true;
      reason = '';
      latest = localV.merge();
    }
    this.log.debug({
      table_name,
      row_id,
      conflicted,
      displaced,
      stale
    });
    return {
      record,
      meta,
      valid,
      reason,
      vclock: latest,
      checks: {
        stale,
        displaced,
        conflicted
      }
    };
  }
  /**
   * Checks for incoming update on deleted record and attempts to resurrect it.
   *
   * @param params
   * @returns Object with `valid` property
   */
  processUpdateAfterDelete(params) {
    const {
      restore,
      record,
      change,
      meta
    } = params;
    const {
      table_name,
      row_id
    } = change;
    let valid = true;
    if (!restore && !record && !!meta && change.operation === SYNQ_UPDATE) {
      // If meta exists but the record doesn't, most likely it's
      // because the record was deleted. If possible, restore it.
      const lastChange = this.getMostRecentChange({
        table_name,
        row_id,
        operation: TinySynqOperation.DELETE
      });
      if (lastChange) {
        let recordData = {};
        try {
          recordData = JSON.parse(lastChange.data);
        } catch (err) {
          valid = false;
          this.log.error(err);
        }
        if (recordData) {
          // Restore the record
          const insertSql = this.createInsertFromObject({
            data: recordData,
            table_name: change.table_name
          });
          this.run({
            sql: insertSql,
            values: recordData
          });
        }
      } else {
        valid = false;
      }
    }
    return {
      valid
    };
  }
  /**
   * Creates an insert query based on the syncable table name and data provided.
   *
   * @remarks
   *
   * This method is specifically for tables that have been registerd as syncable
   * by passing them in as a {@link SyncableTable} at instantiation.
   *
   * @see {@link SyncableTable} for more information.
   *
   * @param param0 - Parameters from which to create the query.
   * @returns A SQL query string.
   */
  createInsertFromObject({
    data,
    table_name: table
  }) {
    const columnsToInsert = Object.keys(data).join(',');
    //const editable = this._synqTables![table].editable || [];
    const updates = Object.keys(data)
    // @TODO: There's no need to restrict editable fields here, but check again.
    //.filter(key => editable.includes(key))
    .map(k => `${k} = :${k}`).join(',');
    if (!updates) throw new Error(`No insertable data: ${JSON.stringify(data)}`);
    const insertPlaceholders = Object.keys(data).map(k => `:${k}`).join(',');
    const insertSql = `
      INSERT INTO ${table} (${columnsToInsert})
      VALUES (${insertPlaceholders})
      ON CONFLICT DO UPDATE SET ${updates}
      RETURNING *;`;
    return insertSql;
  }
  /**
   * Creates an update query based on the syncable table name and data provided.
   *
   * @remarks
   *
   * This method is specifically for tables that have been registerd as syncable
   * by passing them in as a {@link SyncableTable} at instantiation.
   *
   * @see {@link SyncableTable} for more information.
   *
   * @param param0 - Parameters from which to create the query.
   * @returns A SQL query string.
   */
  createUpdateFromObject({
    data,
    table_name: table
  }) {
    if (!this._synqTables[table]) throw new Error(`Not a synced table for update: ${table}`);
    const idCol = this._synqTables[table].id;
    const updates = Object.keys(data).filter(k => k !== idCol).map(k => `${k} = :${k}`).join(',');
    if (!updates) throw new Error(`No updates available: ${JSON.stringify(data)}`);
    const updateSql = `
      UPDATE ${table} SET ${updates}
      WHERE ${idCol} = :${idCol}
      RETURNING *;`;
    return updateSql;
  }
  /**
   * Creates an insert query based on the system table name and data provided.
   *
   * @param param0 - Parameters from which to create the query.
   *
   * @returns A SQL query string.
   */
  createInsertFromSystemObject({
    data,
    table_name: table
  }) {
    this.log.silly('@createInsert...', {
      data
    });
    const columnsToInsert = Object.keys(data).join(',');
    const updates = Object.keys(data).map(k => `${k} = :${k}`).join(',');
    if (!updates) throw new Error('No changes available');
    const insertPlaceholders = Object.keys(data).map(k => `:${k}`).join(',');
    const insertSql = `
      INSERT INTO ${table} (${columnsToInsert})
      VALUES (${insertPlaceholders})
      ON CONFLICT DO UPDATE SET ${updates}
      RETURNING *;`;
    return insertSql;
  }
  updateLastSync({
    change
  }) {
    this.run({
      sql: `INSERT OR REPLACE INTO ${this.synqPrefix}_meta (meta_name, meta_value) VALUES(:name, STRFTIME('%Y-%m-%d %H:%M:%f','NOW'))`,
      values: {
        name: 'last_local_sync'
      }
    });
    this.run({
      sql: `INSERT OR REPLACE INTO ${this.synqPrefix}_meta (meta_name, meta_value) VALUES(:name, :value)`,
      values: {
        name: 'last_sync',
        value: change.id
      }
    });
  }
  insertChangeData({
    change
  }) {
    const values = {
      ...change
    };
    delete values.id;
    const sql = this.createInsertFromSystemObject({
      data: values,
      table_name: `${this.synqPrefix}_changes`
    });
    this.log.debug('@insertChangeData', {
      sql,
      values
    });
    values.vclock = JSON.stringify(change.vclock);
    this.run({
      sql,
      values
    });
  }
  async applyChange({
    change,
    restore,
    savepoint
  }) {
    try {
      // Check that the changes can actually be applied
      const changeStatus = this.preProcessChange({
        change,
        restore
      });
      this.log.warn({
        changeStatus
      });
      if (!changeStatus.valid) {
        console.log(changeStatus);
        this.updateLastSync({
          change
        });
        return;
      }
      // Check for update-after-delete. It's done here so that stale changes are skipped.
      const uadStatus = this.processUpdateAfterDelete({
        ...changeStatus,
        change,
        restore
      });
      if (!uadStatus.valid) {
        this.log.warn(changeStatus);
        this.updateLastSync({
          change
        });
        return;
      }
      const table = this.synqTables[change.table_name];
      const idCol = this.getTableIdColumn(change);
      let recordData;
      if (change.data) {
        try {
          recordData = JSON.parse(change.data);
          recordData[idCol] = change.row_id;
        } catch (err) {
          this.log.debug(change);
          throw new Error('Invalid data for insert or update');
        }
      } else {
        // There's no data so bail
        throw new Error(`Cannot perform update with empty data:\n${JSON.stringify(change, null, 2)}`);
      }
      if (!table) throw new Error(`Unable to find table ${change.table_name}`);
      this.log.silly('@applyChange', {
        change,
        table,
        changeStatus
      });
      // Store the change before applying
      this.insertChangeData({
        change
      });
      switch (change.operation) {
        case 'INSERT':
          const insertSql = this.createInsertFromObject({
            data: recordData,
            table_name: change.table_name
          });
          this.run({
            sql: insertSql,
            values: recordData
          });
          break;
        case 'UPDATE':
          const updateSql = this.createUpdateFromObject({
            data: recordData,
            table_name: change.table_name
          });
          this.run({
            sql: updateSql,
            values: recordData
          });
          break;
        case 'DELETE':
          const sql = `DELETE FROM ${change.table_name} WHERE ${table.id} = ?`;
          this.log.warn('>>> DELETE SQL <<<', sql, change.row_id);
          this.run({
            sql,
            values: [change.row_id]
          });
          break;
      }
      this.updateLastSync({
        change
      });
      // Insert merged VClock data
      const updatedRecordMeta = this.insertRecordMeta({
        change,
        vclock: changeStatus.vclock
      });
      this.log.silly({
        updatedRecordMeta
      });
    } catch (error) {
      await this.rollbackTransaction({
        savepoint
      });
      this.log.error(`Error applying change: ${error}. Rolled back.`);
      throw error; // Throw the error to trigger rollback
    }
  }
  applyChangesToLocalDB({
    changes,
    restore = false
  }) {
    this.log.trace('\n<<< @CHANGES >>>\n', changes, '\n<<< @CHANGES >>>\n');
    this.disableTriggers();
    // Split changes into batches
    for (let i = 0; i < changes.length; i += this.synqBatchSize) {
      const batch = changes.slice(i, i + this.synqBatchSize);
      // Create savepoint and apply each batch within a transaction
      const savepoint = this.beginTransaction();
      try {
        for (const change of batch) {
          this.applyChange({
            change,
            restore,
            savepoint
          });
        }
        // Commit the changes for this batch
        this.commitTransaction({
          savepoint
        });
      } catch (error) {
        this.rollbackTransaction({
          savepoint
        });
        this.log.error(`Transaction failed, changes rolled back: ${error}`);
        // Handle transaction failure (e.g., log, retry logic, notification)
      }
    }
    this.enableTriggers();
    this.log.silly(`Applied ${changes.length} change(s)`);
  }
  /**
   * Get items that have been recently changed.
   *
   * @param opts
   */
  getFilteredChanges(opts) {
    let conditions = [];
    let values = {};
    if (opts != null && opts.exclude) {
      conditions.push('source != :exclude');
      values.exclude = opts.exclude;
    }
    if (opts != null && opts.checkpoint) {
      conditions.push('id > :checkpoint');
      values.checkpoint = opts.checkpoint;
    } else if (opts != null && opts.since) {
      conditions.push('modified > :since');
      values.since = opts.since;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
    SELECT id, table_name, row_id, data, operation, source, vclock, modified
    FROM ${this.synqPrefix}_changes
    ${where} 
    ORDER BY modified ASC`;
    return this.runQuery({
      sql,
      values
    });
  }
  tablesReady() {
    this.enableTriggers();
  }
}

const getOldVsNewUnionColumnSelection = params => {
  if (!params.columns) throw new Error('Missing table column data to generate trigger union column selection');
  return params.columns.map(c => `SELECT '${c.name}' AS col, OLD.${c.name} AS old_val, NEW.${c.name} AS new_val`);
};
const getUpdateTriggerDiffQuery = params => {
  const {
    ts,
    table
  } = params;
  // Need to get the table schema in order to generate the query.
  const columns = ts.runQuery({
    sql: `SELECT * FROM pragma_table_info('${table.name}')`
  });
  const unionSelects = getOldVsNewUnionColumnSelection({
    columns
  });
  const sql = `
  INSERT INTO ${ts.synqPrefix}_changes (table_name, row_id, operation, data)
  SELECT * FROM (
    WITH RECURSIVE all_cols AS (
      ${unionSelects.join('\n    UNION ALL\n    ')}
    ),
    changed_cols AS (
      SELECT col, new_val
      FROM all_cols
      WHERE new_val != old_val
    )
    SELECT '${table.name}', NEW.${table.id}, 'UPDATE', json_group_object(col, new_val)
    FROM changed_cols
  );`;
  console.log('@getUpdateTriggerDiffQuery', sql);
  return sql;
};

/**
 * Returns a configured instance of TinySynq
 *
 * @param config - Configuration object
 * @returns TinySynq instance
 *
 * @public
 */
const initTinySynq = config => {
  const {
    tables,
    preInit,
    postInit,
    logOptions,
    debug
  } = config;
  if (!(tables != null && tables.length)) throw new Error('Syncable table data required');
  const log = new tslog.Logger({
    name: 'tinysync-setup',
    ...logOptions
  });
  const ts = new TinySynq(config);
  const getRecordMetaInsertQuery = ({
    table,
    remove = false
  }) => {
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
  };
  const getChangeUpdateQuery = ({
    table,
    remove = false
  }) => {
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
  };
  const setupTriggersForTable = ({
    table
  }) => {
    log.debug('Setting up triggers for', table.name);
    // Template for inserting the new value as JSON in the `*_changes` table.
    const jsonObject = ts.runQuery({
      sql: `
      SELECT 'json_object(' || GROUP_CONCAT('''' || name || ''', NEW.' || name, ',') || ')' AS jo
      FROM pragma_table_info('${table.name}');`
    })[0];
    const oldJsonObject = jsonObject.jo.replace(/NEW/g, 'OLD');
    log.silly('@jsonObject', JSON.stringify(jsonObject, null, 2));
    /**
     * These triggers run for changes originating locally. They are disabled
     * when remote changes are being applied (`triggers_on` in `*_meta` table).
     */
    // Ensure triggers are up to date
    ts.run({
      sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_after_insert_${table.name}`
    });
    ts.run({
      sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_after_update_${table.name}`
    });
    ts.run({
      sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_after_delete_${table.name}`
    });
    const insertTriggerSql = `
      CREATE TRIGGER IF NOT EXISTS ${ts.synqPrefix}_after_insert_${table.name}
      AFTER INSERT ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${ts.synqPrefix}_meta WHERE meta_name = 'triggers_on')='1'
      BEGIN
        INSERT INTO ${ts.synqPrefix}_changes (table_name, row_id, operation, data)
        VALUES ('${table.name}', NEW.${table.id}, 'INSERT', ${jsonObject.jo});

        ${getRecordMetaInsertQuery({
      table
    })}

        ${getChangeUpdateQuery({
      table
    })}
      END;`;
    ts.run({
      sql: insertTriggerSql
    });
    const updateTriggerSql = `
      CREATE TRIGGER IF NOT EXISTS ${ts.synqPrefix}_after_update_${table.name}
      AFTER UPDATE ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${ts.synqPrefix}_meta WHERE meta_name = 'triggers_on')='1'
      BEGIN
        ${getUpdateTriggerDiffQuery({
      ts,
      table
    })}

        ${getRecordMetaInsertQuery({
      table
    })}

        ${getChangeUpdateQuery({
      table
    })}
      END;`;
    ts.run({
      sql: updateTriggerSql
    });
    /*
    Stores current record as JSON in `data` column as is done for INSERTs.
    This will act as a "tombstone" record in case of update-after-delete.
         Restoration will involve checking for a DELETE change for the table/row_id
    and reinserting it if it exists, then applying the incoming update. Finally,
    a record is added to `*_notice` informing of the resurrection.
    */
    const deleteTriggerSql = `
      CREATE TRIGGER IF NOT EXISTS ${ts.synqPrefix}_after_delete_${table.name}
      AFTER DELETE ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${ts.synqPrefix}_meta WHERE meta_name = 'triggers_on')='1'
      BEGIN
        INSERT INTO ${ts.synqPrefix}_changes (table_name, row_id, operation, data)
        VALUES ('${table.name}', OLD.${table.id}, 'DELETE', ${oldJsonObject});
        
        ${getRecordMetaInsertQuery({
      table,
      remove: true
    })}

        ${getChangeUpdateQuery({
      table,
      remove: true
    })}
      END;`;
    ts.run({
      sql: deleteTriggerSql
    });
    /**
     * All the triggers below will only be executed if `meta_name="debug_on"`
     * has the `meta_value=1` in the *_meta table, regardless of `triggers_on`.
     */
    // Remove previous versions
    ts.run({
      sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_dump_after_insert_${table.name}`
    });
    ts.run({
      sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_dump_after_update_${table.name}`
    });
    ts.run({
      sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_dump_after_delete_${table.name}`
    });
    ts.run({
      sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_dump_before_insert_record_meta`
    });
    ts.run({
      sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_dump_after_insert_record_meta`
    });
    ts.run({
      sql: `DROP TRIGGER IF EXISTS ${ts.synqPrefix}_dump_after_update_record_meta`
    });
    /**
     * @Debugging Do not remove
     * These triggers allow a rudimentary tracing of DB actions on the synced tables.
     */
    ts.run({
      sql: `
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
      sql: `
      CREATE TRIGGER IF NOT EXISTS ${ts.synqPrefix}_dump_after_update_${table.name}
      AFTER UPDATE ON ${table.name}
      FOR EACH ROW
      WHEN (SELECT meta_value FROM ${ts.synqPrefix}_meta WHERE meta_name = 'debug_on')='1'
      BEGIN
        INSERT INTO ${ts.synqPrefix}_dump (table_name, operation, data) VALUES ('${table.name}', 'UPDATE', ${jsonObject.jo});
      END;`
    });
    ts.run({
      sql: `
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
      sql: `
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
      sql: `
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
      sql: `
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
  };
  // Create a change-tracking table and index
  ts.run({
    sql: `
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
    sql: `CREATE INDEX IF NOT EXISTS ${ts.synqPrefix}_change_modified_idx ON ${ts.synqPrefix}_changes(modified)`
  });
  ts.run({
    sql: `CREATE INDEX IF NOT EXISTS ${ts.synqPrefix}_change_table_row_idx ON ${ts.synqPrefix}_changes(table_name, row_id)`
  });
  // Change *_pending is essentially a clone of *_changes used to hold items that
  // cannot be applied yet because intermediate/preceding changes haven't been received.
  ts.run({
    sql: `
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
    sql: `CREATE INDEX IF NOT EXISTS ${ts.synqPrefix}_pending_table_row_idx ON ${ts.synqPrefix}_pending(table_name, row_id)`
  });
  // Create a notice table
  ts.run({
    sql: `
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
    sql: `
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
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS ${ts.synqPrefix}_record_meta_idx ON ${ts.synqPrefix}_record_meta(table_name, row_id)`
  });
  // @TODO: These may actually need to be compound indexes; need to evaluate queries.
  ts.run({
    sql: `CREATE INDEX IF NOT EXISTS ${ts.synqPrefix}_record_meta_source_idx ON ${ts.synqPrefix}_record_meta(source)`
  });
  ts.run({
    sql: `CREATE INDEX IF NOT EXISTS ${ts.synqPrefix}_record_meta_modified_idx ON ${ts.synqPrefix}_record_meta(modified)`
  });
  // Create meta table
  ts.run({
    sql: `
    CREATE TABLE IF NOT EXISTS ${ts.synqPrefix}_meta (
      meta_name TEXT NOT NULL PRIMARY KEY,
      meta_value TEXT NOT NULL
    );
  `
  });
  ts.run({
    sql: `
    CREATE TABLE IF NOT EXISTS ${ts.synqPrefix}_dump (
      created TIMESTAMP DATETIME DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), 
      table_name TEXT NOT NULL,
      operation TEXT,
      data BLOB
    );
  `
  });
  ts.run({
    sql: `CREATE INDEX IF NOT EXISTS ${ts.synqPrefix}_meta_name_idx ON ${ts.synqPrefix}_meta(meta_name)`
  });
  // Enable debug mode
  if (debug) ts.enableDebug();
  // Set the device ID
  ts.setDeviceId();
  // Run pre-initialisation queries
  if (preInit != null && preInit.length) {
    for (const preInitQuery of preInit) {
      try {
        log.debug(`\n@@@ preInit\n${preInitQuery}\n@@@`);
        ts.run({
          sql: preInitQuery
        });
      } catch (err) {
        log.error('@preInit', err);
      }
    }
  }
  log.debug(`@${ts.synqPrefix}_meta`, ts.runQuery({
    sql: `SELECT * FROM pragma_table_info('${ts.synqPrefix}_meta')`
  }));
  log.debug(`@SIMPLE_SELECT`, ts.runQuery({
    sql: `SELECT '@@@ that was easy @@@'`
  }));
  for (const table of tables) {
    // Check table exists
    const exists = ts.runQuery({
      sql: `SELECT * FROM pragma_table_info('${table.name}')`
    });
    if (!(exists != null && exists.length)) throw new Error(`${table.name} doesn't exist`);
    log.debug('Setting up', table.name, table.id);
    setupTriggersForTable({
      table
    });
    ts.tablesReady();
  }
  if (postInit != null && postInit.length) {
    for (const postInitQuery of postInit) {
      log.warn(`@@@\npostInit\n${postInitQuery}\n@@@`);
      const result = ts.run({
        sql: postInitQuery
      });
      log.trace(`@@@ postInit RESULT\n`, result);
    }
  }
  return ts;
};

let server;
function arrayBufferToString(arrBuff) {
  return Buffer.from(arrBuff).toString();
}
const app = uWS__namespace.App();
// @TODO: request IDs
app.ws('/*', {
  compression: uWS__namespace.SHARED_COMPRESSOR,
  maxPayloadLength: 16 * 1024 * 1024,
  idleTimeout: 120,
  sendPingsAutomatically: true,
  open: ws => {
    const addr = arrayBufferToString(ws.getRemoteAddressAsText());
    app.log.warn('@Connected!', addr);
    ws.subscribe('broadcast');
  },
  message: (ws, message, isBinary) => {
    const addr = arrayBufferToString(ws.getRemoteAddressAsText());
    const messageString = arrayBufferToString(message);
    const parsed = JSON.parse(messageString);
    const {
      requestId
    } = parsed;
    app.log.debug('@Message!', parsed.changes, app.ts.deviceId);
    try {
      switch (parsed.type) {
        case SyncRequestType.push:
          if (!parsed.source) {
            app.log.error('INVALID_SOURCE', {
              parsed
            });
            throw new Error('Invalid source');
          }
          const incoming = parsed.changes.map(c => {
            c.source = parsed.source;
            delete c.mod;
            //c.vclock = JSON.parse(c.vclock);
            return c;
          });
          console.debug('\n<<<< INCOMING >>>>\n', incoming);
          app.ts.applyChangesToLocalDB({
            changes: incoming
          });
          ws.send(JSON.stringify({
            type: SyncResponseType.ack,
            requestId
          }));
          ws.publish('broadcast', JSON.stringify({
            changes: incoming
          }), false);
          break;
        case SyncRequestType.pull:
          // @TODO: Eh? Didn't I work this out already?
          const changes = app.ts.getFilteredChanges();
          app.log.debug('@pull: outgoing:', changes);
          ws.send(JSON.stringify({
            type: SyncResponseType.ack,
            requestId,
            changes
          }));
          break;
        default:
          throw new Error('Invalid request type:', parsed.type);
      }
    } catch (err) {
      app.log.error(err, {
        addr,
        for: JSON.stringify(parsed)
      });
      ws.send(JSON.stringify({
        type: SyncResponseType.nack,
        requestId: parsed.requestId,
        message: err.message
      }));
    }
  }
});
const startTinySynqServer = params => {
  const port = params.port || Number(env.TINYSYNQ_WS_PORT) || 7174;
  app.ts = params.ts;
  app.log = new tslog.Logger({
    name: 'tinysynq-node-ws',
    minLevel: params.logOptions.minLevel || Number(env.TINYSYNQ_LOG_LEVEL) || LogLevel.Info,
    type: env.TINYSYNQ_LOG_FORMAT || 'json',
    ...(params.logOptions || {})
  });
  server = app.listen(port, token => {
    if (token) {
      app.log.info(`TinySynq server listening on port ${port} from thread ${worker_threads.threadId}`);
    } else {
      app.log.error(`Failed to listen on port ${port} from thread ${worker_threads.threadId}`);
    }
  });
  return server;
};

var index = {
  startTinySynqServer,
  initTinySynq: initTinySynq
};

module.exports = index;
//# sourceMappingURL=tinysynq.cjs.map
