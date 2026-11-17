import type {Snapshot} from 'typescript/async';

/**
 * Retention policy for previous snapshots. Without a bound, snapshots are
 * retained until disposal, matching the verified default behavior.
 */
export class SnapshotRetention {
  private readonly bound: number | undefined;
  private readonly retained: Snapshot[] = [];

  constructor(bound?: number) {
    this.bound = bound;
  }

  async retain(snapshot: Snapshot): Promise<void> {
    this.retained.push(snapshot);
    while (this.bound !== undefined && this.retained.length > this.bound) {
      const oldest = this.retained.shift();
      if (oldest) {
        await oldest.dispose();
      }
    }
  }

  async disposeAll(): Promise<void> {
    for (const snapshot of this.retained.splice(0)) {
      await snapshot.dispose();
    }
  }
}
