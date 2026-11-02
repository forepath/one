import type {
  MaintenanceWindowSpec,
  NodeWindowState,
  ReleaseStatus,
  Rollout,
  RolloutAction,
  RolloutDiffEntry,
  RolloutStatus,
  RolloutStepState,
  UpdatePolicyMode,
  Weekday,
} from '@forepath/loadweaver/frontend/data-access-console';
import type { FpcBadgeTone } from '@forepath/shared/frontend/ui-components';

/** How often the updates views poll while a rollout is in progress (no socket). */
export const UPDATES_POLL_MS = 5_000;

type Tone = FpcBadgeTone;

export const ROLLOUT_STATUS_TONE: Record<RolloutStatus, Tone> = {
  planned: 'info',
  approved: 'primary',
  running: 'primary',
  paused: 'warning',
  'rolling-back': 'warning',
  'rolled-back': 'warning',
  'rollback-failed': 'danger',
  completed: 'success',
  cancelled: 'neutral',
  superseded: 'neutral',
};

export function rolloutStatusLabel(status: RolloutStatus): string {
  switch (status) {
    case 'planned':
      return $localize`:@@lwConsoleUpdates-statusPlanned:Planned`;
    case 'approved':
      return $localize`:@@lwConsoleUpdates-statusApproved:Approved`;
    case 'running':
      return $localize`:@@lwConsoleUpdates-statusRunning:Running`;
    case 'paused':
      return $localize`:@@lwConsoleUpdates-statusPaused:Paused`;
    case 'rolling-back':
      return $localize`:@@lwConsoleUpdates-statusRollingBack:Rolling back`;
    case 'rolled-back':
      return $localize`:@@lwConsoleUpdates-statusRolledBack:Rolled back`;
    case 'rollback-failed':
      return $localize`:@@lwConsoleUpdates-statusRollbackFailed:Rollback failed`;
    case 'completed':
      return $localize`:@@lwConsoleUpdates-statusCompleted:Completed`;
    case 'cancelled':
      return $localize`:@@lwConsoleUpdates-statusCancelled:Cancelled`;
    default:
      return $localize`:@@lwConsoleUpdates-statusSuperseded:Superseded`;
  }
}

export const STEP_STATE_TONE: Record<RolloutStepState, Tone> = {
  pending: 'neutral',
  'waiting-window': 'info',
  draining: 'primary',
  switchover: 'primary',
  applying: 'primary',
  rebooting: 'primary',
  verifying: 'primary',
  done: 'success',
  failed: 'danger',
  'rolling-back': 'warning',
  'rolled-back': 'warning',
  'rollback-failed': 'danger',
  skipped: 'neutral',
};

export function stepStateLabel(state: RolloutStepState): string {
  switch (state) {
    case 'pending':
      return $localize`:@@lwConsoleUpdates-stepPending:Pending`;
    case 'waiting-window':
      return $localize`:@@lwConsoleUpdates-stepWaitingWindow:Waiting for a window`;
    case 'draining':
      return $localize`:@@lwConsoleUpdates-stepDraining:Draining`;
    case 'switchover':
      return $localize`:@@lwConsoleUpdates-stepSwitchover:Switchover`;
    case 'applying':
      return $localize`:@@lwConsoleUpdates-stepApplying:Applying`;
    case 'rebooting':
      return $localize`:@@lwConsoleUpdates-stepRebooting:Rebooting`;
    case 'verifying':
      return $localize`:@@lwConsoleUpdates-stepVerifying:Verifying`;
    case 'done':
      return $localize`:@@lwConsoleUpdates-stepDone:Done`;
    case 'failed':
      return $localize`:@@lwConsoleUpdates-stepFailed:Failed`;
    case 'rolling-back':
      return $localize`:@@lwConsoleUpdates-stepRollingBack:Rolling back`;
    case 'rolled-back':
      return $localize`:@@lwConsoleUpdates-stepRolledBack:Rolled back`;
    case 'rollback-failed':
      return $localize`:@@lwConsoleUpdates-stepRollbackFailed:Rollback failed`;
    default:
      return $localize`:@@lwConsoleUpdates-stepSkipped:Skipped`;
  }
}

export const RELEASE_STATUS_TONE: Record<ReleaseStatus, FpcBadgeTone> = {
  announced: 'info',
  importing: 'primary',
  available: 'success',
  failed: 'danger',
  installed: 'neutral',
};

export function releaseStatusLabel(status: ReleaseStatus): string {
  switch (status) {
    case 'announced':
      return $localize`:@@lwConsoleUpdates-releaseAnnounced:Announced`;
    case 'importing':
      return $localize`:@@lwConsoleUpdates-releaseImporting:Importing`;
    case 'available':
      return $localize`:@@lwConsoleUpdates-releaseAvailable:Available`;
    case 'failed':
      return $localize`:@@lwConsoleUpdates-releaseFailed:Import failed`;
    default:
      return $localize`:@@lwConsoleUpdates-releaseInstalled:Installed`;
  }
}

export function policyLabel(policy: UpdatePolicyMode): string {
  switch (policy) {
    case 'notify':
      return $localize`:@@lwConsoleUpdates-policyNotify:Notify only`;
    case 'auto-patch':
      return $localize`:@@lwConsoleUpdates-policyAutoPatch:Patches automatically in maintenance windows`;
    default:
      return $localize`:@@lwConsoleUpdates-policyManual:Manual`;
  }
}

export function sourceLabel(source: string): string {
  switch (source) {
    case 'github':
      return $localize`:@@lwConsoleUpdates-sourceGithub:GitHub releases`;
    case 'mirror':
      return $localize`:@@lwConsoleUpdates-sourceMirror:Mirror`;
    case 'upload':
      return $localize`:@@lwConsoleUpdates-sourceUpload:Upload`;
    case 'installed':
      return $localize`:@@lwConsoleUpdates-sourceInstalled:Installed`;
    default:
      return source;
  }
}

export function rolloutKindLabel(kind: string): string {
  switch (kind) {
    case 'patch':
      return $localize`:@@lwConsoleUpdates-kindPatch:Patch`;
    case 'minor':
      return $localize`:@@lwConsoleUpdates-kindMinor:Minor`;
    case 'major':
      return $localize`:@@lwConsoleUpdates-kindMajor:Major`;
    case 'os':
      return $localize`:@@lwConsoleUpdates-kindOs:Host updates`;
    case 'downgrade':
      return $localize`:@@lwConsoleUpdates-kindDowngrade:Downgrade`;
    default:
      return kind;
  }
}

export function waveLabel(wave: number, phase: string): string {
  if (phase === 'control-plane') return $localize`:@@lwConsoleUpdates-waveControlPlane:Control plane`;

  if (phase === 'canary') return $localize`:@@lwConsoleUpdates-waveCanary:Canary`;

  return $localize`:@@lwConsoleUpdates-wave:Wave ${wave}:wave:`;
}

export function stepKindLabel(kind: string): string {
  switch (kind) {
    case 'components':
      return $localize`:@@lwConsoleUpdates-stepComponents:Components`;
    case 'host':
      return $localize`:@@lwConsoleUpdates-stepHost:Host (drain, reboot)`;
    default:
      return kind;
  }
}

const WEEKDAY_ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function weekdayLabel(day: Weekday): string {
  switch (day) {
    case 'mon':
      return $localize`:@@lwConsoleUpdates-dayMon:Mon`;
    case 'tue':
      return $localize`:@@lwConsoleUpdates-dayTue:Tue`;
    case 'wed':
      return $localize`:@@lwConsoleUpdates-dayWed:Wed`;
    case 'thu':
      return $localize`:@@lwConsoleUpdates-dayThu:Thu`;
    case 'fri':
      return $localize`:@@lwConsoleUpdates-dayFri:Fri`;
    case 'sat':
      return $localize`:@@lwConsoleUpdates-daySat:Sat`;
    default:
      return $localize`:@@lwConsoleUpdates-daySun:Sun`;
  }
}

/** "Tue, Thu 02:00–05:00 (Europe/Berlin)". */
export function windowSchedule(spec: Pick<MaintenanceWindowSpec, 'days' | 'start' | 'end' | 'timeZone'>): string {
  const days = [...(spec.days ?? [])]
    .sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b))
    .map(weekdayLabel)
    .join(', ');

  return `${days} ${spec.start}–${spec.end} (${spec.timeZone})`;
}

/** Which nodes a window selects, in short ("all nodes" for an empty selector). */
export function windowScope(spec: Pick<MaintenanceWindowSpec, 'selector' | 'sites'>): string {
  const parts: string[] = [];

  if (spec.sites?.length) parts.push(`${$localize`:@@lwConsoleUpdates-scopeSites:sites`} ${spec.sites.join(', ')}`);

  if (spec.selector?.names?.length)
    parts.push(`${$localize`:@@lwConsoleUpdates-scopeNodes:nodes`} ${spec.selector.names.join(', ')}`);

  for (const [key, value] of Object.entries(spec.selector?.matchLabels ?? {})) parts.push(`${key}=${value}`);

  for (const expr of spec.selector?.matchExpressions ?? [])
    parts.push(`${expr.key} ${expr.operator}${expr.values?.length ? ` (${expr.values.join(', ')})` : ''}`);

  return parts.length > 0 ? parts.join('; ') : $localize`:@@lwConsoleUpdates-scopeAll:all nodes`;
}

export type WindowTone = 'success' | 'info' | 'secondary';

/** A node's window state: open now, a next opening, or none selecting it. */
export function windowTone(window: NodeWindowState): WindowTone {
  if (window.open) return 'success';

  return window.opensAt ? 'info' : 'secondary';
}

/** The actions the API accepts in a rollout's status (cluster admins only). */
export function rolloutActions(status: RolloutStatus): RolloutAction[] {
  const actions: RolloutAction[] = [];

  if (status === 'planned') actions.push('approve');

  if (status === 'approved' || status === 'running') actions.push('pause');

  if (status === 'paused') actions.push('resume');

  if (status === 'running' || status === 'paused' || status === 'approved') actions.push('rollback');

  if (status === 'planned' || status === 'approved' || status === 'paused') actions.push('cancel');

  return actions;
}

export function rolloutActionLabel(action: RolloutAction): string {
  switch (action) {
    case 'approve':
      return $localize`:@@lwConsoleUpdates-actionApprove:Approve`;
    case 'pause':
      return $localize`:@@lwConsoleUpdates-actionPause:Pause`;
    case 'resume':
      return $localize`:@@lwConsoleUpdates-actionResume:Resume`;
    case 'rollback':
      return $localize`:@@lwConsoleUpdates-actionRollback:Roll back`;
    default:
      return $localize`:@@lwConsoleUpdates-actionCancel:Cancel update`;
  }
}

export function rolloutActionConfirm(action: RolloutAction): { title: string; message: string; danger: boolean } {
  switch (action) {
    case 'pause':
      return {
        title: $localize`:@@lwConsoleUpdates-confirmPauseTitle:Pause the update?`,
        message: $localize`:@@lwConsoleUpdates-confirmPauseMessage:The step in progress finishes; no further step starts until you resume.`,
        danger: false,
      };
    case 'resume':
      return {
        title: $localize`:@@lwConsoleUpdates-confirmResumeTitle:Resume the update?`,
        message: $localize`:@@lwConsoleUpdates-confirmResumeMessage:The rollout continues; a step that failed and was rolled back is tried again.`,
        danger: false,
      };
    case 'rollback':
      return {
        title: $localize`:@@lwConsoleUpdates-confirmRollbackTitle:Roll back the update?`,
        message: $localize`:@@lwConsoleUpdates-confirmRollbackMessage:Every updated node returns to its previous release, in reverse order (nodes first, control-plane members last).`,
        danger: true,
      };
    default:
      return {
        title: $localize`:@@lwConsoleUpdates-confirmCancelTitle:Cancel the update?`,
        message: $localize`:@@lwConsoleUpdates-confirmCancelMessage:The plan stops where it is; nodes keep the release they run now.`,
        danger: true,
      };
  }
}

export interface DiffGroup {
  key: string;
  entries: RolloutDiffEntry[];
}

/** The plan's diff grouped per node or per component (both sorted by name). */
export function groupDiff(diff: RolloutDiffEntry[], by: 'node' | 'component'): DiffGroup[] {
  const groups = new Map<string, RolloutDiffEntry[]>();

  for (const entry of diff) groups.set(entry[by], [...(groups.get(entry[by]) ?? []), entry]);

  const other = by === 'node' ? 'component' : 'node';

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entries]) => ({ key, entries: [...entries].sort((a, b) => a[other].localeCompare(b[other])) }));
}

export function progressPercent(rollout: Pick<Rollout, 'progress'>): number {
  const { done, total } = rollout.progress;

  return total > 0 ? Math.round((done / total) * 100) : 0;
}

export function formatVersion(version: string | null | undefined): string {
  return version ? version : '–';
}
