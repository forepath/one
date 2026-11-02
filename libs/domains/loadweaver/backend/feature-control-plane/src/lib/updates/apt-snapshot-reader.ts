import type { AptSnapshotEntity } from './apt.entity';

/**
 * Read-only view of the cluster's apt snapshots for code outside the updates feature (the node installer).
 * Looked up by token at call time (`ModuleRef`), so those consumers neither import `AptSnapshotService` at runtime
 * nor inject it. Installer → apt snapshots → artifact store → object store → network state → installer is a cycle:
 * as an import it left a constructor parameter undefined, as a constructor injection Nest waits on it forever —
 * either way the control plane didn't start.
 */
export const APT_SNAPSHOT_READER = Symbol('APT_SNAPSHOT_READER');

export interface AptSnapshotReader {
  /** The newest snapshot, or `null` when there is none yet. */
  latest(): Promise<Pick<AptSnapshotEntity, 'id' | 'sources'> | null>;
}
