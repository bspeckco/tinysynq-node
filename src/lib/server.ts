import { env } from './env.js';
import * as uWS from 'uWebSockets.js';
import { threadId } from 'worker_threads';
import { TinySynq } from './tinysynq.class.js';
import { LogLevel, SyncRequestType, SyncResponseType } from './types.js';
import { Logger } from 'tslog';

const log = new Logger({
  name:'tinysynq-node-ws',
  minLevel: Number(env.TINYSYNQ_LOG_LEVEL) || LogLevel.Info,
  type: env.TINYSYNQ_LOG_FORMAT || 'json'
});

interface TSTemplatedApp extends uWS.TemplatedApp {
  ts: TinySynq
}

let server;

function arrayBufferToString(arrBuff: ArrayBuffer): string {
  return Buffer.from(arrBuff).toString();
} 

const app = uWS.App() as TSTemplatedApp;
const port = Number(process.env.TINYSYNQ_PORT || 7174);

// @TODO: request IDs

app.ws('/*', {
  compression: uWS.SHARED_COMPRESSOR,
  maxPayloadLength: 16 * 1024 * 1024, // 16MB
  idleTimeout: 120,
  sendPingsAutomatically: true,
  open: ws => {
    const addr = arrayBufferToString(ws.getRemoteAddressAsText());
    log.warn('@Connected!', addr);
  },
  message: (ws, message, isBinary) => {
    const messageString = arrayBufferToString(message);
    const parsed = JSON.parse(messageString);
    log.debug('@Message!', parsed.changes, app.ts.deviceId);
    try {
      switch(parsed.type) {
        case SyncRequestType.push:
          if (!parsed.source) {
            log.error('INVALID_SOURCE', {parsed});
            throw new Error('Invalid source');
          }  
          const incoming = parsed.changes.map((c: any) => {
            c.source = parsed.source
            delete c.mod;
            return c;
          });
          console.debug('\n<<<< INCOMING >>>>\n', incoming);
          app.ts.applyChangesToLocalDB({changes: incoming});
          break;
        case SyncRequestType.pull:
          // @TODO: Eh? Didn't I work this out already?
          const outgoing = app.ts.getChangesSinceLastSync();
          log.debug('@pull', outgoing);
          break;
        default:
          throw new Error('Invalid request type:', parsed.type);
      }
      ws.send(JSON.stringify({type: SyncResponseType.ack}));
    }
    catch(err: any) {
      console.error(err, {for: JSON.stringify(parsed)});
      ws.send(JSON.stringify({type: SyncResponseType.nack, message: err.message}));
    }
  },
});

export const startTinySynqServer = (ts: TinySynq) => {
  app.ts = ts;
  server = app.listen(port, token => {
    if (token) {
      console.log('TinySynq server listening on port', port, 'from thread', threadId);
    }
    else {
      console.log('Failed to listen on port', port, 'from thread', threadId);
    }
  });
  return server;
}