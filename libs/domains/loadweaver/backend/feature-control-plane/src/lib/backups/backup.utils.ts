import {
  BACKUP_RETENTION_RULES,
  matchesSelector,
  type BackupPolicySpec,
  type BackupRetention,
} from '@forepath/loadweaver/shared/util-model';
import { previousRun } from '@forepath/loadweaver/shared/util-scheduler';

/**
 * Pure parts of the backup control plane (3.20): retention, which volumes a policy selects, when a policy is due,
 * the deletion rules (second admin + delay) and what pins / inbox items follow from the key state.
 */

// ----------------------------------------------------------------------------------------------- retention

export type RetentionReason = (typeof BACKUP_RETENTION_RULES)[number];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Wall-clock parts of an instant in a time zone. */
function parts(at: Date, timeZone: string): { year: number; month: number; day: number; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
  });
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));

  return { year: Number(p['year']), month: Number(p['month']), day: Number(p['day']), hour: Number(p['hour']) };
}

/** ISO 8601 week (`2026-W43`) of a calendar date. */
export function isoWeek(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;

  date.setUTCDate(date.getUTCDate() + 4 - weekday);

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);

  return `${date.getUTCFullYear()}-W${pad(week)}`;
}

function bucket(rule: Exclude<RetentionReason, 'keepLast'>, at: Date, timeZone: string): string {
  const p = parts(at, timeZone);

  switch (rule) {
    case 'hourly':
      return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}`;
    case 'daily':
      return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    case 'weekly':
      return isoWeek(p.year, p.month, p.day);
    case 'monthly':
      return `${p.year}-${pad(p.month)}`;
    case 'yearly':
      return `${p.year}`;
  }
}

/**
 * Which snapshots a retention keeps (restic / Kopia semantics): the newest `keepLast`, and per hour / day / week /
 * month / year the newest snapshot of that period, for the given number of periods (periods without snapshots
 * don't count). The newest snapshot is always kept. Returns the keep reasons per id; ids not in the map go.
 */
export function applyRetention(
  snapshots: ReadonlyArray<{ id: string; time: Date }>,
  retention: BackupRetention,
  timeZone = 'UTC',
): Map<string, RetentionReason[]> {
  const sorted = [...snapshots].sort((a, b) => b.time.getTime() - a.time.getTime() || a.id.localeCompare(b.id));
  const keep = new Map<string, RetentionReason[]>();
  const add = (id: string, reason: RetentionReason) => keep.set(id, [...(keep.get(id) ?? []), reason]);

  sorted.slice(0, Math.max(1, retention.keepLast)).forEach((s) => add(s.id, 'keepLast'));

  for (const rule of ['hourly', 'daily', 'weekly', 'monthly', 'yearly'] as const) {
    const limit = retention[rule];
    let last: string | null = null;
    let count = 0;

    if (limit <= 0) continue;

    for (const s of sorted) {
      const key = bucket(rule, s.time, timeZone);

      if (key === last) continue;

      last = key;
      add(s.id, rule);

      if (++count >= limit) break;
    }
  }

  return keep;
}

/** Whether `next` keeps less than `previous` in any rule (that needs a second admin + delay, 3.20). */
export function retentionShorter(previous: BackupRetention, next: BackupRetention): boolean {
  return BACKUP_RETENTION_RULES.some((rule) => next[rule] < previous[rule]);
}

/** What applies until a shortening is approved: every rule at its longer value. */
export function retentionMax(a: BackupRetention, b: BackupRetention): BackupRetention {
  return Object.fromEntries(BACKUP_RETENTION_RULES.map((r) => [r, Math.max(a[r], b[r])])) as BackupRetention;
}

export function sameRetention(a: BackupRetention, b: BackupRetention): boolean {
  return BACKUP_RETENTION_RULES.every((r) => a[r] === b[r]);
}

// --------------------------------------------------------------------------------------------- selection

export interface VolumeCandidate {
  /** `<project>/<deployment>/<volume>` */
  id: string;
  project: string;
  deployment: string;
  volume: string;
  deploymentLabels: Record<string, string>;
}

/** Volumes a policy selects; project policies only ever select volumes of their own project. */
export function policyVolumes(
  policy: { project: string | null; spec: Pick<BackupPolicySpec, 'selector'> },
  volumes: readonly VolumeCandidate[],
): VolumeCandidate[] {
  const selector = policy.spec.selector ?? {};

  return volumes.filter(
    (v) =>
      (policy.project === null || v.project === policy.project) &&
      (!selector.projects?.length || selector.projects.includes(v.project)) &&
      (!selector.volumes?.length || selector.volumes.includes(v.volume)) &&
      (!selector.deployments ||
        matchesSelector(selector.deployments, { name: v.deployment, labels: v.deploymentLabels })),
  );
}

/**
 * The latest scheduled time of a policy within the last day (`null` if none fired): computed once per policy and
 * tick; a volume is due when its last backup started before it. Missed runs collapse into one, and a volume that
 * was never backed up waits for the next scheduled time (or a manual "back up now").
 */
export function latestScheduled(spec: Pick<BackupPolicySpec, 'schedules' | 'timeZone'>, now: Date): Date | null {
  let latest: Date | null = null;

  for (const schedule of spec.schedules) {
    const at = previousRun(schedule, spec.timeZone ?? 'UTC', now, undefined, 1);

    if (at && (!latest || at > latest)) latest = at;
  }

  return latest;
}

export function volumeDue(latest: Date | null, lastStartedAt: Date | null): boolean {
  return !!latest && (!lastStartedAt || lastStartedAt < latest);
}

// ------------------------------------------------------------------------------------------------ deletions

export const DEFAULT_DELETION_DELAY_HOURS = 72;
export const DELETION_DELAY_ENV = 'LOADWEAVER_BACKUP_DELETION_DELAY_HOURS';

/** Delay before an approved deletion / retention shortening takes effect (≥ 1 h; default 72 h). */
export function deletionDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const hours = Number(env[DELETION_DELAY_ENV] ?? DEFAULT_DELETION_DELAY_HOURS);

  return (Number.isFinite(hours) && hours >= 1 ? hours : DEFAULT_DELETION_DELAY_HOURS) * 3_600_000;
}

export interface DeletionRequestView {
  state: 'pending' | 'approved' | 'executed' | 'cancelled';
  requestedBy: string;
  notBefore: Date;
}

/** Why an admin can't approve a request (null = may approve): never the requester, only pending ones. */
export function approvalRefusal(request: DeletionRequestView, approver: { id: string; admin: boolean }): string | null {
  if (!approver.admin) return 'only an admin of the scope approves backup deletions';

  if (request.state !== 'pending') return `the request is ${request.state}`;

  if (approver.id === request.requestedBy) return 'a second admin has to approve (not the requester)';

  return null;
}

/** Approved and the delay passed. */
export function deletionDue(request: DeletionRequestView, now: Date): boolean {
  return request.state === 'approved' && now.getTime() >= request.notBefore.getTime();
}

// ----------------------------------------------------------------------------------------------- key state

export interface BackupKeyState {
  generation: number | null;
  kitConfirmed: boolean;
  escrowed: boolean;
}

/**
 * Pins of the backup setup (3.12 / 3.20): unrecoverable while the active generation's kit isn't confirmed (a KMS
 * escrow alone doesn't confirm a kit, but makes the backups recoverable); not surviving the loss of the cluster
 * while no external target exists.
 */
export function backupPins(keys: BackupKeyState, externalTargets: number, policies: number): string[] {
  const pins: string[] = [];

  if (policies === 0) return pins;

  if (!keys.kitConfirmed && !keys.escrowed)
    pins.push('backups not recoverable: the recovery kit of the backup key is not confirmed (and no KMS escrow)');

  if (externalTargets === 0)
    pins.push("backups don't survive the loss of the cluster: no external backup target holds a copy");

  return pins;
}
