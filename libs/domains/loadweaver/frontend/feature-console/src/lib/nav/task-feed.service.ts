import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import {
  BackupsService,
  AlertsService,
  ConsoleAuditService,
  ConsoleEndpointService,
  FleetService,
  NodesService,
  PlansService,
  UpdatesService,
} from '@forepath/loadweaver/frontend/data-access-console';
import { catchError, defer, forkJoin, type Observable, of, Subscription, timer } from 'rxjs';

import { apiErrorMessage } from '../workspace/workspace-draft.store';
import {
  alertEvents,
  auditEvents,
  fleetOperationTasks,
  mergeEvents,
  nodeTasks,
  planTasks,
  restoreTasks,
  rolloutTasks,
  sortTasks,
  taskTargetId,
  type EventEntry,
  type TaskControl,
  type TaskEntry,
} from './tasks';

/** Polling while the dock is open / closed (the badge still counts running work). */
const OPEN_MS = 10_000;
const CLOSED_MS = 30_000;

/** A source that may fail (role, relay, endpoint missing) — synchronously too — counts as empty. */
function safe<T>(source: () => Observable<T[]>): Observable<T[]> {
  return defer(source).pipe(catchError(() => of([] as T[])));
}

/**
 * The task dock's feed (3.37 P4): long-running work (plan applies / rollbacks, update rollouts, restores, node drains /
 * leaves / imports) and the latest events (audit, alert fires / resolves), polled client-side (`GET /activity` stays
 * a candidate). Each source is optional: what the role may not read stays empty.
 */
@Injectable({ providedIn: 'root' })
export class ConsoleTaskFeedService {
  private readonly plans = inject(PlansService);
  private readonly updates = inject(UpdatesService);
  private readonly backups = inject(BackupsService);
  private readonly nodes = inject(NodesService);
  private readonly audit = inject(ConsoleAuditService);
  private readonly alerts = inject(AlertsService);
  private readonly fleet = inject(FleetService);
  private readonly endpoints = inject(ConsoleEndpointService);
  private poll: Subscription | null = null;
  private infrastructure: () => boolean = () => false;

  readonly tasks = signal<TaskEntry[]>([]);
  readonly events = signal<EventEntry[]>([]);
  readonly loading = signal(false);
  readonly running = computed(() => this.tasks().filter((t) => t.running).length);
  /** The dock is expanded (faster polling, events loaded). */
  readonly open = signal(false);
  /** A task control in flight (task id) and the last control error. */
  readonly controlling = signal<string | null>(null);
  readonly controlError = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Starts polling (after sign-in); `infrastructure` adds rollouts and node lifecycles. */
  start(infrastructure: () => boolean): void {
    this.stop();
    this.infrastructure = infrastructure;
    this.poll = timer(0, OPEN_MS).subscribe((tick) => {
      // Closed dock: every third tick only.
      if (this.open() || tick % Math.round(CLOSED_MS / OPEN_MS) === 0) this.refresh(infrastructure());
    });
  }

  stop(): void {
    this.poll?.unsubscribe();
    this.poll = null;
  }

  refreshNow(): void {
    if (this.poll) this.refresh(this.infrastructure());
  }

  refresh(infrastructure: boolean): void {
    this.loading.set(true);
    // Fleet level (no cluster open): only the fleet's operations; the cluster lists would hit the relay without an id.
    const cluster = !this.endpoints.fleetMode || this.endpoints.activeClusterId() !== null;

    forkJoin({
      plans: cluster ? safe(() => this.plans.list({ limit: 50 })) : of([]),
      rollouts: cluster && infrastructure ? safe(() => this.updates.rollouts(20)) : of([]),
      restores: cluster ? safe(() => this.backups.restores()) : of([]),
      nodes: cluster && infrastructure ? safe(() => this.nodes.list()) : of([]),
      audit:
        cluster && this.open()
          ? defer(() => this.audit.list({ limit: 50 })).pipe(catchError(() => of(null)))
          : of(null),
      alerts: cluster && this.open() ? safe(() => this.alerts.list({ state: 'all', limit: 50 })) : of([]),
      // Fleet operations live at the fleet (fleet mode only).
      operations: this.endpoints.fleetMode ? safe(() => this.fleet.operations({ limit: 20 })) : of([]),
    }).subscribe(({ plans, rollouts, restores, nodes, audit, alerts, operations }) => {
      this.tasks.set(
        sortTasks([
          ...planTasks(plans),
          ...rolloutTasks(rollouts),
          ...restoreTasks(restores),
          ...nodeTasks(nodes),
          ...fleetOperationTasks(operations),
        ]),
      );

      if (this.open()) this.events.set(mergeEvents([...auditEvents(audit?.entries ?? []), ...alertEvents(alerts)]));

      this.loading.set(false);
    });
  }

  /**
   * Runs a task control through the existing API (plan cancel-apply, rollout pause / resume / cancel, fleet operation
   * cancel); the server checks the rights (an error shows in the dock), the feed refreshes afterwards.
   */
  control(task: TaskEntry, control: TaskControl): void {
    const id = taskTargetId(task);
    const call: Observable<unknown> | null =
      task.kind === 'plan' && control.action === 'cancel'
        ? this.plans.cancel(id)
        : task.kind === 'rollout'
          ? this.updates.act(id, control.action)
          : task.kind === 'fleet-operation' && control.action === 'cancel'
            ? this.fleet.cancelOperation(id)
            : null;

    if (!call) return;

    this.controlling.set(task.id);
    this.controlError.set(null);
    call.subscribe({
      next: () => {
        this.controlling.set(null);
        this.refreshNow();
      },
      error: (error: unknown) => {
        this.controlling.set(null);
        this.controlError.set(apiErrorMessage(error));
      },
    });
  }
}
