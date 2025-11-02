import { BetterSqlite3Instance } from './lib/types.js';
import { Change } from '@bspeckco/tinysynq-lib';
import { GetTableIdColumnParams } from '@bspeckco/tinysynq-lib';
import { ILogObj } from 'tslog';
import { ISettingsParam } from 'tslog';
import { Logger } from 'tslog';
import { QueryParams } from '@bspeckco/tinysynq-lib';
import { SyncableTable } from '@bspeckco/tinysynq-lib';
import { SyncRequestType } from '@bspeckco/tinysynq-lib';
import { TinySynqOptions } from '@bspeckco/tinysynq-lib';
import { TinySynqServerControl as TinySynqServerControl_2 } from './lib/server.js';
import { TinySynqSync } from '@bspeckco/tinysynq-lib';
import { TinySynqTelemetryEmitter } from '@bspeckco/tinysynq-lib';
import { TSServerParams as TSServerParams_2 } from './lib/server.js';
import * as uWS from 'uWebSockets.js';

export { BetterSqlite3Instance }

export { Change }

declare const _default: {
    startTinySynqServer: (params: TSServerParams_2) => TinySynqServerControl_2;
    initTinySynq: (config: TinySynqOptions) => TinySynqSync;
};
export default _default;

export { GetTableIdColumnParams }

/**
 * Returns a configured instance of TinySynq
 *
 * @param config - Configuration object
 * @returns TinySynq instance
 *
 * @public
 */
export declare const initTinySynq: (config: TinySynqOptions) => TinySynqSync;

export { QueryParams }

export declare type SocketRequestType = SyncRequestType;

export declare const startTinySynqServer: (params: TSServerParams) => TinySynqServerControl;

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

export declare interface TinySynqServerControl {
    app: TSTemplatedApp;
    close: () => void;
}

export declare interface TSServerParams {
    ts: TinySynq;
    port?: number;
    logOptions: ISettingsParam<ILogObj>;
    auth?: (req: uWS.HttpRequest) => Promise<boolean | Record<string, any>>;
    telemetry?: TinySynqTelemetryEmitter;
}

export declare interface TSSocketRequestParams {
    changes?: Change[];
    requestId?: string;
    source?: string;
    type: SyncRequestType;
    since: string;
    checkpoint: number;
}

declare interface TSTemplatedApp extends uWS.TemplatedApp {
    ts: TinySynq;
    log: Logger<ILogObj>;
    auth?: (req: uWS.HttpRequest) => Promise<boolean | Record<string, any>>;
    telemetry?: TinySynqTelemetryEmitter;
}

export { }
