import { CommonModule, formatDate } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  LOCALE_ID,
  OnDestroy,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleGitFacade,
  ConsolePlansFacade,
  type GitConnection,
  type Plan,
  type PlanApproval,
  type PlanFailureFinding,
  type PlanIssue,
  type PlanNetworkChange,
  type PlanResourceChange,
  type PlanWorkloadChange,
  ConsoleEndpointService,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcDropdownComponent,
  FpcDropdownItemComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormSwitchComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcProgressRowComponent,
  FpcSectionRowComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  type FpcBadgeTone,
  type FpcProgressRowState,
  type FpcTableColumn,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  type FpcTableState,
  FpcKeyValueDirective,
  FpcKeyValueListComponent,
  type FpcKeyValueItem,
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
  PLAN_STATUS_BADGE_TONE,
  pinWarnings,
  planProjects,
  planStatusLabel,
  planSummary,
  planTouched,
} from './plan-format';
import { approvalsAvailable } from '../access/access-format';
import { dlUserLabel } from '../section/data-list';
import { LoadweaverLaneComponent } from '../section/lane.component';

/** While a plan's pull requests are being opened, it is read again this often … */
export const PR_POLL_MS = 3_000;
/** … for at most this long. */
export const PR_POLL_MAX_MS = 120_000;

/**
 * Lanes of the plan review (3.37): the open tab's lanes. The live apply / rollback progress is a full-width row under
 * the header (2026-10-29), not a lane.
 */
export type PlanLane = 'main' | 'diagnostics' | 'failure' | 'pins' | 'side';

/**
 * Plan review (3.8 / 3.12 / 3.19): resource changes with before / after, the compiled effect per network layer
 * (tunnels, routing, policies, DNS), replica moves and the failure analysis, pins, warnings, approvals, and the
 * live progress of an apply or rollback per node and layer. Approve, apply (confirming pins), cancel, discard.
 */
/** A network change's action as a State cell (add / remove / change; unknown ones as they are). */
function networkActionState(action: string): FpcTableState {
  if (action === 'add' || action === 'create')
    return { label: $localize`:@@lwConsolePlanDetail-netAdd:Add`, tone: 'success', icon: 'plus-circle' };

  if (action === 'remove' || action === 'delete')
    return { label: $localize`:@@lwConsolePlanDetail-netRemove:Remove`, tone: 'danger', icon: 'dash-circle' };

  if (action === 'update' || action === 'change' || action === 'modify')
    return { label: $localize`:@@lwConsolePlanDetail-netChange:Change`, tone: 'info', icon: 'pencil' };

  return { label: action, tone: 'info' };
}

/** A workload change's action as a State cell. */
function workloadActionState(action: PlanWorkloadChange['action']): FpcTableState {
  switch (action) {
    case 'start':
      return { label: $localize`:@@lwConsolePlanDetail-wlStart:Start`, tone: 'success', icon: 'play-circle' };
    case 'stop':
      return { label: $localize`:@@lwConsolePlanDetail-wlStop:Stop`, tone: 'warning', icon: 'stop-circle' };
    case 'move':
      return { label: $localize`:@@lwConsolePlanDetail-wlMove:Move`, tone: 'info', icon: 'arrow-left-right' };
    case 'copy':
      return { label: $localize`:@@lwConsolePlanDetail-volumeCopy:volume copy`, tone: 'info', icon: 'files' };
    default:
      return { label: String(action), tone: 'neutral' };
  }
}

/** An issue level, readable. */
function issueLevelLabel(level: string | undefined): string {
  switch (level ?? 'warning') {
    case 'error':
      return $localize`:@@lwConsolePlanDetail-levelError:Error`;
    case 'info':
      return $localize`:@@lwConsolePlanDetail-levelInfo:Info`;
    case 'warning':
      return $localize`:@@lwConsolePlanDetail-levelWarning:Warning`;
    default:
      return level ?? '';
  }
}

/** A failure finding's kind, readable. */
function findingKindLabel(kind: PlanFailureFinding['kind']): string {
  switch (kind) {
    case 'data':
      return $localize`:@@lwConsolePlanDetail-findingData:Data`;
    case 'deployment':
      return $localize`:@@lwConsolePlanDetail-findingDeployment:Deployment`;
    case 'capacity':
      return $localize`:@@lwConsolePlanDetail-findingCapacity:Capacity`;
    default:
      return String(kind);
  }
}

@Component({
  selector: 'loadweaver-plan-detail-page',
  imports: [
    FpcKeyValueDirective,
    FpcKeyValueListComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcDropdownComponent,
    FpcDropdownItemComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcProgressRowComponent,
    FpcSpinnerComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverPlanSourceComponent,
    FpcSectionRowComponent,
    LoadweaverLaneComponent,
  ],
  // Fills its routed outlet / object page tab: the lanes scroll, not the page (3.37).
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  // Plan-level alerts (errors, Git blockers / conflicts) never push the lanes off the screen.
  styles: `
    .lw-plan__alerts {
      max-height: 12rem;
    }

    /* The per-node progress table stays a band under the progress row; the lanes keep the rest of the height. */
    .lw-plan__progress-nodes {
      max-height: 16rem;
    }
  `,
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
  /** Phone lane switch (3.37): the lanes of the open tab, one at a time below md. */
  readonly lane = signal<PlanLane>('main');
  readonly laneTabs = computed<{ id: PlanLane; label: string }[]>(() => {
    const plan = this.plan();

    if (!plan) return [];

    const tabs: { id: PlanLane; label: string }[] = [];

    switch (this.activeTab()) {
      case 'network':
        tabs.push({ id: 'main', label: this.tabNetwork }, { id: 'diagnostics', label: this.diagnosticsTitle });
        break;
      case 'workload':
        tabs.push(
          { id: 'main', label: this.workloadTitle },
          { id: 'failure', label: this.failureTitle },
          { id: 'pins', label: this.pinsTitle },
        );
        break;
      case 'warnings':
        tabs.push({ id: 'main', label: this.tabWarnings });
        break;
      case 'details':
        tabs.push({ id: 'main', label: this.tabDetails });
        break;
      case 'approvals':
        tabs.push({ id: 'main', label: this.tabApprovals });

        if (Object.keys(plan.risk ?? {}).length > 0 || Object.keys(plan.creatorRoles ?? {}).length > 0)
          tabs.push({ id: 'side', label: this.riskTitle });
        break;
      default:
        tabs.push({ id: 'main', label: this.tabChanges });
    }

    return tabs;
  });
  /** The picked lane while the open tab has it, else the tab's main lane. */
  readonly activeLane = computed<PlanLane>(() =>
    this.laneTabs().some((t) => t.id === this.lane()) ? this.lane() : 'main',
  );
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

  /**
   * Fleet mode (3.24): approvals through the fleet when the cluster verifies the fleet's identity claims, else in
   * the cluster's own console.
   */
  protected readonly fleetMode = inject(ConsoleEndpointService).fleetMode;
  readonly approvalsHere = computed(() => approvalsAvailable(this.fleetMode, this.me()));
  /** Pending plan viewed through a fleet that can't approve here: the note in the one pending-notes alert (LW-08). */
  readonly fleetApprovalNote = computed(() => !this.approvalsHere() && this.plan()?.status === 'pending');
  readonly gitBlockedHeading = $localize`:@@lwConsoleGitPlan-blockedHeading:Git is authoritative: merge the pull request`;
  readonly canApprove = computed(() => {
    const plan = this.plan();

    return !!plan && this.approvalsHere() && mayApprove(plan, this.me());
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
  /** Tone of the progress row: failed, running (striped), applied, else neutral; a rollback bar is warning. */
  readonly progressState = computed<FpcProgressRowState>(() => {
    const plan = this.plan();

    if (plan?.progress?.failure || plan?.status === 'failed' || plan?.status === 'rollback-failed') return 'failed';

    if (this.running()) return 'running';

    return plan?.status === 'applied' ? 'success' : 'idle';
  });
  /**
   * The status row under the header, for every status (user, 2026-10-29): the live apply / rollback progress while
   * there is one, else the status as a settled bar — pending / discarded empty and neutral, applied full and green,
   * failed full and red, rolled back full and amber — with the time that matters (applied, else created).
   */
  readonly statusRow = computed<{
    value: number;
    state: FpcProgressRowState;
    variant: 'warning' | null;
    label: string;
    ariaLabel: string;
    /** `''` hides the percentage (a settled status has none). */
    valueText: string | null;
    at: string | null;
    live: boolean;
  } | null>(() => {
    const plan = this.plan();

    if (!plan) return null;

    const progress = plan.progress;
    const state = this.progressState();

    if (progress)
      return {
        value: progress.percent,
        state,
        variant: progress.phase === 'rollback' && state !== 'failed' ? 'warning' : null,
        label: progress.step,
        ariaLabel: progress.phase === 'rollback' ? this.rollbackProgressLabel : this.applyProgressLabel,
        valueText: null,
        at: progress.startedAt,
        live: true,
      };

    const settled = plan.status !== 'pending' && plan.status !== 'discarded' && !this.running();

    return {
      value: settled ? 100 : 0,
      state,
      variant: plan.status === 'rolled-back' ? 'warning' : null,
      label: this.statusLabel(plan.status),
      ariaLabel: this.statusLabel(plan.status),
      valueText: '',
      at: plan.appliedAt ?? plan.createdAt,
      live: this.running(),
    };
  });
  /** The per-node table under the progress row (disclosure, closed by default). */
  readonly progressNodesOpen = signal(false);

  /** Plan state as a tone badge in the header context (3.38 R10). */
  readonly statusTone = PLAN_STATUS_BADGE_TONE;
  readonly statusLabel = planStatusLabel;
  readonly actionTone = CHANGE_ACTION_TONE;
  readonly actionLabel = changeActionLabel;
  readonly nodeBadgeTone = (state: keyof typeof NODE_STATE_TONE): FpcBadgeTone => {
    const tone = NODE_STATE_TONE[state];

    return tone === 'secondary' ? 'neutral' : (tone as FpcBadgeTone);
  };
  /** Per-node apply progress (3.38: `fpc-data-table` instead of a raw table). */
  readonly progressColumns: FpcTableColumn<{ node: string; state: string }>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsolePlanDetail-nodeState:State`,
      type: 'state',
      state: (r) => ({
        label: nodeStateLabel(r.state as keyof typeof NODE_STATE_TONE),
        tone: this.nodeBadgeTone(r.state as keyof typeof NODE_STATE_TONE),
      }),
    },
    {
      id: 'node',
      label: $localize`:@@lwConsolePlanDetail-node:Node`,
      value: (r) => r.node,
      mono: true,
      required: true,
      priority: 1,
    },
    { id: 'layers', label: $localize`:@@lwConsolePlanDetail-layers:Layers`, sortable: false, priority: 2 },
    { id: 'error', label: $localize`:@@lwConsolePlanDetail-colError:Error`, sortable: false, priority: 1 },
  ];

  /** The plan's readable title (D11: its summary, never its id). */
  /** Just the plan's name (user, 2026-10-29): the plans list beside it already says it's a plan. */
  readonly planTitle = (plan: Plan): string => planSummary(plan);
  readonly failedPlanLabel = $localize`:@@lwConsolePlanDetail-failedPlan:the failed plan`;

  /** Changes: State (action) · Resource · project · base generation; the diff in the row detail. */
  readonly changeKeyOf = (change: PlanResourceChange): string => this.changeKey(change);
  readonly expandedKey = computed(() => [...this.expanded()][0] ?? null);
  readonly diffOf = (change: PlanResourceChange) => this.diff(change);
  readonly changeColumns: FpcTableColumn<PlanResourceChange>[] = [
    {
      id: 'action',
      label: $localize`:@@lwConsolePlanDetail-colAction:Action`,
      type: 'state',
      state: (c) => ({ label: changeActionLabel(c.action), tone: this.toneOf(CHANGE_ACTION_TONE[c.action]) }),
    },
    {
      id: 'resource',
      label: $localize`:@@lwConsolePlanDetail-colResource:Resource`,
      value: (c) => `${c.kind} ${c.project ? c.project + '/' : ''}${c.name}`,
      required: true,
      priority: 1,
    },
    {
      id: 'generation',
      label: $localize`:@@lwConsolePlanDetail-baseGeneration:Planned against generation`,
      value: (c) => c.baseGeneration,
      align: 'end',
      priority: 3,
    },
  ];

  /** Network, policy and DNS changes: one table grouped by layer. */
  readonly networkRows = computed(() => this.layers().flatMap((group) => group.changes));
  readonly networkLayer = (change: PlanNetworkChange): string => String(change.layer ?? 'other');
  readonly networkColumns: FpcTableColumn<PlanNetworkChange>[] = [
    {
      id: 'action',
      label: $localize`:@@lwConsolePlanDetail-colAction:Action`,
      type: 'state',
      state: (c) => networkActionState(c.action),
    },
    {
      id: 'summary',
      label: $localize`:@@lwConsolePlanDetail-colChange:Change`,
      value: (c) => c.summary,
      required: true,
      priority: 1,
    },
    { id: 'node', label: $localize`:@@lwConsolePlanDetail-node:Node`, value: (c) => c.node, mono: true, priority: 1 },
    {
      id: 'policies',
      label: $localize`:@@lwConsolePlanDetail-colPolicies:Policies`,
      value: (c) => (c.policies ?? []).join(', '),
      priority: 3,
    },
  ];

  /** Diagnostics, conflicts and warnings: State (level / kind) · message. */
  readonly warningRows = computed<PlanIssue[]>(() => [
    ...this.conflicts().map((c) => ({ ...c, level: 'git-conflict' })),
    ...this.otherWarnings(),
  ]);
  readonly issueColumns: FpcTableColumn<PlanIssue>[] = [
    {
      id: 'level',
      label: $localize`:@@lwConsolePlanDetail-colLevel:Level`,
      type: 'state',
      state: (issue) =>
        issue.level === 'git-conflict'
          ? { label: this.conflictsTitle, tone: 'warning', icon: 'git' }
          : { label: issueLevelLabel(issue.level), tone: issueTone(issue) },
    },
    {
      id: 'message',
      label: $localize`:@@lwConsolePlanDetail-colMessage:Message`,
      value: (issue) => (issue.level === 'git-conflict' ? (issue.message ?? issueText(issue)) : issueText(issue)),
      required: true,
      priority: 1,
    },
  ];

  /** Replica starts, stops, moves and volume copies. */
  readonly workloadColumns: FpcTableColumn<PlanWorkloadChange>[] = [
    {
      id: 'action',
      label: $localize`:@@lwConsolePlanDetail-colAction:Action`,
      type: 'state',
      state: (w) => workloadActionState(w.action),
    },
    {
      id: 'what',
      label: $localize`:@@lwConsolePlanDetail-colWhat:Replica or volume`,
      value: (w) => w.replica ?? w.volume ?? '',
      mono: true,
      required: true,
      priority: 1,
    },
    {
      id: 'where',
      label: $localize`:@@lwConsolePlanDetail-colWhere:Where`,
      value: (w) => (w.from && w.to ? `${w.from} → ${w.to}` : (w.to ?? w.from ?? '')),
      mono: true,
      priority: 1,
    },
    {
      id: 'method',
      label: $localize`:@@lwConsolePlanDetail-colMethod:Method`,
      value: (w) => String(w.methodLabel ?? w.method ?? ''),
      priority: 2,
    },
  ];

  /** Single points of failure. */
  readonly findingColumns: FpcTableColumn<PlanFailureFinding>[] = [
    {
      id: 'kind',
      label: $localize`:@@lwConsolePlanDetail-colRisk:Risk`,
      type: 'state',
      state: (f) => ({ label: findingKindLabel(f.kind), tone: 'warning' }),
    },
    {
      id: 'subject',
      label: $localize`:@@lwConsolePlanDetail-colSubject:Affected`,
      value: (f) => f.subject,
      required: true,
      priority: 1,
    },
    {
      id: 'scope',
      label: $localize`:@@lwConsolePlanDetail-colLoss:When losing`,
      value: (f) => `${f.scope.kind === 'site' ? this.siteLabel : this.nodeLabelText} ${f.scope.name}`,
      priority: 1,
    },
    { id: 'reason', label: $localize`:@@lwConsolePlanDetail-colReason:Reason`, value: (f) => f.reason, priority: 2 },
  ];
  private readonly siteLabel = $localize`:@@lwConsolePlanDetail-site:Site`;
  private readonly nodeLabelText = $localize`:@@lwConsolePlanDetail-node:Node`;

  /** Approvals per project. */
  /** Author / approver label (email, "Deleted user", …), never the raw id (D11). */
  private readonly locale = inject(LOCALE_ID);
  readonly userLabel = dlUserLabel;
  /** The Details tab (2026-10-29: moved out of the header): author, source, times, fix-forward, projects. */
  readonly detailItems = computed<FpcKeyValueItem[]>(() => {
    const plan = this.plan();

    if (!plan) return [];

    const date = (value: string) => formatDate(value, 'medium', this.locale);

    return [
      ...(plan.createdBy
        ? [{ key: 'author', label: this.detailAuthorLabel, value: dlUserLabel(plan.createdBy, plan.createdByEmail) }]
        : []),
      ...(plan.source ? [{ key: 'source', label: this.detailSourceLabel }] : []),
      { key: 'created', label: this.detailCreatedLabel, value: date(plan.createdAt) },
      ...(plan.appliedAt ? [{ key: 'applied', label: this.detailAppliedLabel, value: date(plan.appliedAt) }] : []),
      ...(plan.resolves ? [{ key: 'resolves', label: this.detailResolvesLabel }] : []),
      ...(this.projects().length > 0 ? [{ key: 'projects', label: this.detailProjectsLabel }] : []),
    ];
  });
  readonly detailAuthorLabel = $localize`:@@lwConsolePlanDetail-detailAuthor:Planned by`;
  readonly detailSourceLabel = $localize`:@@lwConsolePlanDetail-detailSource:Source`;
  readonly detailCreatedLabel = $localize`:@@lwConsolePlanDetail-created:Created`;
  readonly detailAppliedLabel = $localize`:@@lwConsolePlanDetail-applied:Applied`;
  readonly detailResolvesLabel = $localize`:@@lwConsolePlanDetail-resolves:Fix-forward for`;
  readonly detailProjectsLabel = $localize`:@@lwConsolePlanDetail-detailProjects:Projects`;
  readonly approvalColumns: FpcTableColumn<PlanApproval>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsolePlanDetail-colState:State`,
      type: 'state',
      state: () => ({
        label: $localize`:@@lwConsolePlanDetail-approved:Approved`,
        tone: 'success',
        icon: 'person-check',
      }),
    },
    {
      id: 'project',
      label: $localize`:@@lwConsolePlanDetail-colProject:Project`,
      value: (a) => a.project,
      required: true,
      priority: 1,
    },
    {
      id: 'user',
      label: $localize`:@@lwConsolePlanDetail-colApprover:Approved by`,
      value: (a) => dlUserLabel(a.userId, a.userEmail),
      priority: 1,
    },
    { id: 'at', label: $localize`:@@lwConsolePlanDetail-colWhen:When`, value: (a) => a.createdAt, priority: 2 },
  ];

  private toneOf(tone: string): FpcBadgeTone {
    return tone === 'secondary' || tone === 'light' ? 'neutral' : (tone as FpcBadgeTone);
  }
  readonly progressRowId = (row: { node: string }) => row.node;
  readonly diagnosticsTitle = $localize`:@@lwConsolePlanDetail-diagnostics:Compiler diagnostics`;
  readonly conflictsTitle = $localize`:@@lwConsoleGitPlan-conflictsTitle:Changed outside Git`;
  readonly loadingLabel = $localize`:@@lwConsolePlanDetail-loading:Loading the plan`;
  readonly tabNetworkShort = $localize`:@@lwConsolePlanDetail-tabNetworkShort:Network`;
  readonly tabWorkloadShort = $localize`:@@lwConsolePlanDetail-tabWorkloadShort:Workload`;
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
  readonly moreLabel = $localize`:@@lwConsoleContents-more:More`;
  readonly searchChangesLabel = $localize`:@@lwConsolePlanDetail-searchChanges:Search changes`;
  readonly applyLabel = $localize`:@@lwConsolePlanDetail-apply:Apply`;
  readonly cancelApplyLabel = $localize`:@@lwConsolePlanDetail-cancel:Cancel apply`;
  readonly applyProgressLabel = $localize`:@@lwConsolePlanDetail-applyProgress:Apply progress`;
  readonly rollbackProgressLabel = $localize`:@@lwConsolePlanDetail-rollbackProgress:Rollback progress`;
  readonly tabChanges = $localize`:@@lwConsolePlanDetail-tabChanges:Changes`;
  readonly tabNetwork = $localize`:@@lwConsolePlanDetail-tabNetwork:Network effect`;
  readonly tabWorkload = $localize`:@@lwConsolePlanDetail-tabWorkload:Workload and failure analysis`;
  readonly tabWarnings = $localize`:@@lwConsolePlanDetail-tabWarnings:Warnings`;
  readonly tabApprovals = $localize`:@@lwConsolePlanDetail-tabApprovals:Approvals`;
  readonly tabDetails = $localize`:@@lwConsolePlanDetail-tabDetails:Details`;
  readonly workloadTitle = $localize`:@@lwConsolePlanDetail-workloadChanges:Replica starts, stops and moves`;
  readonly failureTitle = $localize`:@@lwConsolePlanDetail-failureAnalysis:Failure analysis`;
  readonly pinsTitle = $localize`:@@lwConsolePlanDetail-pins:Pinned images and secret versions`;
  readonly riskTitle = $localize`:@@lwConsolePlanDetail-risk:Why approval may be needed`;
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

    if (change.action === 'unchanged') return;

    // One open diff at a time (the table shows one row detail).
    this.expanded.set(this.expanded().has(key) ? new Set() : new Set([key]));
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

  workloadText(change: Record<string, unknown>): string {
    const from = change['from'] ? String(change['from']) : null;
    const to = change['to'] ? String(change['to']) : null;
    const where = from && to ? `${from} → ${to}` : (to ?? from ?? '');

    const method = change['methodLabel'] ?? change['method'];

    return [change['action'], change['replica'], where, method ? `(${String(method)})` : ''].filter(Boolean).join(' ');
  }
}
