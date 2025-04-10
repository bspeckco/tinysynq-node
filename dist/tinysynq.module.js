import { Logger } from 'tslog';
import DB from 'better-sqlite3';
import { TinySynqSync, createInternalTablesSync, setupTriggersForTableSync, SyncRequestType, SyncResponseType, LogLevel } from '@bspeckco/tinysynq-lib';
import 'dotenv/config';
import * as uWS from 'uWebSockets.js';
import { threadId } from 'worker_threads';

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
    super(opts);
    if (!opts.filePath && !opts.sqlite3) {
      throw new Error('No DB filePath or connection provided');
    }
    if (!this.db) {
      this._db = new DB(this.dbPath);
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
  const log = new Logger({
    name: 'tinysync-setup',
    ...logOptions
  });
  const ts = new TinySynq(config);
  createInternalTablesSync({
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
    setupTriggersForTableSync({
      table,
      ts
    });
  }
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
const app = uWS.App();
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
    let userData = {
      remoteAddress
    }; // Include remote address in userData by default
    try {
      if (app.auth) {
        app.log.debug(`Performing auth for ${remoteAddress}`);
        const authResult = await app.auth(req);
        if (authResult === true) {
          // Auth successful (simple boolean success)
          app.log.debug(`Auth successful (true) for ${remoteAddress}`);
        } else if (typeof authResult === 'object' && authResult !== null) {
          // Auth successful (with user data)
          userData = {
            ...userData,
            ...authResult
          }; // Merge auth result object into userData
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
      res.upgrade({
        userData
      },
      // Pass the userData object
      secWebSocketKey, secWebSocketProtocol, secWebSocketExtensions, context);
    } catch (err) {
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
    var _parsed$changes;
    const addr = arrayBufferToString(ws.getRemoteAddressAsText());
    const messageString = arrayBufferToString(message);
    const parsed = JSON.parse(messageString);
    const {
      requestId
    } = parsed;
    app.log.trace('@parsed', parsed);
    app.log.debug('@Message!', parsed.changes, app.ts.deviceId);
    try {
      switch (parsed.type) {
        case SyncRequestType.push:
          if (!parsed.source) {
            app.log.error('INVALID_SOURCE', {
              parsed
            });
            throw new Error('Invalid source');
          }
          const incoming = ((_parsed$changes = parsed.changes) == null ? void 0 : _parsed$changes.map(c => {
            c.source = parsed.source;
            delete c.mod;
            return c;
          })) || [];
          app.log.debug('\n<<<< INCOMING >>>>\n', incoming);
          app.ts.applyChangesToLocalDB({
            changes: incoming
          });
          ws.send(JSON.stringify({
            type: SyncResponseType.ack,
            requestId
          }));
          ws.publish('broadcast', JSON.stringify({
            changes: incoming
          }), false);
          break;
        case SyncRequestType.pull:
          // @TODO: Eh? Didn't I work this out already?
          const params = {
            ...parsed
          };
          params == null || delete params.type;
          const changes = app.ts.getFilteredChanges(parsed);
          app.log.debug('@pull: outgoing:', changes);
          ws.send(JSON.stringify({
            type: SyncResponseType.ack,
            requestId,
            changes
          }));
          break;
        default:
          throw new Error(`Invalid request type: '${parsed.type}'`);
      }
    } catch (err) {
      app.log.error(err, {
        addr,
        for: JSON.stringify(parsed)
      });
      ws.send(JSON.stringify({
        type: SyncResponseType.nack,
        requestId: parsed.requestId,
        message: err.message
      }));
    }
  }
});
const startTinySynqServer = params => {
  let listenSocket = null;
  const port = params.port || Number(env.TINYSYNQ_WS_PORT) || 7174;
  app.ts = params.ts;
  app.auth = params.auth;
  app.log = new Logger({
    name: 'tinysynq-node-ws',
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
};

var index = {
  startTinySynqServer,
  initTinySynq: initTinySynq
};

export { index as default };
//# sourceMappingURL=tinysynq.module.js.map
