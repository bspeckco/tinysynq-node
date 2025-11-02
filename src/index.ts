import initTinySynq from './lib/index.js';
import { startTinySynqServer } from './lib/server.js';

export { initTinySynq, startTinySynqServer };

export default { startTinySynqServer, initTinySynq };

export type { 
  BetterSqlite3Instance,
} from './lib/types.js';

export type {
  SocketRequestType,
  TSServerParams,
  TSSocketRequestParams,
  TinySynqServerControl,
} from './lib/server.js';

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
