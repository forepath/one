import { Injectable } from '@nestjs/common';

/** How long a committed restore stays protected while the desired state that contains it is on its way. */
export const COMMITTED_GRACE_MS = 5 * 60_000;

/**
 * Replicas under a live-migration session on this node (3.10). The workload reconcile leaves them alone: a frozen
 * source is never restarted (nor its volume re-promoted through a restart), and a restored replica on the target is
 * never removed as "unknown" before the cut-over reaches this node's desired state.
 */
@Injectable()
export class MigrationSessions {
  private readonly active = new Map<string, number>();
  private readonly committed = new Map<string, number>();
  /** Clock (replaceable in tests). */
  now: () => number = Date.now;

  /** A session for `replica` started (one per replica and node). */
  begin(replica: string): void {
    this.active.set(replica, (this.active.get(replica) ?? 0) + 1);
  }

  /** The session ended; `restored`: the replica now runs here and waits for its desired state. */
  end(replica: string, restored = false): void {
    const count = (this.active.get(replica) ?? 1) - 1;

    if (count > 0) this.active.set(replica, count);
    else this.active.delete(replica);

    if (restored) this.committed.set(replica, this.now() + COMMITTED_GRACE_MS);
  }

  /** The desired state contains the replica: from now on the normal reconcile owns it. */
  adopted(replica: string): void {
    this.committed.delete(replica);
  }

  /** Replicas the reconcile must not touch right now. */
  protectedReplicas(): Set<string> {
    const now = this.now();

    for (const [replica, until] of this.committed) if (until < now) this.committed.delete(replica);

    return new Set([...this.active.keys(), ...this.committed.keys()]);
  }

  /** Replicas with a running session (not the committed ones). */
  activeReplicas(): Set<string> {
    return new Set(this.active.keys());
  }
}
