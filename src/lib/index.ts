import { Logger } from "tslog";
import { TinySynq } from "./tinysynq.class.js";
import {
  createInternalTablesSync,
  setupTriggersForTableSync,
  TinySynqOptions,
} from "@bspeckco/tinysynq-lib";

/**
 * Returns a configured instance of TinySynq
 * 
 * @param config - Configuration object 
 * @returns TinySynq instance
 * 
 * @public
 */
const initTinySynq = (config: TinySynqOptions) => {
  const {
    tables,
    preInit,
    postInit,
    logOptions,
    debug,
  } = config;

  if (!tables?.length) throw new Error('Syncable table data required');

  const log = new Logger({ name: 'tinysync-setup', ...logOptions});
  const ts = new TinySynq(config);


  createInternalTablesSync({ ts });

  // Enable debug mode
  if (debug) ts.enableDebug();

  // Set the device ID
  ts.setDeviceId();

  // Run pre-initialisation queries
  if (preInit?.length) {
    for (const preInitQuery of preInit) {
      try {
        log.debug(`\n@@@ preInit\n${preInitQuery}\n@@@`)
        ts.run({
          sql: preInitQuery
        });
      }
      catch(err) {
        log.error('@preInit', err)
      }
    }
  }

  log.debug(`@${ts.synqPrefix}_meta`, ts.runQuery({sql:`SELECT * FROM pragma_table_info('${ts.synqPrefix}_meta')`}));
  log.debug(`@SIMPLE_SELECT`, ts.runQuery({sql:`SELECT '@@@ that was easy @@@'`}));

  for (const table of tables) {
    // Check table exists
    const exists = ts.runQuery<Record<string, any>>({
      sql: `SELECT * FROM pragma_table_info('${table.name}')`
    });
    if (!exists?.length) throw new Error(`${table.name} doesn't exist`);
    
    log.debug('Setting up', table.name, table.id);

    setupTriggersForTableSync({ table, ts });
  }
  
  ts.tablesReady();

  if (postInit?.length) {
    for (const postInitQuery of postInit) {
      log.warn(`@@@\npostInit\n${postInitQuery}\n@@@`)
      const result = ts.run({
        sql: postInitQuery
      });
      log.trace(`@@@ postInit RESULT\n`, result);
    }
  }

  return ts;
};

export default initTinySynq;
