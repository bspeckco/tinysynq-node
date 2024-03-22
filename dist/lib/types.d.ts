import BetterSqlite3 from 'better-sqlite3';
import { ISettingsParam, ILogObj } from 'tslog';
/**
 * A {@link https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md | BetterSqlite3} instance.
 *
 * @public
 */
export type BetterSqlite3Instance = BetterSqlite3.Database;
/**
 * Provided to TinySynq constructor.
 *
 * @public
 */
export interface SyncableTable {
    /**
     * Table name.
     */
    name: string;
    /**
     * Row identifier; typically the column used as primary key.
     */
    id: string;
    /**
     * Columns that can be updated by a sync-based change.
     */
    editable: string[];
}
/**
 * Base options for TinySynq constructor.
 *
 * @public
 */
export interface TinySynqOptionsBase {
    /**
     * A BetterSqlite3 instance.
     *
     * @remarks
     *
     * If not provided, {@link TinySynqOptionsBase.filePath} must be set.
     *
     */
    sqlite3?: BetterSqlite3Instance;
    /**
     * Path to SQLite3 database file.
     *
     * @remarks
     * If not provided, {@link TinySynqOptionsBase.sqlite3} must be set.
     */
    filePath?: string;
    /**
     * Prefix to use for TinySynq tables (trailing underscores will be removed).
     */
    prefix: string;
    /**
     * Tables that should be synced between devices.
     */
    tables: SyncableTable[];
    /**
     * Maximum number of changes to process at once.
     */
    batchSize?: number;
    /**
     * Enable or disable WAL mode.
     */
    wal?: boolean;
    /**
     * Array of queries to run before TinySynq's change tracking is configured.
     *
     * @remarks
     * Include create statements for syncable tables here.
     */
    preInit?: string[];
    /**
     * Array of queries to run after TinySynq's change tracking is configured
     *
     * @remarks
     * You might place any insert queries here.
     */
    postInit?: string[];
    /**
     * Configure logging options.
     *
     * @remarks
     * TinySynq uses TSLog for logging. All optiions are passed directly to it.
     * See https://tslog.js.org/#/?id=settings for details
     */
    logOptions?: ISettingsParam<ILogObj>;
    /**
     * Enable/disable debug mode
     *
     * When enabled, all INSERT/UPDATE/DELETE actions on syncable tables are written
     * to the *_dump table for inspection.
     */
    debug?: boolean;
}
/**
 * Constructor options TinySynq instance.
 *
 * Provide either an existing {@link https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md | BetterSqlite3} instance (`sqlite3`) or the `filePath`.
 *
 * @public
 */
export interface TinySynqOptionsWithInstance extends TinySynqOptionsBase {
    /**
     * A BetterSqlite3 instance.
     */
    sqlite3: BetterSqlite3Instance;
}
export interface TinySynqOptionsWithFilePath extends TinySynqOptionsBase {
    /**
     * Path to SQLite3 database file.
     */
    filePath: string;
}
/**
 * {@inheritdoc TinySynqOptionsBase}
 *
 * @public
 */
export type TinySynqOptions = TinySynqOptionsWithInstance | TinySynqOptionsWithFilePath;
export type SQLite3 = any;
/**
 * Basic query params for methods that read from/write to DB.
 *
 * @public
 */
export type QueryParams = {
    sql: string;
    values?: any;
};
/**
 * Table name and row parameters for retrieving data for a specific record.
 */
export interface TableNameRowParams {
    table_name: string;
    row_id: string;
}
export interface ApplyChangeParams {
    change: Change;
    restore?: boolean;
    savepoint: string;
}
export interface MetaRowData {
    meta_name: string;
    meta_value: string;
}
export type VClock = {
    [deviceId: string]: number;
};
export declare enum TinySynqOperation {
    'INSERT' = "INSERT",
    'UPDATE' = "UPDATE",
    'DELETE' = "DELETE"
}
/**
 * Object transferred between devices to convey individual record changes.
 *
 * @public
 */
export interface Change {
    /**
     * Change record ID from central server.
     */
    id?: number;
    /**
     * Table name of the record that was modified.
     */
    table_name: string;
    /**
     * Row ID of the record that was modified.
     */
    row_id: string;
    /**
     * The type of operation that took place.
     */
    operation: keyof typeof TinySynqOperation;
    /**
     * The serialised object in the post-modified state.
     */
    data: string;
    /**
     * Vector Clock holding all device values for the record, as known by the source device of the change.
     */
    vclock: VClock;
    /**
     * Device ID from which the change originated.
     */
    source: string;
    /**
     * An ISO8601 formatted date and time that the change was recorded on the source device.
     */
    modified: string;
}
interface BaseLatestChangesOptions {
    /**
     * A device ID whose changes should be excluded from retrieval (usually the requester).
     */
    exclude?: string;
    since?: string;
    checkpoint?: number;
}
interface LatestChangesWithSince extends BaseLatestChangesOptions {
    /**
     * An ISO8601 date string. Providing this will limit retrieved changes to this date/time onwards.
     */
    since: string;
}
interface LatestChangesWithCheckpoint extends BaseLatestChangesOptions {
    /**
     * A server-specific change ID.
     *
     * @remarks
     *
     * When provided it will limit retrieved changes to those _after_ the specified change ID.
     * The change ID is specific to the hub/root server (of which there should be only one).
     */
    checkpoint: number;
}
export type LatestChangesOptions = LatestChangesWithSince | LatestChangesWithCheckpoint;
export declare enum SyncRequestType {
    push = "push",
    pull = "pull"
}
export declare enum SyncResponseType {
    ack = "ack",
    nack = "nack"
}
export declare enum LogLevel {
    Silly = 0,
    Trace = 1,
    Debug = 2,
    Info = 3,
    Warn = 4,
    Error = 5,
    Fatal = 6
}
export {};
//# sourceMappingURL=types.d.ts.map