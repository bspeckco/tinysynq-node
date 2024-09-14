(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory(require('tslog'), require('better-sqlite3'), require('@bspeckco/tinysynq-lib'), require('dotenv/config'), require('uWebSockets.js'), require('worker_threads')) :
  typeof define === 'function' && define.amd ? define(['tslog', 'better-sqlite3', '@bspeckco/tinysynq-lib', 'dotenv/config', 'uWebSockets.js', 'worker_threads'], factory) :
  (global = global || self, global.tinysynqNode = factory(global.tslog, global.betterSqlite3, global.tinysynqLib, null, global.uWS, global.workerThreads));
})(this, (function (tslog, DB, tinysynqLib, config, uWS, worker_threads) {
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

  let server;
  function arrayBufferToString(arrBuff) {
    return Buffer.from(arrBuff).toString();
  }
  const app = uWS__namespace.App();
  app.ws('/*', {
    compression: uWS__namespace.SHARED_COMPRESSOR,
    maxPayloadLength: 16 * 1024 * 1024,
    // 16MB
    idleTimeout: 120,
    sendPingsAutomatically: true,
    open: ws => {
      const addr = arrayBufferToString(ws.getRemoteAddressAsText());
      app.log.warn('@Connected!', addr);
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
          case tinysynqLib.SyncRequestType.push:
            if (!parsed.source) {
              app.log.error('INVALID_SOURCE', {
                parsed
              });
              throw new Error('Invalid source');
            }
            const incoming = ((_parsed$changes = parsed.changes) == null ? void 0 : _parsed$changes.map(c => {
              c.source = parsed.source;
              delete c.mod;
              //c.vclock = JSON.parse(c.vclock);
              return c;
            })) || [];
            app.log.debug('\n<<<< INCOMING >>>>\n', incoming);
            app.ts.applyChangesToLocalDB({
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
            // @TODO: Eh? Didn't I work this out already?
            const params = {
              ...parsed
            };
            params == null || delete params.type;
            const changes = app.ts.getFilteredChanges(parsed);
            app.log.debug('@pull: outgoing:', changes);
            ws.send(JSON.stringify({
              type: tinysynqLib.SyncResponseType.ack,
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
          type: tinysynqLib.SyncResponseType.nack,
          requestId: parsed.requestId,
          message: err.message
        }));
      }
    }
  });
  const startTinySynqServer = params => {
    const port = params.port || Number(env.TINYSYNQ_WS_PORT) || 7174;
    app.ts = params.ts;
    app.log = new tslog.Logger({
      name: 'tinysynq-node-ws',
      minLevel: params.logOptions.minLevel || Number(env.TINYSYNQ_LOG_LEVEL) || tinysynqLib.LogLevel.Info,
      type: env.TINYSYNQ_LOG_FORMAT || 'json',
      ...(params.logOptions || {})
    });
    server = app.listen(port, token => {
      if (token) {
        app.log.info(`TinySynq server listening on port ${port} from thread ${worker_threads.threadId}`);
      } else {
        app.log.error(`Failed to listen on port ${port} from thread ${worker_threads.threadId}`);
      }
    });
    return server;
  };

  var index = {
    startTinySynqServer,
    initTinySynq: initTinySynq
  };

  return index;

}));
//# sourceMappingURL=tinysynq.umd.js.map
