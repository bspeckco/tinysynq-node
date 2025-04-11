import { env } from './env.js';
import * as uWS from 'uWebSockets.js';
import { threadId } from 'worker_threads';
import { TinySynq } from './tinysynq.class.js';
import { Change, LogLevel, SyncRequestType, SyncResponseType } from '@bspeckco/tinysynq-lib';
import { ILogObj, ISettingsParam, Logger } from 'tslog';

// --- Core Types ---

interface TSTemplatedApp extends uWS.TemplatedApp {
  ts: TinySynq;
  log: Logger<ILogObj>;
  auth?: (req: uWS.HttpRequest) => Promise<boolean | Record<string, any>>;
}

export type SocketRequestType = SyncRequestType; 

export interface TSServerParams {
  ts: TinySynq;
  port?: number;
  logOptions: ISettingsParam<ILogObj>;
  auth?: (req: uWS.HttpRequest) => Promise<boolean | Record<string, any>>; // Handles auth during upgrade (headers/cookies)
}

// Represents incoming push/pull requests (from tinysynq-lib)
export interface TSSocketRequestParams {
  changes?: Change[];
  requestId?: string;
  source?: string;
  type: SyncRequestType; // From lib (push/pull)
  since: string;
  checkpoint: number;
}

// User data attached to each WebSocket connection
interface WebSocketUserData {
  remoteAddress: string;
  // No longer need isAuthenticated flag
  [key: string]: any; // Allow storing arbitrary data from auth functions
}

let server;

function arrayBufferToString(arrBuff: ArrayBuffer): string {
  return Buffer.from(arrBuff).toString();
} 

const app = uWS.App({}) as TSTemplatedApp;

app.ws<WebSocketUserData>('/*', { // Specify UserData type here
  compression: uWS.SHARED_COMPRESSOR,
  maxPayloadLength: 16 * 1024 * 1024,
  idleTimeout: 120,
  sendPingsAutomatically: true,

  upgrade: async (res, req, context) => {
    const secWebSocketKey = req.getHeader('sec-websocket-key');
    const secWebSocketProtocol = req.getHeader('sec-websocket-protocol');
    const secWebSocketExtensions = req.getHeader('sec-websocket-extensions');
    const remoteAddress = arrayBufferToString(res.getRemoteAddressAsText());

    let userData: WebSocketUserData = { remoteAddress }; // Base user data
    
    try {
      if (app.auth) {
        // Perform authentication using the provided auth function
        app.log.debug(`Performing auth for ${remoteAddress}`);
        const authResult = await app.auth(req);

        if (authResult === true) {
          app.log.debug(`Auth successful (true) for ${remoteAddress}`);
          // Proceed to upgrade, userData only contains remoteAddress unless modified by auth fn later
        } else if (typeof authResult === 'object' && authResult !== null) {
          app.log.debug(`Auth successful (object) for ${remoteAddress}`, authResult);
          // Merge returned user data
          Object.assign(userData, authResult);
        } else {
          // Auth failed (false, null, undefined, etc.)
          app.log.warn(`Auth failed for ${remoteAddress} (result: ${JSON.stringify(authResult)}), denying connection.`);
          res.writeStatus('401 Unauthorized').end();
          return; // Stop processing
        }
      } else {
        // No auth function configured, allow connection
        app.log.trace(`No auth configured, allowing connection for ${remoteAddress}`);
      }

      // If we reach here, authentication passed or was not required.
      app.log.debug(`Upgrading connection for ${remoteAddress}, userData:`, userData);
      res.upgrade(
        userData,
        secWebSocketKey,
        secWebSocketProtocol,
        secWebSocketExtensions,
        context
      );

    } catch (err: any) {
      // Error during auth function execution
      app.log.error(`Auth error during upgrade for ${remoteAddress}: ${err.message}`);
      res.writeStatus('500 Internal Server Error').end();
    }
  },

  open: (ws) => {
    const userData = ws.getUserData();
    app.log.warn('@Connected!', userData);
    ws.subscribe('broadcast');
  },

  message: async (ws, message, isBinary) => {
    const userData = ws.getUserData();
    const remoteAddress = userData.remoteAddress;
    let parsed: any;

    try {
      // Ensure message is parsed safely
      try {
        const messageString = arrayBufferToString(message);
        parsed = JSON.parse(messageString);
      } catch (parseError: any) {
        app.log.warn(`Failed to parse message from ${remoteAddress}: ${parseError.message}`);
        ws.close(); // Close connection on parse error
        return;
      }

      app.log.trace(`Raw message from ${remoteAddress}:`, parsed);

      // --- Handle Authenticated Connections (All connections are considered authenticated here) ---
      // Ensure the message type is a valid SyncRequestType before proceeding
      if (typeof parsed.type !== 'string' || !(Object.values(SyncRequestType).includes(parsed.type as SyncRequestType))) {
          app.log.warn('INVALID_MESSAGE_TYPE received', { parsed, remoteAddress });
          ws.send(JSON.stringify({ type: SyncResponseType.nack, requestId: parsed?.requestId, message: `Invalid message type: ${parsed?.type}` }));
          return;
      }

      const syncRequestParams = parsed as TSSocketRequestParams;
      const { requestId } = syncRequestParams;
      app.log.debug(`@Message (${remoteAddress})!`, syncRequestParams.changes, app.ts.deviceId);

      switch(syncRequestParams.type) {
        case SyncRequestType.push:
          if (!syncRequestParams.source) {
            app.log.error('INVALID_SOURCE', {parsed: syncRequestParams, remoteAddress});
            throw new Error('Invalid source');
          }  
          const incoming = syncRequestParams.changes?.map((c: any) => {
            c.source = syncRequestParams.source;
            delete c.mod;
            return c as Change;
          }) || [];
          app.log.debug('\n<<<< INCOMING >>>>\n', incoming);
          await app.ts.applyChangesToLocalDB({changes: incoming}); 
          ws.send(JSON.stringify({type: SyncResponseType.ack, requestId}));
          ws.publish('broadcast', JSON.stringify({changes: incoming}), false);
          break;
        case SyncRequestType.pull:
          const params = { ...syncRequestParams } as any;
          delete params?.type;
          const changes = await app.ts.getFilteredChanges(syncRequestParams); 
          app.log.debug('@pull: outgoing:', changes);
          ws.send(JSON.stringify({type: SyncResponseType.ack, requestId, changes}));
          break;
        default:
          throw new Error(`Invalid request type on connection: '${syncRequestParams.type}'`);
      }
      
    } catch(err: any) {
      // General error handling for message processing
      app.log.error(`Top-level message handler error for ${remoteAddress}: ${err.message}`, { error: err, parsed });
      try {
         ws.send(JSON.stringify({
           type: SyncResponseType.nack, 
           requestId: parsed?.requestId,
           message: `Server error processing message: ${err.message}`
         }));
      } catch (sendError: any) {
          app.log.warn(`Failed to send error NACK to ${remoteAddress}, connection likely closed: ${sendError.message}`);
      }
       ws.close();
    }
  },

});

export interface TinySynqServerControl {
  app: TSTemplatedApp;
  close: () => void;
}

export const startTinySynqServer = (params: TSServerParams): TinySynqServerControl => {
  let listenSocket: uWS.us_listen_socket | null = null;
  const port = params.port || Number(env.TINYSYNQ_WS_PORT) || 7174;
  app.ts = params.ts;
  app.auth = params.auth; // Assign the (renamed) auth function
  // app.validateAuthData = params.validateAuthData; // Removed
  app.log = new Logger({
    name:'tinysynq-node-ws',
    minLevel: params.logOptions.minLevel || Number(env.TINYSYNQ_LOG_LEVEL) || LogLevel.Info,
    type: env.TINYSYNQ_LOG_FORMAT || 'json',
    ...(params.logOptions || {})
  });

  app.listen(port, socket => {
    listenSocket = socket;
    if (listenSocket) {
      app.log.info(`TinySynq server listening on port ${port} from thread ${threadId}`);
    } else {
      app.log.error(`Failed to listen on port ${port} from thread ${threadId}`);
    }
  });

  return {
    app,
    close: () => {
      if (listenSocket) {
        app.log.info(`Closing server socket on port ${port}`);
        uWS.us_listen_socket_close(listenSocket);
        listenSocket = null;
      } else {
        app.log.warn(`Attempted to close server, but socket was not listening or already closed.`);
      }
    }
  };
}
