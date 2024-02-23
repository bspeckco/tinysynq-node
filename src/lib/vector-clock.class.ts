import { VClock } from "./types.js";


type VectorClockParams = {
  vclock: VClock;
  localId: string;
}

export class VectorClock {

  private local: VClock;
  private isGreater = false;
  private isLess = false;
  private remote: VClock = {};
  private localId: string;

  constructor({ vclock, localId }: VectorClockParams) {
    this.local = vclock;
    this.localId = localId;
  }

  isConflicted({ remote }: Record<string, VClock>): boolean {
    Object.keys(this.local).forEach(k => {
      const localCount = this.local[k];
      const remoteCount = remote[k];
      this.isGreater = this.isGreater || localCount > remoteCount;
      this.isLess = this.isLess || localCount < remoteCount;
    });
    this.remote = remote;
    return this.isGreater && this.isLess;
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