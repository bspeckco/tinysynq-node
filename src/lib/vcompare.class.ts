import { VClock } from "./types.js";


type VectorClockParams = {
  local: VClock;
  remote: VClock;
  localId: string;
}

type RemoteVClockParams = {
  remote: VClock;
}

export class VCompare { // @TODO: rename to VCompare

  private local: VClock;
  private isGreater = false;
  private isLess = false;
  private remote: VClock = {};
  private localId: string;

  constructor({ local, remote, localId }: VectorClockParams) {
    this.local = local;
    this.remote = remote;
    this.localId = localId;
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
    const { remote, local, localId } = this;
    if (!remote || !local) throw new Error('Remote vector clock not set');
    // Locally changes have taken places that the remote is missing.
    return local[localId] > remote[localId];
  }

  isOutOfOrder(): boolean {
    const { remote, local, localId } = this;
    if (!remote || !local) throw new Error('Remote vector clock not set');
    const keys = Object.keys({...this.local, ...remote}).filter(k => k !== localId);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const delta = Math.abs(local[k] - remote[k]);
      if (delta > 1) return true;
    }
    return false
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