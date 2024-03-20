import lib from './lib/index.js';
import { startTinySynqServer } from './lib/server.js';

export default { startTinySynqServer, initTinySynq: lib };

export type { 
  SyncableTable,
  TinySynqOptions,
  TinySynqOptionsBase,
  Change,
  QueryParams,
  BetterSqlite3Instance,
} from './lib/types.js';

export type {
  TinySynq,
  GetTableIdColumnParams,
} from './lib/tinysynq.class.js';