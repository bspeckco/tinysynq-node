var tslog = require('tslog');
var DB = require('better-sqlite3');
var tinysynqLib = require('@bspeckco/tinysynq-lib');
require('dotenv/config');
var uWS = require('uWebSockets.js');
var worker_threads = require('worker_threads');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

function _interopNamespace(e) {
  if (e && e.__esModule) return e;
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n["default"] = e;
  return n;
}

var DB__default = /*#__PURE__*/_interopDefaultLegacy(DB);
var uWS__namespace = /*#__PURE__*/_interopNamespace(uWS);

/**
 * The main class for managing SQLite3 synchronisation.
 *
 * @remarks
 * Expects SQLite3 version \>=3.45.1
 *
 * @public
 */
class TinySynq extends tinysynqLib.TinySynqSync {
  /**
   * Configure new TinySynq instance.
   *
   * @param opts - Configuration options
   */
  constructor(opts) {
    super(opts);
    if (!opts.filePath && !opts.sqlite3) {
      throw new Error('No DB filePath or connection provided');
    }
    if (!this.db) {
      this._db = new DB__default["default"](this.dbPath);
      this.db.pragma('journal_mode = WAL');
    }
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
  const log = new tslog.Logger({
    name: 'tinysync-setup',
    ...logOptions
  });
  const ts = new TinySynq(config);
  tinysynqLib.createInternalTablesSync({
    ts
  });
  // Enable debug mode
  if (debug) ts.enableDebug();
  // Set the device ID
  ts.setDeviceId();
  // Run pre-initialisation queries
  if (preInit != null && preInit.length) {
    for (const preInitQuery of preInit) {
      try {
        log.debug(`\n@@@ preInit\n${preInitQuery}\n@@@`);
        ts.run({
          sql: preInitQuery
        });
      } catch (err) {
        log.error('@preInit', err);
      }
    }
  }
  log.debug(`@${ts.synqPrefix}_meta`, ts.runQuery({
    sql: `SELECT * FROM pragma_table_info('${ts.synqPrefix}_meta')`
  }));
  log.debug(`@SIMPLE_SELECT`, ts.runQuery({
    sql: `SELECT '@@@ that was easy @@@'`
  }));
  for (const table of tables) {
    // Check table exists
    const exists = ts.runQuery({
      sql: `SELECT * FROM pragma_table_info('${table.name}')`
    });
    if (!(exists != null && exists.length)) throw new Error(`${table.name} doesn't exist`);
    log.debug('Setting up', table.name, table.id);
    tinysynqLib.setupTriggersForTableSync({
      table,
      ts
    });
  }
  tinysynqLib.applyMigrationsSync({
    db: ts,
    logger: log
  });
  ts.tablesReady();
  if (postInit != null && postInit.length) {
    for (const postInitQuery of postInit) {
      log.warn(`@@@\npostInit\n${postInitQuery}\n@@@`);
      const result = ts.run({
        sql: postInitQuery
      });
      log.trace(`@@@ postInit RESULT\n`, result);
    }
  }
  return ts;
};

const env = process.env;

function arrayBufferToString(arrBuff) {
  return Buffer.from(arrBuff).toString();
}
const app = uWS__namespace.App({});
app.ws('/*', {
  compression: uWS__namespace.SHARED_COMPRESSOR,
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
        res.upgrade(userData, secWebSocketKey, secWebSocketProtocol, secWebSocketExtensions, context);
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
    const userData = ws.getUserData();
    app.log.warn('@Connected!', userData);
    ws.subscribe('broadcast');
  },
  message: async (ws, message, isBinary) => {
    var _syncRequestParams$ch;
    const userData = ws.getUserData();
    const remoteAddress = userData.remoteAddress;
    let parsed;
    try {
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
      // --- Handle Authenticated Connections (All connections are considered authenticated here) ---
      // Ensure the message type is a valid SyncRequestType before proceeding
      if (typeof parsed.type !== 'string' || !Object.values(tinysynqLib.SyncRequestType).includes(parsed.type)) {
        var _parsed, _parsed2;
        app.log.warn('INVALID_MESSAGE_TYPE received', {
          parsed,
          remoteAddress
        });
        ws.send(JSON.stringify({
          type: tinysynqLib.SyncResponseType.nack,
          requestId: (_parsed = parsed) == null ? void 0 : _parsed.requestId,
          message: `Invalid message type: ${(_parsed2 = parsed) == null ? void 0 : _parsed2.type}`
        }));
        return;
      }
      const syncRequestParams = parsed;
      const {
        requestId
      } = syncRequestParams;
      app.log.debug(`@Message (${remoteAddress})!`, syncRequestParams.changes, app.ts.deviceId);
      switch (syncRequestParams.type) {
        case tinysynqLib.SyncRequestType.push:
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
          await app.ts.applyChangesToLocalDB({
            changes: incoming
          });
          ws.send(JSON.stringify({
            type: tinysynqLib.SyncResponseType.ack,
            requestId
          }));
          ws.publish('broadcast', JSON.stringify({
            changes: incoming
          }), false);
          break;
        case tinysynqLib.SyncRequestType.pull:
          const params = {
            ...syncRequestParams
          };
          params == null || delete params.type;
          const changes = await app.ts.getFilteredChanges(syncRequestParams);
          app.log.debug('@pull: outgoing:', changes);
          ws.send(JSON.stringify({
            type: tinysynqLib.SyncResponseType.ack,
            requestId,
            changes
          }));
          break;
        default:
          throw new Error(`Invalid request type on connection: '${syncRequestParams.type}'`);
      }
    } catch (err) {
      // General error handling for message processing
      app.log.error(`Top-level message handler error for ${remoteAddress}: ${err.message}`, {
        error: err,
        parsed
      });
      try {
        var _parsed3;
        ws.send(JSON.stringify({
          type: tinysynqLib.SyncResponseType.nack,
          requestId: (_parsed3 = parsed) == null ? void 0 : _parsed3.requestId,
          message: `Server error processing message: ${err.message}`
        }));
      } catch (sendError) {
        app.log.warn(`Failed to send error NACK to ${remoteAddress}, connection likely closed: ${sendError.message}`);
      }
      ws.close();
    }
  }
});
const startTinySynqServer = params => {
  let listenSocket = null;
  const port = params.port || Number(env.TINYSYNQ_WS_PORT) || 7174;
  app.ts = params.ts;
  app.auth = params.auth; // Assign the (renamed) auth function
  // app.validateAuthData = params.validateAuthData; // Removed
  app.log = new tslog.Logger({
    name: 'tinysynq-node-ws',
    minLevel: params.logOptions.minLevel || Number(env.TINYSYNQ_LOG_LEVEL) || tinysynqLib.LogLevel.Info,
    type: env.TINYSYNQ_LOG_FORMAT || 'json',
    ...(params.logOptions || {})
  });
  app.listen(port, socket => {
    listenSocket = socket;
    if (listenSocket) {
      app.log.info(`TinySynq server listening on port ${port} from thread ${worker_threads.threadId}`);
    } else {
      app.log.error(`Failed to listen on port ${port} from thread ${worker_threads.threadId}`);
    }
  });
  return {
    app,
    close: () => {
      if (listenSocket) {
        app.log.info(`Closing server socket on port ${port}`);
        uWS__namespace.us_listen_socket_close(listenSocket);
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

module.exports = index;
//# sourceMappingURL=tinysynq.cjs.map
