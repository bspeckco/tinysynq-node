import * as uWS from 'uWebSockets.js';
import { TinySynq } from './tinysynq.class.js';
import { Change } from '@bspeckco/tinysynq-lib';
import { ILogObj, ISettingsParam, Logger } from 'tslog';
interface TSTemplatedApp extends uWS.TemplatedApp {
    ts: TinySynq;
    log: Logger<ILogObj>;
    auth?: (req: uWS.HttpRequest) => Promise<boolean | Record<string, any>>;
}
export type SocketRequestType = 'push' | 'pull';
export interface TSServerParams {
    ts: TinySynq;
    port?: number;
    logOptions: ISettingsParam<ILogObj>;
    auth?: (req: uWS.HttpRequest) => Promise<boolean | Record<string, any>>;
}
export interface TSSocketRequestParams {
    changes?: Change[];
    requestId?: string;
    source?: string;
    type: SocketRequestType;
    since: string;
    checkpoint: number;
}
export interface TinySynqServerControl {
    app: TSTemplatedApp;
    close: () => void;
}
export declare const startTinySynqServer: (params: TSServerParams) => TinySynqServerControl;
export {};
//# sourceMappingURL=server.d.ts.map