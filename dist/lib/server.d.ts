import * as uWS from 'uWebSockets.js';
import { TinySynq } from './tinysynq.class.js';
import { Change } from '@bspeckco/tinysynq-lib';
import { ILogObj, ISettingsParam } from 'tslog';
export type SocketRequestType = 'push' | 'pull';
export interface TSServerParams {
    ts: TinySynq;
    port?: number;
    logOptions: ISettingsParam<ILogObj>;
}
export interface TSSocketRequestParams {
    changes?: Change[];
    requestId?: string;
    source?: string;
    type: SocketRequestType;
    since: string;
    checkpoint: number;
}
export declare const startTinySynqServer: (params: TSServerParams) => uWS.TemplatedApp;
//# sourceMappingURL=server.d.ts.map