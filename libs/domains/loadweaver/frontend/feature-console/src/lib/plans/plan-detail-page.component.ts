import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnDestroy, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleGitFacade,
  ConsolePlansFacade,
  type GitConnection,
  type PlanResourceChange,
  ConsoleEndpointService,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormSwitchComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcProgressComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { filter, map } from 'rxjs';

import { gitScopeLabel } from '../git/git-format';
import { LoadweaverPlanSourceComponent } from './plan-source.component';
import { diffLines, toYaml, type DiffLine } from './plan-diff';
import {
  CHANGE_ACTION_TONE,
  changeActionLabel,
  gitApplyBlockers,
  gitConflicts,
  groupByLayer,
  hasPendingPullRequests,
  issueText,
  issueTone,
  layerLabel,
  mayApprove,
  mayChange,
  NODE_STATE_TONE,
  nodeStateLabel,
  PLAN_STATUS_ICON,
  PLAN_STATUS_TONE,
  pinWarnings,
  planProjects,
  planStatusLabel,
  planTouched,
} from './plan-format';

/** While a plan's pull requests are being opened, it is read again this often … */
export const PR_POLL_MS = 3_000;
/** … for at most this long. */
export const PR_POLL_MAX_MS = 120_000;

/**
 * Plan review (3.8 / 3.12 / 3.19): resource changes with before / after, the compiled effect per network layer
 * (tunnels, routing, policies, DNS), replica moves and the failure analysis, pins, warnings, approvals, and the
 * live progress of an apply or rollback per node and layer. Approve, apply (confirming pins), cancel, discard.
 */
@Component({
  selector: 'loadweaver-plan-detail-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormSwitchComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcProgressComponent,
    FpcSpinnerComponent,
    FpcStatusBadgeComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverPlanSourceComponent,
  ],
  templateUrl: './plan-detail-page.component.html',
  standalone: true,
})
export class LoadweaverPlanDetailPageComponent implements OnInit, OnDestroy {
  private readonly facade = inject(ConsolePlansFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly git = inject(ConsoleGitFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly plan = toSignal(this.facade.selected$, { initialValue: null });
  readonly loading = toSignal(this.facade.selectedLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.selectedError$, { initialValue: null });
  readonly acting = toSignal(this.facade.acting$, { initialValue: null });
  readonly actionError = toSignal(this.facade.actionError$, { initialValue: null });
  readonly live = toSignal(this.facade.live$, { initialValue: false });
  private readonly me = toSignal(this.access.me$, { initialValue: null });
  /** Readable Git connections: commit / PR links and which scopes are authoritative. */
  readonly gitConnections = toSignal(this.git.connections$, { initialValue: [] as GitConnection[] });

  readonly activeTab = signal<string | null>('changes');
  readonly showUnchanged = signal(false);
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  readonly applyOpen = signal(false);
  readonly pinsConfirmed = signal(false);
  readonly approveOpen = signal(false);
  readonly cancelOpen = signal(false);
  readonly discardOpen = signal(false);
  /** The pull requests stayed pending longer than the console waits for them. */
  readonly prPollTimedOut = signal(false);
  private prPoll: { id: string; timer: ReturnType<typeof setInterval> | null } | null = null;

  /** Fleet mode: approvals stay native — given in the cluster's own console, never through the fleet's relay. */
  protected readonly fleetMode = inject(ConsoleEndpointService).fleetMode;
  readonly canApprove = computed(() => {
    const plan = this.plan();

    return !!plan && !this.fleetMode && mayApprove(plan, this.me());
  });
  readonly canChange = computed(() => {
    const plan = this.plan();

    return !!plan && mayChange(plan, this.me());
  });
  readonly changes = computed(() => {
    const plan = this.plan();

    if (!plan) return [];

    return this.showUnchanged() ? plan.changes : planTouched(plan);
  });
  readonly unchangedCount = computed(() => {
    const plan = this.plan();

    return plan ? plan.changes.length - planTouched(plan).length : 0;
  });
  readonly layers = computed(() => groupByLayer(this.plan()?.networkChanges ?? []));
  readonly pins = computed(() => {
    const plan = this.plan();

    return plan ? pinWarnings(plan) : [];
  });
  readonly otherWarnings = computed(() =>
    (this.plan()?.warnings ?? []).filter((w) => w.pin !== true && w.path !== 'git-conflict'),
  );
  /** Resources changed outside Git since the last sync that this plan would overwrite. */
  readonly conflicts = computed(() => {
    const plan = this.plan();

    return plan ? gitConflicts(plan) : [];
  });
  /** Authoritative Git scopes: the plan is applied by merging its pull request, not here. */
  readonly gitBlockers = computed(() => {
    const plan = this.plan();

    return plan && plan.status === 'pending' ? gitApplyBlockers(plan, this.gitConnections()) : [];
  });
  readonly deploymentStates = computed(() => Object.entries(this.plan()?.deploymentStates ?? {}));
  readonly projects = computed(() => {
    const plan = this.plan();

    return plan ? planProjects(plan) : [];
  });
  readonly progressNodes = computed(() =>
    Object.entries(this.plan()?.progress?.nodes ?? {})
      .map(([node, state]) => ({ node, ...state }))
      .sort((a, b) => a.node.localeCompare(b.node)),
  );
  readonly running = computed(() => {
    const status = this.plan()?.status;

    return status === 'applying' || status === 'rolling-back';
  });

  readonly statusTone = PLAN_STATUS_TONE;
  readonly statusIcon = PLAN_STATUS_ICON;
  readonly statusLabel = planStatusLabel;
  readonly actionTone = CHANGE_ACTION_TONE;
  readonly actionLabel = changeActionLabel;
  readonly nodeTone = NODE_STATE_TONE;
  readonly nodeLabel = nodeStateLabel;
  readonly layerLabel = layerLabel;
  readonly issueText = issueText;
  readonly issueTone = issueTone;
  readonly scopeLabel = gitScopeLabel;
  readonly objectEntries = (value: Record<string, unknown> | null | undefined) => Object.entries(value ?? {});

  readonly title = $localize`:@@lwConsolePlanDetail-title:Plan`;
  readonly backLabel = $localize`:@@lwConsolePlanDetail-back:All plans`;
  readonly approveLabel = $localize`:@@lwConsolePlanDetail-approve:Approve`;
  readonly discardLabel = $localize`:@@lwConsolePlanDetail-discard:Discard`;
  readonly applyLabel = $localize`:@@lwConsolePlanDetail-apply:Apply`;
  readonly cancelApplyLabel = $localize`:@@lwConsolePlanDetail-cancel:Cancel apply`;
  readonly applyProgressLabel = $localize`:@@lwConsolePlanDetail-applyProgress:Apply progress`;
  readonly rollbackProgressLabel = $localize`:@@lwConsolePlanDetail-rollbackProgress:Rollback progress`;
  readonly tabChanges = $localize`:@@lwConsolePlanDetail-tabChanges:Changes`;
  readonly tabNetwork = $localize`:@@lwConsolePlanDetail-tabNetwork:Network effect`;
  readonly tabWorkload = $localize`:@@lwConsolePlanDetail-tabWorkload:Workload and failure analysis`;
  readonly tabWarnings = $localize`:@@lwConsolePlanDetail-tabWarnings:Warnings`;
  readonly tabApprovals = $localize`:@@lwConsolePlanDetail-tabApprovals:Approvals`;
  readonly approveTitle = $localize`:@@lwConsolePlanDetail-approveTitle:Approve the plan?`;
  readonly approveMessage = $localize`:@@lwConsolePlanDetail-approveMessage:Approving lets the plan be applied with its changes as shown. Review the diff first.`;
  readonly approveConfirm = $localize`:@@lwConsolePlanDetail-approveConfirm:Approve`;
  readonly approveCancel = $localize`:@@lwConsolePlanDetail-approveCancel:Not now`;
  readonly cancelTitle = $localize`:@@lwConsolePlanDetail-cancelTitle:Cancel the apply?`;
  readonly cancelMessage = $localize`:@@lwConsolePlanDetail-cancelMessage:The apply stops at the next safe point and rolls back automatically.`;
  readonly cancelConfirm = $localize`:@@lwConsolePlanDetail-cancelConfirm:Cancel apply`;
  readonly discardTitle = $localize`:@@lwConsolePlanDetail-discardTitle:Discard the plan?`;
  readonly discardMessage = $localize`:@@lwConsolePlanDetail-discardMessage:The plan is kept as discarded and can no longer be applied.`;
  readonly discardConfirm = $localize`:@@lwConsolePlanDetail-discardConfirm:Discard`;
  readonly keepLabel = $localize`:@@lwConsolePlanDetail-keep:Keep`;
  readonly applyTitle = $localize`:@@lwConsolePlanDetail-applyTitle:Apply the plan?`;
  readonly gitBlockedTitle = $localize`:@@lwConsoleGitPlan-applyBlocked:Git is authoritative for this scope: merge the pull request to apply`;

  private readonly diffCache = new WeakMap<PlanResourceChange, DiffLine[]>();

  constructor() {
    // Pull requests of an authoritative scope are opened in the background: read the plan again until their links
    // are there (at most PR_POLL_MAX_MS per plan).
    effect(() => {
      const plan = this.plan();
      const pending = hasPendingPullRequests(plan);

      untracked(() => this.watchPendingPullRequests(plan?.id ?? null, pending));
    });
  }

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map((params) => params.get('id')),
        filter((id): id is string => !!id),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((id) => {
        this.expanded.set(new Set());
        this.facade.open(id);
      });
    this.access.load();
    this.git.load(true);
    this.facade.connectLive();
  }

  ngOnDestroy(): void {
    this.facade.disconnectLive();
    this.stopPrPoll();
    this.prPoll = null;
  }

  private watchPendingPullRequests(id: string | null, pending: boolean): void {
    if (!id || !pending) {
      this.stopPrPoll();
      this.prPoll = null;
      this.prPollTimedOut.set(false);

      return;
    }

    // Already polling this plan, or gave up on it.
    if (this.prPoll?.id === id) return;

    this.stopPrPoll();
    this.prPollTimedOut.set(false);

    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started >= PR_POLL_MAX_MS) {
        this.stopPrPoll();
        this.prPollTimedOut.set(true);

        return;
      }

      this.facade.refresh(id);
    }, PR_POLL_MS);

    this.prPoll = { id, timer };
  }

  private stopPrPoll(): void {
    if (this.prPoll?.timer) clearInterval(this.prPoll.timer);

    if (this.prPoll) this.prPoll.timer = null;
  }

  changeKey(change: PlanResourceChange): string {
    return `${change.kind}/${change.project ?? ''}/${change.name}`;
  }

  toggle(change: PlanResourceChange): void {
    const key = this.changeKey(change);
    const next = new Set(this.expanded());

    if (next.has(key)) next.delete(key);
    else next.add(key);

    this.expanded.set(next);
  }

  isExpanded(change: PlanResourceChange): boolean {
    return this.expanded().has(this.changeKey(change));
  }

  diff(change: PlanResourceChange): DiffLine[] {
    let lines = this.diffCache.get(change);

    if (!lines) {
      lines = diffLines(toYaml(change.before), toYaml(change.after));
      this.diffCache.set(change, lines);
    }

    return lines;
  }

  diffClass(line: DiffLine): string {
    return line.type === 'added'
      ? 'text-success-emphasis bg-success-subtle'
      : line.type === 'removed'
        ? 'text-danger-emphasis bg-danger-subtle'
        : '';
  }

  diffPrefix(line: DiffLine): string {
    return line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  ';
  }

  /** Asks first: an approval lets the plan be applied. */
  approve(): void {
    if (this.plan()) this.approveOpen.set(true);
  }

  confirmApprove(): void {
    const plan = this.plan();

    if (plan) this.facade.approve(plan.id);

    this.approveOpen.set(false);
  }

  openApply(): void {
    this.pinsConfirmed.set(false);
    this.facade.clearActionError();
    this.applyOpen.set(true);
  }

  confirmApply(): void {
    const plan = this.plan();

    if (!plan || (this.pins().length > 0 && !this.pinsConfirmed())) return;

    this.facade.apply(plan.id, this.pins().length > 0);
    this.applyOpen.set(false);
  }

  confirmCancel(): void {
    const plan = this.plan();

    if (plan) this.facade.cancel(plan.id);

    this.cancelOpen.set(false);
  }

  confirmDiscard(): void {
    const plan = this.plan();

    if (plan) this.facade.discard(plan.id);

    this.discardOpen.set(false);
  }

  dismissActionError(): void {
    this.facade.clearActionError();
  }

  shortId(id: string): string {
    return id.slice(0, 8);
  }

  workloadText(change: Record<string, unknown>): string {
    const from = change['from'] ? String(change['from']) : null;
    const to = change['to'] ? String(change['to']) : null;
    const where = from && to ? `${from} → ${to}` : (to ?? from ?? '');

    const method = change['methodLabel'] ?? change['method'];

    return [change['action'], change['replica'], where, method ? `(${String(method)})` : ''].filter(Boolean).join(' ');
  }
}
