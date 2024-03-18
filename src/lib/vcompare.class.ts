import { VClock } from "./types.js";


type VectorClockParams = {
  local: VClock;
  remote: VClock;
  localId: string;
  localTime: string;
  remoteTime: string;
}

type RemoteVClockParams = {
  remote: VClock;
}

export class VCompare { // @TODO: rename to VCompare

  private local: VClock;
  private isGreater = false;
  private isLess = false;
  private isWrongOrder = false;
  private remote: VClock = {};
  private localId: string;
  private localTime: string;
  private remoteTime: string;


  constructor({ local, remote, localId, localTime, remoteTime }: VectorClockParams) {
    this.local = local;
    this.remote = typeof remote === 'string'
      ? JSON.parse(remote)
      : remote;
    this.localId = localId;
    this.localTime = localTime;
    this.remoteTime = remoteTime;
  }

  setRemote({ remote }: RemoteVClockParams) {
    this.remote = remote;
  }

  isConflicted(data?: RemoteVClockParams): boolean {
    const remote = data?.remote || this.remote;
    const keys = Object.keys({...this.local, ...remote});
    keys.forEach(k => {
      const localCount = this.local[k] || 0;
      const remoteCount = remote[k] || 0;
      this.isGreater = this.isGreater || localCount > remoteCount;
      this.isLess = this.isLess || localCount < remoteCount;
    });
    
    return this.isGreater && this.isLess;
  }

  isOutDated(): boolean {
    // Default localTime to any early date so that 
    // remote always wins when local is empty.
    const { remoteTime, localTime = new Date('1970-01-01').toISOString() } = this;
    if (!remoteTime || !localTime) throw new Error('Missing modified time');
    return localTime >= remoteTime;
  }

  isOutOfOrder(): boolean {
    const { remote, local, localId } = this;
    if (!remote || !local) throw new Error('Remote vector clock not set');
    const keys = Object.keys({...this.local, ...remote}).filter(k => k !== localId);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const drift = Math.abs((local[k] ?? 0) - (remote[k] ?? 0));
      this.isWrongOrder = drift > 1;
    }
    return this.isWrongOrder;
  }

  merge() {
    const merged: VClock = {};
    const participants = new Set(Object.keys(this.local).concat(Object.keys(this.remote)));
    // If the incoming participant vclock is lower, discard
    for (const p of participants) {
      const localP = this.local[p] || 0;
      const remoteP = this.remote[p] || 0;
      merged[p] = Math.max(localP, remoteP);
    }
    if (merged[this.localId] === undefined) {
      merged[this.localId] = 0;
    }
    return merged;
  }
}