import { ISettingsParam, ILogObj } from 'tslog';

export type SyncableTable = {
  name: string;
  id: string;
  editable: string[];
}

export type SynQLiteOptionsBase = {
  sqlite3?: SQLiteWASM;
  filename?: string;
  prefix: string;
  tables: SyncableTable[];
  batchSize?: number;
  wal?: boolean;
  preInit?: string[];
  postInit?: string[];
  logOptions?: ISettingsParam<ILogObj>;
  debug?: boolean;
}

export type SynQLiteOptions = SynQLiteOptionsBase & (
  {
    sqlite3: any;
  } | {
    filename: string;
  }
)

export type SQLiteWASM = any

// @TODO: create types for WASM SQLite3 instance?
export type Database = { }

export type SynqlDatabase = Database & {
  synqPrefix?: string;
  synqTables?: SyncableTable[];
  synqBatchSize: number;
  utils: {
    utcNowAsISO8601: () => string;
    strtimeAsISO8601: string;
  }
  [key: string]: any;
}

export interface SynQLiteInterface {
  db: SQLiteWASM;
  dbName: string;
  synqDbId?: string;
  synqPrefix?: string;
  synqTables?: SyncableTable[];
  synqBatchSize: number;
  wal: boolean;
  utils: {
    utcNowAsISO8601: () => string;
    strtimeAsISO8601: string;
  };
  init(): Promise<SynQLiteInterface>;
  runQuery<T>(queryData: {sql: string, values?: any[]}): Promise<T>;
  getLastSync: Promise<MetaRowData>;
  getChangesSinceLastSync(data: {db: SQLiteWASM, lastSync?: string}): Promise<Change[]>;
  beginTransaction(): Promise<string>;
  commitTransaction({savepoint}: {savepoint: string}): Promise<any>;
  rollbackTransaction({savepoint}: {savepoint: string}): Promise<any>;
  // applyChange(data: ApplyChangeParams): Promise<any>;
  applyChangesToLocalDB(changes: Change[]): Promise<any>;
  setupTriggersForTable(data: {table: SyncableTable}): Promise<any>;
}

export type ApplyChangeParams = {
  change: Change,
  restore?: boolean,
  savepoint: string
}

export type MetaRowData = {
  meta_name: string;
  meta_value: string;
}

export type VClock = {
  [deviceId: string]: number;
}

export type Change = {
  id: number;
  table_name: string;
  row_id: string;
  operation: string;
  data: string; // JSON string
  vclock: VClock;
  modified: string;
}

export enum LogLevel {
  Silly,
  Trace,
  Debug,
  Info,
  Warn,
  Error,
  Fatal
};