import { env } from './env.js';
import * as uWS from 'uWebSockets.js';
import { threadId } from 'worker_threads';
import { TinySynq } from './tinysynq.class.js';
import { LogLevel, SyncRequestType, SyncResponseType } from './types.js';
import { ILogObj, ISettingsParam, Logger } from 'tslog';

interface TSTemplatedApp extends uWS.TemplatedApp {
  ts: TinySynq,
  log: Logger<ILogObj>
}

export interface TSServerParams {
  ts: TinySynq,
  port?: number;
  logOptions: ISettingsParam<ILogObj>
}

let server;

function arrayBufferToString(arrBuff: ArrayBuffer): string {
  return Buffer.from(arrBuff).toString();
} 

const app = uWS.App() as TSTemplatedApp;

// @TODO: request IDs

app.ws('/*', {
  compression: uWS.SHARED_COMPRESSOR,
  maxPayloadLength: 16 * 1024 * 1024, // 16MB
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
    const { requestId } = parsed;
    app.log.debug('@Message!', parsed.changes, app.ts.deviceId);
    try {
      switch(parsed.type) {
        case SyncRequestType.push:
          if (!parsed.source) {
            app.log.error('INVALID_SOURCE', {parsed});
            throw new Error('Invalid source');
          }  
          const incoming = parsed.changes.map((c: any) => {
            c.source = parsed.source
            delete c.mod;
            //c.vclock = JSON.parse(c.vclock);
            return c;
          });
          console.debug('\n<<<< INCOMING >>>>\n', incoming);
          app.ts.applyChangesToLocalDB({changes: incoming});
          ws.send(JSON.stringify({type: SyncResponseType.ack, requestId}));
          ws.publish('broadcast', JSON.stringify({changes: incoming}), false);
          break;
        case SyncRequestType.pull:
          // @TODO: Eh? Didn't I work this out already?
          const changes = app.ts.getFilteredChanges();
          app.log.debug('@pull: outgoing:', changes);
          ws.send(JSON.stringify({type: SyncResponseType.ack, requestId, changes}));
          break;
        default:
          throw new Error('Invalid request type:', parsed.type);
      }
      
    }
    catch(err: any) {
      app.log.error(err, {addr, for: JSON.stringify(parsed)});
      ws.send(JSON.stringify({
        type: SyncResponseType.nack,
        requestId: parsed.requestId,
        message: err.message
      }));
    }
  },
});

export const startTinySynqServer = (params: TSServerParams) => {
  const port = params.port || Number(env.TINYSYNQ_WS_PORT) || 7174;
  app.ts = params.ts;
  app.log = new Logger({
    name:'tinysynq-node-ws',
    minLevel: params.logOptions.minLevel || Number(env.TINYSYNQ_LOG_LEVEL) || LogLevel.Info,
    type: env.TINYSYNQ_LOG_FORMAT || 'json',
    ...(params.logOptions || {})
  });
  server = app.listen(port, token => {
    if (token) {
      app.log.info(`TinySynq server listening on port ${port} from thread ${threadId}`);
    }
    else {
      app.log.error(`Failed to listen on port ${port} from thread ${threadId}`);
    }
  });
  return server;
}