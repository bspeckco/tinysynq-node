import { Logger } from "tslog";
import { TinySynq } from "./tinysynq.class.js";
import { TinySynqOptions, bootstrapTinySynqSync } from "@bspeckco/tinysynq-lib";

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

  const log = new Logger({ name: 'tinysynq-setup', ...logOptions });
  const ts = new TinySynq(config);

  return bootstrapTinySynqSync({
    ts,
    options: config,
    logger: log,
  });
};

export default initTinySynq;
