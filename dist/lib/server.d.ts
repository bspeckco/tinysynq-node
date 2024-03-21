import * as uWS from 'uWebSockets.js';
import { TinySynq } from './tinysynq.class.js';
import { ILogObj, ISettingsParam } from 'tslog';
export interface TSServerParams {
    ts: TinySynq;
    logOptions: ISettingsParam<ILogObj>;
}
export declare const startTinySynqServer: (params: TSServerParams) => uWS.TemplatedApp;
//# sourceMappingURL=server.d.ts.map