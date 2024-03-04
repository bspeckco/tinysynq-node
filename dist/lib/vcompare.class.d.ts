import { VClock } from "./types.js";
type VectorClockParams = {
    local: VClock;
    remote: VClock;
    localId: string;
};
type RemoteVClockParams = {
    remote: VClock;
};
export declare class VCompare {
    private local;
    private isGreater;
    private isLess;
    private isWrongOrder;
    private remote;
    private localId;
    constructor({ local, remote, localId }: VectorClockParams);
    setRemote({ remote }: RemoteVClockParams): void;
    isConflicted(data?: RemoteVClockParams): boolean;
    isOutDated(): boolean;
    isOutOfOrder(): boolean;
    merge(): VClock;
}
export {};
//# sourceMappingURL=vcompare.class.d.ts.map