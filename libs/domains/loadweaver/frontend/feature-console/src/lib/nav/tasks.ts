import type {
  Alert,
  AuditEntry,
  BackupRestore,
  ConsoleNode,
  FleetOperation,
  NodeLifecycle,
  Plan,
  PlanStatus,
  Rollout,
} from '@forepath/loadweaver/frontend/data-access-console';

import { lifecycleLabel } from '../nodes/node-format';
import { planStatusLabel } from '../plans/plan-format';
import { dlUserLabel } from '../section/data-list';

/** A control of a running task where the API offers one (plan cancel-apply, rollout pause / resume / cancel, fleet
 * operation cancel). `confirm`: ask first (cancelling rolls back / stops the work). */
export interface TaskControl {
  action: 'cancel' | 'pause' | 'resume';
  label: string;
  icon: string;
  confirm: boolean;
}

/** One long-running piece of work (3.37 task dock): normalized from plans, rollouts, restores, node lifecycles and
 * fleet operations. */
export interface TaskEntry {
  id: string;
  kind: 'plan' | 'rollout' | 'restore' | 'node' | 'fleet-operation';
  title: string;
  status: string;
  running: boolean;
  failed: boolean;
  /** 0–100 when known. */
  progress: number | null;
  at: string | null;
  link: string[];
  queryParams?: Record<string, string>;
  /** Controls offered while the task runs (empty / absent: none). */
  controls?: TaskControl[];
}

const CONTROL: Record<TaskControl['action'], TaskControl> = {
  cancel: { action: 'cancel', label: $localize`:@@lwConsoleTasks-cancel:Cancel`, icon: 'bi-x-octagon', confirm: true },
  pause: { action: 'pause', label: $localize`:@@lwConsoleTasks-pause:Pause`, icon: 'bi-pause-circle', confirm: false },
  resume: {
    action: 'resume',
    label: $localize`:@@lwConsoleTasks-resume:Resume`,
    icon: 'bi-play-circle',
    confirm: false,
  },
};

/** One event of the dock's Events tab: an audit entry or an alert firing / resolving. */
export interface EventEntry {
  id: string;
  kind: 'audit' | 'alert';
  title: string;
  detail: string;
  at: string;
  tone: 'danger' | 'warning' | 'success' | 'secondary';
  link: string[] | null;
}

const RUNNING_PLAN = new Set(['applying', 'rolling-back']);
const FAILED_PLAN = new Set(['failed', 'rollback-failed']);
const RUNNING_ROLLOUT = new Set(['running', 'rolling-back', 'paused']);
const FAILED_ROLLOUT = new Set(['rollback-failed']);
/** Finished work stays in the dock for a day. */
const RECENT_MS = 24 * 3_600_000;

function recent(at: string | null | undefined, now: number): boolean {
  return !!at && now - Date.parse(at) < RECENT_MS;
}

export function planTasks(plans: readonly Plan[], now = Date.now()): TaskEntry[] {
  return plans
    .filter(
      (p) =>
        RUNNING_PLAN.has(p.status) ||
        ((p.status === 'applied' || FAILED_PLAN.has(p.status) || p.status === 'rolled-back') &&
          recent(p.appliedAt ?? p.createdAt, now)),
    )
    .map((p) => ({
      id: `plan:${p.id}`,
      kind: 'plan' as const,
      title: $localize`:@@lwConsoleTasks-plan:Plan ${p.id.slice(0, 8)}:id:`,
      status: p.status,
      running: RUNNING_PLAN.has(p.status),
      failed: FAILED_PLAN.has(p.status),
      progress: null,
      at: p.appliedAt ?? p.createdAt,
      link: ['/activity/plans', p.id],
      // `POST /plans/:id/cancel` stops an applying plan at the next safe point (then it rolls back).
      controls: p.status === 'applying' ? [CONTROL.cancel] : [],
    }));
}

export function rolloutTasks(rollouts: readonly Rollout[], now = Date.now()): TaskEntry[] {
  return rollouts
    .filter((r) => RUNNING_ROLLOUT.has(r.status) || recent(r.finishedAt, now))
    .map((r) => ({
      id: `rollout:${r.id}`,
      kind: 'rollout' as const,
      title: $localize`:@@lwConsoleTasks-rollout:Update to ${r.toVersion}:version:`,
      status: r.status,
      running: RUNNING_ROLLOUT.has(r.status),
      failed: FAILED_ROLLOUT.has(r.status),
      progress: r.progress.total > 0 ? Math.round((r.progress.done / r.progress.total) * 100) : null,
      at: r.startedAt ?? r.createdAt,
      link: ['/delivery/updates/rollouts', r.id],
      controls:
        r.status === 'running'
          ? [CONTROL.pause, CONTROL.cancel]
          : r.status === 'paused'
            ? [CONTROL.resume, CONTROL.cancel]
            : [],
    }));
}

export function restoreTasks(restores: readonly BackupRestore[], now = Date.now()): TaskEntry[] {
  return restores
    .filter((r) => r.status === 'pending' || r.status === 'running' || recent(r.finishedAt, now))
    .map((r) => ({
      id: `restore:${r.id}`,
      kind: 'restore' as const,
      title: $localize`:@@lwConsoleTasks-restore:Restore ${r.project}:project:/${r.name}:name:`,
      status: r.status,
      running: r.status === 'pending' || r.status === 'running',
      failed: r.status === 'failed',
      progress: null,
      at: r.startedAt,
      link: ['/operate/backups/restores'],
      queryParams: { project: r.project },
    }));
}

export function nodeTasks(nodes: readonly ConsoleNode[]): TaskEntry[] {
  return nodes
    .filter((n) => n.lifecycle === 'draining' || n.lifecycle === 'leaving' || n.lifecycle === 'importing')
    .map((n) => ({
      id: `node:${n.name}`,
      kind: 'node' as const,
      title: $localize`:@@lwConsoleTasks-node:Node ${n.name}:name:`,
      status: n.lifecycle,
      running: true,
      failed: false,
      progress: null,
      at: null,
      link: ['/resources', 'node', n.name],
    }));
}

/** Fleet operations (cross-cluster restore / clone / final backup): running or waiting, or finished within a day. */
export function fleetOperationTasks(operations: readonly FleetOperation[], now = Date.now()): TaskEntry[] {
  return operations
    .filter((o) => o.status === 'running' || o.status === 'waiting' || recent(o.updatedAt, now))
    .map((o) => {
      const running = o.status === 'running' || o.status === 'waiting';
      const steps = o.steps.length;
      const done = o.steps.filter((s) => s.status === 'succeeded' || s.status === 'skipped').length;

      return {
        id: `fleet-operation:${o.id}`,
        kind: 'fleet-operation' as const,
        title: $localize`:@@lwConsoleTasks-fleetOperation:Fleet ${o.kind}:kind:`,
        status: o.status,
        running,
        failed: o.status === 'failed',
        progress: steps > 0 ? Math.round((done / steps) * 100) : null,
        at: o.createdAt,
        link: ['/fleet/operations'],
        controls: running ? [CONTROL.cancel] : [],
      };
    });
}

/** The API id of a task (`plan:<id>` → `<id>`). */
export function taskTargetId(task: Pick<TaskEntry, 'id' | 'kind'>): string {
  return task.id.slice(task.kind.length + 1);
}

/** Running first, then newest first. */
export function sortTasks(tasks: readonly TaskEntry[]): TaskEntry[] {
  return [...tasks].sort(
    (a, b) => Number(b.running) - Number(a.running) || (Date.parse(b.at ?? '') || 0) - (Date.parse(a.at ?? '') || 0),
  );
}

export function auditEvents(entries: readonly AuditEntry[]): EventEntry[] {
  return entries.map((e) => ({
    id: `audit:${e.seq}`,
    kind: 'audit' as const,
    title: e.action,
    detail: `${e.target} · ${(e.actorType === 'user' && dlUserLabel(e.actorId, e.actorEmail)) || e.actorId || e.actorType}`,
    at: e.at,
    tone: /fail|denied|error/.test(e.action) ? ('danger' as const) : ('secondary' as const),
    link: null,
  }));
}

export function alertEvents(alerts: readonly Alert[]): EventEntry[] {
  return alerts
    .filter((a) => !!(a.resolvedAt ?? a.firedAt))
    .map((a) => ({
      id: `alert:${a.id}`,
      kind: 'alert' as const,
      title: a.title,
      detail: a.state,
      at: (a.state === 'resolved' ? a.resolvedAt : a.firedAt) ?? '',
      tone:
        a.state === 'resolved'
          ? ('success' as const)
          : a.state === 'firing'
            ? ('danger' as const)
            : ('warning' as const),
      link: ['/observe/alerts', a.id],
    }));
}

/** Newest first, at most `limit`. */
export function mergeEvents(events: readonly EventEntry[], limit = 100): EventEntry[] {
  return [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}

/** Free-text filter over title / status / detail (the dock's own search). */
export function matchesTask(entry: { title: string; status?: string; detail?: string }, query: string): boolean {
  const q = query.trim().toLowerCase();

  return !q || [entry.title, entry.status ?? '', entry.detail ?? ''].some((v) => v.toLowerCase().includes(q));
}

/**
 * Translated status of a task (3.38 R10: sentence case, never the raw enum): plans and nodes reuse their labels, the
 * other kinds share the generic run states.
 */
export function taskStatusLabel(task: Pick<TaskEntry, 'kind' | 'status'>): string {
  if (task.kind === 'plan') return planStatusLabel(task.status as PlanStatus);

  if (task.kind === 'node') return lifecycleLabel(task.status as NodeLifecycle);

  switch (task.status) {
    case 'pending':
      return $localize`:@@lwConsoleTasks-statusPending:Pending`;
    case 'running':
      return $localize`:@@lwConsoleTasks-statusRunning:Running`;
    case 'waiting':
      return $localize`:@@lwConsoleTasks-statusWaiting:Waiting`;
    case 'paused':
      return $localize`:@@lwConsoleTasks-statusPaused:Paused`;
    case 'rolling-back':
      return $localize`:@@lwConsoleTasks-statusRollingBack:Rolling back`;
    case 'rolled-back':
      return $localize`:@@lwConsoleTasks-statusRolledBack:Rolled back`;
    case 'rollback-failed':
      return $localize`:@@lwConsoleTasks-statusRollbackFailed:Rollback failed`;
    case 'succeeded':
    case 'completed':
    case 'done':
      return $localize`:@@lwConsoleTasks-statusSucceeded:Succeeded`;
    case 'failed':
      return $localize`:@@lwConsoleTasks-statusFailed:Failed`;
    case 'cancelled':
    case 'canceled':
      return $localize`:@@lwConsoleTasks-statusCancelled:Cancelled`;
    default:
      return task.status;
  }
}
