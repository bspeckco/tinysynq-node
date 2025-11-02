import lib from './lib/index.js';
import { startTinySynqServer } from './lib/server.js';

export default { startTinySynqServer, initTinySynq: lib };

export type { 
  BetterSqlite3Instance,
} from './lib/types.js';

export type {
  SyncableTable,
  TinySynqOptions,
  GetTableIdColumnParams,
  Change,
  QueryParams,
} from '@bspeckco/tinysynq-lib';

export {
  TinySynq,
} from './lib/tinysynq.class.js';
