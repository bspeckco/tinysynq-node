import { env } from './env.js';
import * as uWS from 'uWebSockets.js';
import { threadId } from 'worker_threads';
import { TinySynq } from './tinysynq.class.js';
import { Change, LogLevel, SyncRequestType, SyncResponseType } from '@bspeckco/tinysynq-lib';
import { ILogObj, ISettingsParam, Logger } from 'tslog';

interface TSTemplatedApp extends uWS.TemplatedApp {
  ts: TinySynq;
  log: Logger<ILogObj>;
  auth?: (req: uWS.HttpRequest) => Promise<boolean | Record<string, any>>;
}

export type SocketRequestType = 'push' | 'pull'

export interface TSServerParams {
  ts: TinySynq,
  port?: number;
  logOptions: ISettingsParam<ILogObj>;
  auth?: (req: uWS.HttpRequest) => Promise<boolean | Record<string, any>>;
}

export interface TSSocketRequestParams {
  changes?: Change[];
  requestId?: string;
  source?: string;
  type: SocketRequestType;
  since: string;            // datetime of last change
  checkpoint: number;       // ID of last change
}

let server;

function arrayBufferToString(arrBuff: ArrayBuffer): string {
  return Buffer.from(arrBuff).toString();
} 

const app = uWS.App() as TSTemplatedApp;

app.ws('/*', {
  compression: uWS.SHARED_COMPRESSOR,
  maxPayloadLength: 16 * 1024 * 1024, // 16MB
  idleTimeout: 120,
  sendPingsAutomatically: true,
  upgrade: async (res, req, context) => {
    const secWebSocketKey = req.getHeader('sec-websocket-key');
    const secWebSocketProtocol = req.getHeader('sec-websocket-protocol');
    const secWebSocketExtensions = req.getHeader('sec-websocket-extensions');
    const remoteAddress = arrayBufferToString(res.getRemoteAddressAsText());

    let userData: Record<string, any> = { remoteAddress }; // Include remote address in userData by default

    try {
      if (app.auth) {
        app.log.debug(`Performing auth for ${remoteAddress}`);
        const authResult = await app.auth(req);

        if (authResult === true) {
          // Auth successful (simple boolean success)
          app.log.debug(`Auth successful (true) for ${remoteAddress}`);
        } else if (typeof authResult === 'object' && authResult !== null) {
          // Auth successful (with user data)
          userData = { ...userData, ...authResult }; // Merge auth result object into userData
          app.log.debug(`Auth successful (object) for ${remoteAddress}`, userData);
        } else {
          // Auth failed (includes false, undefined, null, numbers, strings, etc.)
          app.log.warn(`Auth failed (result was ${JSON.stringify(authResult)}) for ${remoteAddress}`);
          res.writeStatus('401 Unauthorized').end();
          return;
        }

      } else {
        app.log.trace(`No auth function configured, allowing connection for ${remoteAddress}`);
      }

      // Upgrade the connection, passing userData
      res.upgrade(
        { userData }, // Pass the userData object
        secWebSocketKey,
        secWebSocketProtocol,
        secWebSocketExtensions,
        context
      );
    } catch (err: any) {
      app.log.error(`Auth error for ${remoteAddress}: ${err.message}`);
      // Ensure response is ended in case of error during auth
      // Use writeStatus before end for proper HTTP response
      res.writeStatus('500 Internal Server Error').end();
    }
  },
  open: ws => {
    const userData = ws.getUserData(); // Retrieve userData passed from upgrade
    app.log.warn('@Connected!', userData); // Log userData on connect
    ws.subscribe('broadcast');
  },
  message: (ws, message, isBinary) => {
    const addr = arrayBufferToString(ws.getRemoteAddressAsText());
    const messageString = arrayBufferToString(message);
    const parsed = JSON.parse(messageString) as TSSocketRequestParams;
    const { requestId } = parsed;
    app.log.trace('@parsed', parsed);
    app.log.debug('@Message!', parsed.changes, app.ts.deviceId);
    try {
      switch(parsed.type) {
        case SyncRequestType.push:
          if (!parsed.source) {
            app.log.error('INVALID_SOURCE', {parsed});
            throw new Error('Invalid source');
          }  
          const incoming = parsed.changes?.map((c: any) => {
            c.source = parsed.source;
            delete c.mod;
            return c as Change;
          }) || [];
          app.log.debug('\n<<<< INCOMING >>>>\n', incoming);
          app.ts.applyChangesToLocalDB({changes: incoming});
          ws.send(JSON.stringify({type: SyncResponseType.ack, requestId}));
          ws.publish('broadcast', JSON.stringify({changes: incoming}), false);
          break;
        case SyncRequestType.pull:
          // @TODO: Eh? Didn't I work this out already?
          const params = { ...parsed } as any;
          delete params?.type;
          const changes = app.ts.getFilteredChanges(parsed);
          app.log.debug('@pull: outgoing:', changes);
          ws.send(JSON.stringify({type: SyncResponseType.ack, requestId, changes}));
          break;
        default:
          throw new Error(`Invalid request type: '${parsed.type}'`);
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

// Define the return type for the start function
export interface TinySynqServerControl {
  app: TSTemplatedApp;
  close: () => void;
}

export const startTinySynqServer = (params: TSServerParams): TinySynqServerControl => {
  let listenSocket: uWS.us_listen_socket | null = null;
  const port = params.port || Number(env.TINYSYNQ_WS_PORT) || 7174;
  app.ts = params.ts;
  app.auth = params.auth;
  app.log = new Logger({
    name:'tinysynq-node-ws',
    minLevel: params.logOptions.minLevel || Number(env.TINYSYNQ_LOG_LEVEL) || LogLevel.Info,
    type: env.TINYSYNQ_LOG_FORMAT || 'json',
    ...(params.logOptions || {})
  });

  app.listen(port, socket => {
    listenSocket = socket; // Store the socket
    if (listenSocket) {
      app.log.info(`TinySynq server listening on port ${port} from thread ${threadId}`);
    } else {
      app.log.error(`Failed to listen on port ${port} from thread ${threadId}`);
    }
  });

  // Return the app instance and a close function
  return {
    app,
    close: () => {
      if (listenSocket) {
        app.log.info(`Closing server socket on port ${port}`);
        uWS.us_listen_socket_close(listenSocket);
        listenSocket = null; // Prevent double closing
      } else {
        app.log.warn(`Attempted to close server, but socket was not listening or already closed.`);
      }
    }
  };
}
