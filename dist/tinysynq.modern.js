import { Logger } from 'tslog';
import DB from 'better-sqlite3';
import { TinySynqSync, createHybridAdapter, bootstrapTinySynqSync, SyncRequestType, SyncResponseType, LogLevel } from '@bspeckco/tinysynq-lib';
import 'dotenv/config';
import * as uWS from 'uWebSockets.js';
import { threadId } from 'worker_threads';

function _extends() {
  _extends = Object.assign ? Object.assign.bind() : function (target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }
    return target;
  };
  return _extends.apply(this, arguments);
}

/**
 * The main class for managing SQLite3 synchronisation.
 *
 * @remarks
 * Expects SQLite3 version \>=3.45.1
 *
 * @public
 */
class TinySynq extends TinySynqSync {
  /**
   * Configure new TinySynq instance.
   *
   * @param opts - Configuration options
   */
  constructor(opts) {
    // If adapter not provided, create one from better-sqlite3
    if (!opts.adapter) {
      if (!opts.filePath && !opts.sqlite3) {
        throw new Error('No DB filePath or connection provided');
      }
      const db = opts.sqlite3 || new DB(opts.filePath);
      // Set WAL mode before creating adapter
      if (opts.wal !== false) {
        db.pragma('journal_mode = WAL');
      }
      const adapter = createHybridAdapter({
        driver: 'better-sqlite3',
        db,
        closeOnDispose: !opts.sqlite3 // Only close if we created it
      });
      opts = _extends({}, opts, {
        adapter
      });
    }
    super(opts);
  }
}

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
  const log = new Logger(_extends({
    name: 'tinysynq-setup'
  }, logOptions));
  const ts = new TinySynq(config);
  return bootstrapTinySynqSync({
    ts,
    options: config,
    logger: log
  });
};

const env = process.env;

function arrayBufferToString(arrBuff) {
  return Buffer.from(arrBuff).toString();
}
const app = uWS.App({});
app.ws('/*', {
  compression: uWS.SHARED_COMPRESSOR,
  maxPayloadLength: 16 * 1024 * 1024,
  idleTimeout: 120,
  sendPingsAutomatically: true,
  upgrade: async (res, req, context) => {
    const secWebSocketKey = req.getHeader('sec-websocket-key');
    const secWebSocketProtocol = req.getHeader('sec-websocket-protocol');
    const secWebSocketExtensions = req.getHeader('sec-websocket-extensions');
    const remoteAddress = arrayBufferToString(res.getRemoteAddressAsText());
    res.onAborted(() => {
      app.log.warn(`Connection aborted for ${remoteAddress}`);
      res.aborted = true;
    });
    let userData = {
      remoteAddress
    }; // Base user data
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
          res.cork(() => {
            res.writeStatus('401 Unauthorized').end();
          });
          return; // Stop processing
        }
      } else {
        // No auth function configured, allow connection
        app.log.trace(`No auth configured, allowing connection for ${remoteAddress}`);
      }
      // If we reach here, authentication passed or was not required.
      app.log.debug(`Upgrading connection for ${remoteAddress}, userData:`, userData);
      if (!res.aborted) {
        res.cork(() => {
          res.upgrade(userData, secWebSocketKey, secWebSocketProtocol, secWebSocketExtensions, context);
        });
      } else {
        app.log.warn(`Upgrade aborted for ${remoteAddress} during auth.`);
      }
    } catch (err) {
      // Error during auth function execution
      app.log.error(`Auth error during upgrade for ${remoteAddress}: ${err.message}`);
      if (!res.aborted) {
        res.cork(() => {
          res.writeStatus('500 Internal Server Error').end();
        });
      }
    }
  },
  open: ws => {
    var _app$telemetry;
    const userData = ws.getUserData();
    app.log.warn('@Connected!', userData);
    (_app$telemetry = app.telemetry) == null || _app$telemetry.emit({
      type: 'hub.connection.open',
      data: {
        remoteAddress: userData.remoteAddress
      }
    });
    ws.subscribe('broadcast');
  },
  message: async (ws, message, isBinary) => {
    var _syncRequestParams$ch, _app$telemetry3, _app$telemetry5, _app$telemetry6;
    const userData = ws.getUserData();
    const remoteAddress = userData.remoteAddress;
    let parsed;
    try {
      var _app$telemetry2, _parsed, _parsed2;
      // Ensure message is parsed safely
      try {
        const messageString = arrayBufferToString(message);
        parsed = JSON.parse(messageString);
      } catch (parseError) {
        app.log.warn(`Failed to parse message from ${remoteAddress}: ${parseError.message}`);
        ws.close(); // Close connection on parse error
        return;
      }
      app.log.trace(`Raw message from ${remoteAddress}:`, parsed);
      (_app$telemetry2 = app.telemetry) == null || _app$telemetry2.emit({
        type: 'hub.message.received',
        data: {
          remoteAddress,
          requestId: (_parsed = parsed) == null ? void 0 : _parsed.requestId,
          type: (_parsed2 = parsed) == null ? void 0 : _parsed2.type
        }
      });
      // --- Handle Authenticated Connections (All connections are considered authenticated here) ---
      // Ensure the message type is a valid SyncRequestType before proceeding
      if (typeof parsed.type !== 'string' || !Object.values(SyncRequestType).includes(parsed.type)) {
        var _parsed3, _parsed4;
        app.log.warn('INVALID_MESSAGE_TYPE received', {
          parsed,
          remoteAddress
        });
        ws.send(JSON.stringify({
          type: SyncResponseType.nack,
          requestId: (_parsed3 = parsed) == null ? void 0 : _parsed3.requestId,
          message: `Invalid message type: ${(_parsed4 = parsed) == null ? void 0 : _parsed4.type}`
        }));
        return;
      }
      const syncRequestParams = parsed;
      app.log.warn('@syncRequestParams', syncRequestParams, '/syncRequestParams');
      const {
        requestId
      } = syncRequestParams;
      app.log.debug(`@Message (${remoteAddress})!`, syncRequestParams.changes, app.ts.deviceId);
      switch (syncRequestParams.type) {
        case SyncRequestType.push:
          if (!syncRequestParams.source) {
            app.log.error('INVALID_SOURCE', {
              parsed: syncRequestParams,
              remoteAddress
            });
            throw new Error('Invalid source');
          }
          const incoming = ((_syncRequestParams$ch = syncRequestParams.changes) == null ? void 0 : _syncRequestParams$ch.map(c => {
            c.source = syncRequestParams.source;
            delete c.mod;
            return c;
          })) || [];
          app.log.debug('\n<<<< INCOMING >>>>\n', incoming);
          (_app$telemetry3 = app.telemetry) == null || _app$telemetry3.emit({
            type: 'hub.push.received',
            data: {
              remoteAddress,
              requestId,
              changeCount: incoming.length,
              source: syncRequestParams.source
            }
          });
          try {
            app.ts.applyChangesToLocalDB({
              changes: incoming
            });
          } catch (err) {
            var _app$telemetry4;
            app.log.error('Error applying changes to local DB', {
              error: err,
              changes: incoming
            });
            ws.send(JSON.stringify({
              type: SyncResponseType.nack,
              requestId,
              message: 'Error applying changes to local DB'
            }));
            (_app$telemetry4 = app.telemetry) == null || _app$telemetry4.emit({
              type: 'hub.push.error',
              data: {
                remoteAddress,
                requestId,
                changeCount: incoming.length,
                error: err instanceof Error ? err.message : String(err)
              }
            });
          }
          ws.send(JSON.stringify({
            type: SyncResponseType.ack,
            requestId
          }));
          ws.publish('broadcast', JSON.stringify({
            changes: incoming,
            source: syncRequestParams.source
          }), false);
          (_app$telemetry5 = app.telemetry) == null || _app$telemetry5.emit({
            type: 'hub.push.applied',
            data: {
              remoteAddress,
              requestId,
              changeCount: incoming.length,
              source: syncRequestParams.source
            }
          });
          break;
        case SyncRequestType.pull:
          app.log.warn('@pull: syncRequestParams', syncRequestParams, '/pull');
          const params = _extends({}, syncRequestParams);
          params == null || delete params.type;
          const changes = await app.ts.getFilteredChanges(syncRequestParams);
          app.log.debug('@pull: outgoing:', changes);
          ws.send(JSON.stringify({
            type: SyncResponseType.ack,
            requestId,
            changes
          }));
          (_app$telemetry6 = app.telemetry) == null || _app$telemetry6.emit({
            type: 'hub.pull.sent',
            data: {
              remoteAddress,
              requestId,
              changeCount: Array.isArray(changes) ? changes.length : 0,
              since: syncRequestParams.since,
              checkpoint: syncRequestParams.checkpoint
            }
          });
          break;
        default:
          throw new Error(`Invalid request type on connection: '${syncRequestParams.type}'`);
      }
    } catch (err) {
      var _app$telemetry7, _parsed6;
      // General error handling for message processing
      app.log.error(`Top-level message handler error for ${remoteAddress}: ${err.message}`, {
        error: err,
        parsed
      });
      try {
        var _parsed5;
        ws.send(JSON.stringify({
          type: SyncResponseType.nack,
          requestId: (_parsed5 = parsed) == null ? void 0 : _parsed5.requestId,
          message: `Server error processing message: ${err.message}`
        }));
      } catch (sendError) {
        app.log.warn(`Failed to send error NACK to ${remoteAddress}, connection likely closed: ${sendError.message}`);
      }
      (_app$telemetry7 = app.telemetry) == null || _app$telemetry7.emit({
        type: 'hub.message.error',
        data: {
          remoteAddress,
          requestId: (_parsed6 = parsed) == null ? void 0 : _parsed6.requestId,
          error: err instanceof Error ? err.message : String(err)
        }
      });
      ws.close();
    }
  },
  close: (ws, code, message) => {
    var _app$telemetry8;
    const userData = ws.getUserData();
    (_app$telemetry8 = app.telemetry) == null || _app$telemetry8.emit({
      type: 'hub.connection.close',
      data: {
        remoteAddress: userData.remoteAddress,
        code,
        message: Buffer.from(message).toString()
      }
    });
  }
});
const startTinySynqServer = params => {
  var _env$TINYSYNQ_LOG_FOR;
  app.log = new Logger(_extends({
    name: 'tinysynq-node-ws',
    minLevel: params.logOptions.minLevel || Number(env.TINYSYNQ_LOG_LEVEL) || LogLevel.Info,
    type: (_env$TINYSYNQ_LOG_FOR = env.TINYSYNQ_LOG_FORMAT) != null ? _env$TINYSYNQ_LOG_FOR : 'json'
  }, params.logOptions || {}));
  app.log.info(`TinySynq server starting...`);
  let listenSocket = null;
  const port = params.port || Number(env.TINYSYNQ_WS_PORT) || 7174;
  if (params.telemetry) {
    params.ts.setTelemetryEmitter(params.telemetry);
  }
  app.ts = params.ts;
  app.auth = params.auth;
  app.telemetry = params.telemetry;
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
};

var index = {
  startTinySynqServer,
  initTinySynq: initTinySynq
};

export { index as default };
//# sourceMappingURL=tinysynq.modern.js.map
