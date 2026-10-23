import type {
  AccessMe,
  BackupDeletionState,
  BackupRunStatus,
  RestoreRunStatus,
  RestoreTestStatus,
} from '@forepath/loadweaver/frontend/data-access-console';

/** How often the backup views poll while something runs (no socket); idle they refresh every 6th tick. */
export const BACKUPS_POLL_MS = 5_000;
export const BACKUPS_IDLE_POLL_TICKS = 6;

type Tone = 'success' | 'warning' | 'danger' | 'secondary' | 'info' | 'primary';

export const BACKUP_STATUS_TONE: Record<BackupRunStatus, Tone> = {
  running: 'primary',
  succeeded: 'success',
  failed: 'danger',
};

export function backupStatusLabel(status: BackupRunStatus | string): string {
  switch (status) {
    case 'running':
      return $localize`:@@lwConsoleBackups-statusRunning:Running`;
    case 'succeeded':
      return $localize`:@@lwConsoleBackups-statusSucceeded:Succeeded`;
    case 'failed':
      return $localize`:@@lwConsoleBackups-statusFailed:Failed`;
    default:
      return status;
  }
}

export const RESTORE_TEST_TONE: Record<RestoreTestStatus, Tone> = {
  running: 'primary',
  passed: 'success',
  failed: 'danger',
};

export function restoreTestLabel(status: RestoreTestStatus | string): string {
  switch (status) {
    case 'running':
      return $localize`:@@lwConsoleBackups-testRunning:Restore test running`;
    case 'passed':
      return $localize`:@@lwConsoleBackups-testPassed:Restore test passed`;
    case 'failed':
      return $localize`:@@lwConsoleBackups-testFailed:Restore test failed`;
    default:
      return status;
  }
}

export const RESTORE_STATUS_TONE: Record<RestoreRunStatus, Tone> = {
  pending: 'info',
  running: 'primary',
  done: 'success',
  failed: 'danger',
};

export function restoreStatusLabel(status: RestoreRunStatus | string): string {
  switch (status) {
    case 'pending':
      return $localize`:@@lwConsoleBackups-restorePending:Pending`;
    case 'running':
      return $localize`:@@lwConsoleBackups-restoreRunning:Running`;
    case 'done':
      return $localize`:@@lwConsoleBackups-restoreDone:Done`;
    case 'failed':
      return $localize`:@@lwConsoleBackups-restoreFailed:Failed`;
    default:
      return status;
  }
}

export const DELETION_STATE_TONE: Record<BackupDeletionState, Tone> = {
  pending: 'warning',
  approved: 'info',
  executed: 'danger',
  cancelled: 'secondary',
};

export function deletionStateLabel(state: BackupDeletionState | string): string {
  switch (state) {
    case 'pending':
      return $localize`:@@lwConsoleBackups-deletionPending:Waiting for a second admin`;
    case 'approved':
      return $localize`:@@lwConsoleBackups-deletionApproved:Approved, waiting for the delay`;
    case 'executed':
      return $localize`:@@lwConsoleBackups-deletionExecuted:Deleted`;
    case 'cancelled':
      return $localize`:@@lwConsoleBackups-deletionCancelled:Cancelled`;
    default:
      return state;
  }
}

/** Retention keep reasons (`latest`, `hourly`, …) as labels. */
export function keepReasonLabel(reason: string): string {
  switch (reason) {
    case 'latest':
    case 'keepLast':
      return $localize`:@@lwConsoleBackups-keepLatest:latest`;
    case 'hourly':
      return $localize`:@@lwConsoleBackups-keepHourly:hourly`;
    case 'daily':
      return $localize`:@@lwConsoleBackups-keepDaily:daily`;
    case 'weekly':
      return $localize`:@@lwConsoleBackups-keepWeekly:weekly`;
    case 'monthly':
      return $localize`:@@lwConsoleBackups-keepMonthly:monthly`;
    case 'yearly':
      return $localize`:@@lwConsoleBackups-keepYearly:yearly`;
    default:
      return reason;
  }
}

/** `project-shop` → `shop`, `cluster` → the cluster label. */
export function scopeLabel(scope: string): string {
  return scope === 'cluster' ? $localize`:@@lwConsoleBackups-scopeCluster:Cluster` : scope.replace(/^project-/, '');
}

/** The object lock still holds. */
export function isLocked(lockedUntil: string | null, now: Date = new Date()): boolean {
  return !!lockedUntil && new Date(lockedUntil).getTime() > now.getTime();
}

const ROLE_RANK = { viewer: 0, developer: 1, operator: 2, admin: 3 } as const;

/** Project operators (and admins) back up volumes and start restore tests; the API decides in the end. */
export function canOperate(me: AccessMe | null, project: string | null): boolean {
  if (!me || !project) return false;

  const role = me.projects[project];

  return me.clusterRole === 'cluster-admin' || (!!role && ROLE_RANK[role] >= ROLE_RANK.operator);
}

/** Admins of the scope request, approve and cancel deletions. */
export function canAdminister(me: AccessMe | null, project: string | null): boolean {
  if (!me) return false;

  return me.clusterRole === 'cluster-admin' || (!!project && me.projects[project] === 'admin');
}

/** Path segments of a directory as breadcrumbs (`''` = the volume root). */
export function pathCrumbs(path: string, rootLabel: string): { label: string; path: string }[] {
  const segments = path.split('/').filter(Boolean);

  return [
    { label: rootLabel, path: '' },
    ...segments.map((segment, i) => ({ label: segment, path: segments.slice(0, i + 1).join('/') })),
  ];
}

export function joinPath(directory: string, name: string): string {
  return directory ? `${directory}/${name}` : name;
}

/** The size change of a changed file, e.g. `+1.2 KiB`; `null` when a size is unknown. */
export function sizeDelta(before: number | null, after: number | null): number | null {
  return before === null || after === null ? null : after - before;
}

/** The text file a recovery-kit share is saved as. */
export function kitShareFileName(cluster: string, generation: number, index: number): string {
  const safe = cluster.replace(/[^A-Za-z0-9._-]/g, '_') || 'cluster';

  return `loadweaver-recovery-kit-${safe}-g${generation}-share-${index}.txt`;
}
