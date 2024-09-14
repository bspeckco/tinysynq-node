import { BetterSqlite3Instance } from './lib/types.js';
import { Change } from '@bspeckco/tinysynq-lib';
import { GetTableIdColumnParams } from '@bspeckco/tinysynq-lib';
import { QueryParams } from '@bspeckco/tinysynq-lib';
import { SyncableTable } from '@bspeckco/tinysynq-lib';
import { TemplatedApp } from 'uWebSockets.js';
import { TinySynq as TinySynq_2 } from './lib/tinysynq.class.js';
import { TinySynqOptions } from '@bspeckco/tinysynq-lib';
import { TinySynqSync } from '@bspeckco/tinysynq-lib';
import { TSServerParams } from './lib/server.js';

export { BetterSqlite3Instance }

export { Change }

declare const _default: {
    startTinySynqServer: (params: TSServerParams) => TemplatedApp;
    initTinySynq: (config: TinySynqOptions) => TinySynq_2;
};
export default _default;

export { GetTableIdColumnParams }

export { QueryParams }

export { SyncableTable }

/**
 * The main class for managing SQLite3 synchronisation.
 *
 * @remarks
 * Expects SQLite3 version \>=3.45.1
 *
 * @public
 */
export declare class TinySynq extends TinySynqSync {
    /**
     * Configure new TinySynq instance.
     *
     * @param opts - Configuration options
     */
    constructor(opts: TinySynqOptions);
}

export { TinySynqOptions }

export { }
