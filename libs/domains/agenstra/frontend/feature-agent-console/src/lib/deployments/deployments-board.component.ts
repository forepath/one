import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  LOCALE_ID,
  NgZone,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  AgentsFacade,
  ClientsFacade,
  ContainerSocketFacade,
  WorkspaceDeploymentsFacade,
  WorkspaceDeploymentsService,
  type AgentResponseDto,
  type ClientResponseDto,
  type CreateDeploymentWorkflowDto,
  type TriggerDeploymentWorkflowDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  DEPLOYMENT_RUN_STATUSES,
  isDeploymentRunActive,
  type DeploymentRunJobSummary,
  type DeploymentRunStatus,
  type DeploymentRunSummary,
  type DeploymentWorkflowApprovalStatus,
  type DeploymentWorkflowSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcBackLinkComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcDropdownComponent,
  FpcDropdownItemComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcModalComponent,
  FpcPageHeaderComponent,
  FpcSectionColumnComponent,
  FpcSectionRowComponent,
  FpcSpinnerComponent,
  FpcTableCellDirective,
  FPC_DEFAULT_PAGE_SIZE,
  fpcCopyText,
  fpcFormatDateTime,
  fpcRunBulk,
  type FpcMenuItem,
  type FpcTableColumn,
  type FpcTableSort,
  type FpcTableState,
} from '@forepath/shared/frontend/ui-components';
import {
  EMPTY,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  filter,
  Observable,
  firstValueFrom,
  map,
  of,
  skip,
  switchMap,
  take,
} from 'rxjs';

import { resolveNamedDisplayLabel } from '../display-name.util';
import { AG_DL_DELETE, AG_DL_EDIT, agBulkSummary, agCopyIdItem, agOpenItem } from '../shared/data-list';
import { WorkspaceChipComponent } from '../shared/workspace-chip.component';
import { WorkspaceSwitchTableComponent } from '../shared/workspace-switch-table.component';

import {
  deploymentLogFileName,
  deploymentProviderIcon,
  deploymentProviderLabel,
  deploymentRunState,
  deploymentRunStatusLabel,
  deploymentTriggerLabel,
  deploymentWorkflowPendingLabel,
  deploymentWorkflowState,
  isDeploymentWorkflowPending,
  sortNewestStartedFirst,
} from './deployment-labels';
import { DeploymentTriggerModalComponent } from './deployment-trigger-modal.component';
import { DeploymentWorkflowEditorComponent } from './deployment-workflow-editor.component';

/** Debounce for the server-side searches (typing) and the run detail reload after a live status change. */
const SEARCH_DEBOUNCE_MS = 300;
const RUN_RELOAD_DEBOUNCE_MS = 1000;
/** While the opened run is active its jobs are refreshed this often (the controller refreshes it from the provider). */
const ACTIVE_RUN_REFRESH_MS = 15_000;

type BulkTone = 'success' | 'warning' | 'danger';

/**
 * Deployment workflows of a workspace (`/pipelines/:clientId`, query `agentId`, `workflowId`, `runId`). Same
 * workspace selection flow as tasks and plans; the list shows the workspace's workflows (environment filter: workflows
 * available to that environment), the detail column the opened workflow with its run history, or one run with its
 * jobs and logs. Every member can trigger, cancel and sync; workspace admins (`canManageWorkspaceConfiguration`)
 * also create, edit and delete workflows. Live run / workflow updates arrive over the clients socket.
 */
@Component({
  selector: 'framework-deployments-board',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcBackLinkComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcDropdownComponent,
    FpcDropdownItemComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcPageHeaderComponent,
    FpcSectionColumnComponent,
    FpcSectionRowComponent,
    FpcSpinnerComponent,
    FpcTableCellDirective,
    DeploymentTriggerModalComponent,
    DeploymentWorkflowEditorComponent,
    WorkspaceChipComponent,
    WorkspaceSwitchTableComponent,
  ],
  templateUrl: './deployments-board.component.html',
  styleUrls: ['./deployments-board.component.scss'],
})
export class DeploymentsBoardComponent implements AfterViewInit {
  readonly pageTitle = $localize`:@@featureDeployments-title:Pipelines`;
  readonly switchWorkspaceTitle = $localize`:@@featureDeployments-switchWorkspaceTitle:Switch workspace`;
  readonly refreshTitle = $localize`:@@featureDeployments-refreshTitle:Refresh`;
  readonly workflowsLabel = $localize`:@@featureDeployments-workflowsTable:Pipelines`;
  readonly workflowSearchPlaceholder = $localize`:@@featureDeployments-searchWorkflows:Search pipelines`;
  readonly approvalFilterLabel = $localize`:@@featureDeployments-approvalFilter:Approval`;
  readonly environmentFilterLabel = $localize`:@@featureDeployments-environmentFilterLabel:Environment`;
  readonly newWorkflowTitle = $localize`:@@featureDeployments-newWorkflowTitle:New pipeline`;
  readonly triggerTitle = $localize`:@@featureDeployments-triggerAction:Run pipeline`;
  readonly syncTitle = $localize`:@@featureDeployments-syncAction:Sync run history`;
  readonly editTitle = $localize`:@@featureDeployments-editAction:Edit pipeline`;
  readonly deleteTitle = $localize`:@@featureDeployments-deleteAction:Delete pipeline`;
  readonly approveTitle = $localize`:@@featureDeployments-approveAction:Approve pipeline`;
  readonly approveLabel = $localize`:@@featureDeployments-approve:Approve`;
  readonly pendingApprovalLabel = deploymentWorkflowPendingLabel();
  /** Run button tooltip while the workflow waits for approval. */
  readonly triggerPendingTitle = $localize`:@@featureDeployments-triggerPendingTitle:Runs can start once a workspace admin approved this pipeline`;
  readonly moreActionsTitle = $localize`:@@featureDeployments-moreActions:More actions`;
  readonly backToWorkflowsTitle = $localize`:@@featureDeployments-backToWorkflows:Back to pipelines`;
  readonly closeRunTitle = $localize`:@@featureDeployments-closeRun:Close run`;
  readonly backToRunsTitle = $localize`:@@featureDeployments-backToRuns:Back to run history`;
  readonly runsLabel = $localize`:@@featureDeployments-runsTable:Runs`;
  readonly runSearchPlaceholder = $localize`:@@featureDeployments-searchRuns:Search runs`;
  readonly jobSearchPlaceholder = $localize`:@@featureDeployments-searchJobs:Search jobs`;
  readonly statusFilterLabel = $localize`:@@featureDeployments-statusFilterLabel:Status`;
  readonly jobsLabel = $localize`:@@featureDeployments-jobsTable:Jobs`;
  readonly viewLogsTitle = $localize`:@@featureDeployments-viewLogs:View logs`;
  readonly openInProviderTitle = $localize`:@@featureDeployments-openInProvider:Open in provider`;
  readonly cancelRunTitle = $localize`:@@featureDeployments-cancelRun:Cancel run`;
  readonly copyLogsTitle = $localize`:@@featureDeployments-copyLogs:Copy logs`;
  readonly downloadLogsTitle = $localize`:@@featureDeployments-downloadLogs:Download logs`;
  readonly reloadLogsTitle = $localize`:@@featureDeployments-reloadLogs:Reload logs`;
  readonly enabledLabel = $localize`:@@featureDeployments-enabledLabel:Enabled`;
  readonly enableLabel = $localize`:@@featureDeployments-bulkEnable:Enable`;
  readonly disableLabel = $localize`:@@featureDeployments-bulkDisable:Disable`;
  readonly deleteLabel = AG_DL_DELETE;
  readonly bulkDeleteTitle = $localize`:@@featureDeployments-bulkDeleteTitle:Delete pipelines`;
  readonly runStatuses = DEPLOYMENT_RUN_STATUSES;
  readonly runStatusLabel = deploymentRunStatusLabel;
  readonly runState = deploymentRunState;
  readonly workflowState = deploymentWorkflowState;
  readonly providerLabel = deploymentProviderLabel;
  readonly providerIcon = deploymentProviderIcon;
  readonly triggerLabel = deploymentTriggerLabel;
  readonly isRunActive = isDeploymentRunActive;
  readonly isPending = isDeploymentWorkflowPending;

  /** Workflows table: State (last run / disabled) · Workflow · Repository · Connection · Last run. */
  readonly workflowColumns: FpcTableColumn<DeploymentWorkflowSummary>[] = [
    {
      id: 'state',
      label: $localize`:@@featureDeployments-colState:State`,
      type: 'state',
      state: (workflow) => deploymentWorkflowState(workflow),
    },
    {
      id: 'name',
      label: $localize`:@@featureDeployments-colWorkflow:Pipeline`,
      value: (workflow) => workflow.name,
      required: true,
      priority: 1,
      sortable: false,
    },
    {
      id: 'repository',
      label: $localize`:@@featureDeployments-colRepository:Repository`,
      value: (workflow) => workflow.repository,
      priority: 2,
      sortable: false,
    },
    {
      id: 'connection',
      label: $localize`:@@featureDeployments-colConnection:Connection`,
      value: (workflow) => workflow.connectionLabel,
      priority: 3,
      hidden: true,
      sortable: false,
    },
    {
      id: 'lastRun',
      label: $localize`:@@featureDeployments-colLastRun:Last run`,
      value: (workflow) => (workflow.lastRunAt ? this.formatDate(workflow.lastRunAt) : ''),
      priority: 3,
      hidden: true,
      sortable: false,
    },
  ];
  readonly workflowRowMenu = (workflow: DeploymentWorkflowSummary): FpcMenuItem[] => [
    agOpenItem(),
    {
      id: 'trigger',
      label: this.triggerTitle,
      icon: 'play-fill',
      disabled: !workflow.enabled || isDeploymentWorkflowPending(workflow),
    },
    ...(this.canManage() && isDeploymentWorkflowPending(workflow)
      ? [{ id: 'approve', label: this.approveTitle, icon: 'check2-circle' }]
      : []),
    ...(this.canManage() ? [{ id: 'edit', label: AG_DL_EDIT, icon: 'pencil' }] : []),
    agCopyIdItem(),
    ...(this.canManage() ? [{ id: 'delete', label: AG_DL_DELETE, icon: 'trash', danger: true }] : []),
  ];
  /** Run history (newest first by start time, see {@link sortedRuns}): State · Run · Branch · Trigger · Environment · Started. */
  readonly runColumns: FpcTableColumn<DeploymentRunSummary>[] = [
    {
      id: 'state',
      label: $localize`:@@featureDeployments-colState:State`,
      type: 'state',
      state: (run) => deploymentRunState(run),
    },
    {
      id: 'run',
      label: $localize`:@@featureDeployments-colRun:Run`,
      value: (run) => this.runTitle(run),
      required: true,
      priority: 1,
      sortable: false,
    },
    {
      id: 'ref',
      label: $localize`:@@featureDeployments-colRef:Branch`,
      value: (run) => run.ref ?? '',
      priority: 2,
      sortable: false,
    },
    {
      id: 'trigger',
      label: $localize`:@@featureDeployments-colTrigger:Trigger`,
      value: (run) => deploymentTriggerLabel(run.triggeredBy),
      priority: 2,
      sortable: false,
    },
    {
      id: 'environment',
      label: $localize`:@@featureDeployments-colEnvironment:Environment`,
      value: (run) => (run.agentId ? this.agentName(run.agentId) : ''),
      priority: 3,
      hidden: true,
      sortable: false,
    },
    {
      id: 'created',
      label: $localize`:@@featureDeployments-colStarted:Started`,
      value: (run) => this.formatDate(run.startedAt ?? run.createdAt),
      priority: 1,
      sortable: false,
    },
  ];
  readonly runRowMenu = (run: DeploymentRunSummary): FpcMenuItem[] => [
    agOpenItem(),
    { id: 'logs', label: this.viewLogsTitle, icon: 'file-text' },
    ...(run.url ? [{ id: 'provider', label: this.openInProviderTitle, icon: 'box-arrow-up-right' }] : []),
    ...(isDeploymentRunActive(run.status)
      ? [{ id: 'cancel', label: this.cancelRunTitle, icon: 'stop-circle', danger: true }]
      : []),
    agCopyIdItem(),
  ];
  /**
   * Jobs of the opened run: State · Job · Started · Completed. Started / Completed sort by their ISO timestamp (shown
   * formatted by a cell template); the table starts sorted by Started, descending.
   */
  readonly jobColumns: FpcTableColumn<DeploymentRunJobSummary>[] = [
    {
      id: 'state',
      label: $localize`:@@featureDeployments-colState:State`,
      type: 'state',
      state: (job) => deploymentRunState(job),
    },
    {
      id: 'name',
      label: $localize`:@@featureDeployments-colJob:Job`,
      value: (job) => job.name,
      required: true,
      priority: 1,
    },
    {
      id: 'started',
      label: $localize`:@@featureDeployments-colStarted:Started`,
      value: (job) => job.startedAt ?? '',
      priority: 2,
    },
    {
      id: 'completed',
      label: $localize`:@@featureDeployments-colCompleted:Completed`,
      value: (job) => job.completedAt ?? '',
      priority: 3,
    },
  ];
  readonly jobRowMenu = (job: DeploymentRunJobSummary): FpcMenuItem[] => [
    { id: 'logs', label: this.viewLogsTitle, icon: 'file-text' },
    ...(job.url ? [{ id: 'provider', label: this.openInProviderTitle, icon: 'box-arrow-up-right' }] : []),
    agCopyIdItem(),
  ];

  private readonly clientsFacade = inject(ClientsFacade);
  private readonly agentsFacade = inject(AgentsFacade);
  private readonly deploymentsFacade = inject(WorkspaceDeploymentsFacade);
  private readonly deploymentsService = inject(WorkspaceDeploymentsService);
  private readonly socketsFacade = inject(ContainerSocketFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID);
  private readonly zone = inject(NgZone);

  readonly activeClientId = toSignal(this.clientsFacade.activeClientId$, { initialValue: null });
  /** Workspace for this page: URL `:clientId` wins so deep links load before the store catches up. */
  readonly effectiveClientId$ = combineLatest([this.route.paramMap, this.clientsFacade.activeClientId$]).pipe(
    map(([params, active]) => (params.get('clientId')?.trim() || active || null) as string | null),
    distinctUntilChanged(),
  );
  readonly effectiveClientId = toSignal(this.effectiveClientId$, { initialValue: null });
  readonly clients = toSignal(this.clientsFacade.clients$, { initialValue: [] as ClientResponseDto[] });
  readonly agents = toSignal(
    this.effectiveClientId$.pipe(
      switchMap((clientId) => (clientId ? this.agentsFacade.getClientAgents$(clientId) : of([]))),
    ),
    { initialValue: [] as AgentResponseDto[] },
  );
  readonly effectiveWorkspace = computed(() => {
    const id = this.effectiveClientId();

    return id ? (this.clients().find((client) => client.id === id) ?? null) : null;
  });
  /** Workspace admins / owners manage workflows (same flag as environments, autonomy and variables). */
  readonly canManage = computed(() => this.effectiveWorkspace()?.canManageWorkspaceConfiguration === true);

  readonly workflows = toSignal(this.deploymentsFacade.workflows$, { initialValue: [] as DeploymentWorkflowSummary[] });
  readonly workflowsHasNext = toSignal(this.deploymentsFacade.workflowsHasNext$, { initialValue: false });
  readonly workflowsLoading = toSignal(this.deploymentsFacade.workflowsLoading$, { initialValue: false });
  readonly selectedWorkflow = toSignal(this.deploymentsFacade.selectedWorkflow$, { initialValue: null });
  readonly selectedWorkflowLoading = toSignal(this.deploymentsFacade.selectedWorkflowLoading$, {
    initialValue: false,
  });
  readonly runs = toSignal(this.deploymentsFacade.runs$, { initialValue: [] as DeploymentRunSummary[] });
  readonly runsTotal = toSignal(this.deploymentsFacade.runsTotal$, { initialValue: 0 });
  readonly runsLoading = toSignal(this.deploymentsFacade.runsLoading$, { initialValue: false });
  readonly selectedRun = toSignal(this.deploymentsFacade.selectedRun$, { initialValue: null });
  readonly selectedRunLoading = toSignal(this.deploymentsFacade.selectedRunLoading$, { initialValue: false });
  readonly logs = toSignal(this.deploymentsFacade.logs$, { initialValue: null });
  readonly logsTarget = toSignal(this.deploymentsFacade.logsTarget$, { initialValue: null });
  readonly logsLoading = toSignal(this.deploymentsFacade.logsLoading$, { initialValue: false });
  readonly logsError = toSignal(this.deploymentsFacade.logsError$, { initialValue: null });
  readonly saving = toSignal(this.deploymentsFacade.saving$, { initialValue: false });
  readonly triggering = toSignal(this.deploymentsFacade.triggering$, { initialValue: false });
  readonly lastTriggeredRun = toSignal(this.deploymentsFacade.lastTriggeredRun$, { initialValue: null });
  readonly syncingWorkflowIds = toSignal(this.deploymentsFacade.syncingWorkflowIds$, {
    initialValue: [] as string[],
  });
  readonly cancellingRunIds = toSignal(this.deploymentsFacade.cancellingRunIds$, { initialValue: [] as string[] });
  readonly approvingWorkflowIds = toSignal(this.deploymentsFacade.approvingWorkflowIds$, {
    initialValue: [] as string[],
  });
  readonly error = toSignal(this.deploymentsFacade.error$, { initialValue: null });

  /** Environment filter (`?agentId=`): workflows available to that environment (global + assigned). */
  readonly agentFilter = signal<string | null>(null);
  /** `?approval=pending|approved` (Filters drawer). */
  readonly approvalFilter = signal<DeploymentWorkflowApprovalStatus | null>(null);
  /** Opened workflow (`?workflowId=`) and run (`?runId=`). */
  readonly selectedWorkflowId = signal<string | null>(null);
  readonly selectedRunId = signal<string | null>(null);
  readonly workflowSearch = signal('');
  readonly workflowPage = signal(1);
  readonly workflowPageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  readonly selectedWorkflowIds = signal<readonly string[]>([]);
  readonly runSearch = signal('');
  readonly runStatusFilter = signal<DeploymentRunStatus | null>(null);
  readonly runPage = signal(1);
  readonly runPageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  /** Jobs table: newest first by start time unless the user picks another column. */
  readonly jobSort = signal<FpcTableSort | null>({ column: 'started', direction: 'desc' });
  readonly runHasNext = computed(() => this.runPage() * this.runPageSize() < this.runsTotal());

  /** The opened workflow once loaded (a stale workflow of the previous selection is never shown). */
  readonly openWorkflow = computed(() => {
    const workflow = this.selectedWorkflow();

    return workflow && workflow.id === this.selectedWorkflowId() ? workflow : null;
  });
  readonly openRun = computed(() => {
    const detail = this.selectedRun();

    return detail && detail.run.id === this.selectedRunId() ? detail : null;
  });
  /**
   * Run history page newest first by start time (`startedAt`, else `createdAt`); live upserts (new runs, status
   * changes) keep that order.
   */
  readonly sortedRuns = computed(() => sortNewestStartedFirst(this.runs()));
  /** Jobs of the opened run, newest first by start time (jobs that did not start yet last). */
  readonly sortedJobs = computed(() => sortNewestStartedFirst(this.openRun()?.jobs ?? []));
  /** Client-side search of the opened run's jobs (name, state), like the tasks table. */
  readonly jobSearch = signal('');
  readonly searchedJobs = computed(() => {
    const needle = this.jobSearch().trim().toLowerCase();
    const jobs = this.sortedJobs();

    if (!needle) {
      return jobs;
    }

    return jobs.filter((job) =>
      [job.name, deploymentRunState(job).label, job.id].join(' ').toLowerCase().includes(needle),
    );
  });
  readonly detailOpen = computed(() => !!this.selectedWorkflowId() || !!this.selectedRunId());
  readonly selectedWorkflows = computed(() => {
    const ids = new Set(this.selectedWorkflowIds());

    return this.workflows().filter((workflow) => ids.has(workflow.id));
  });
  /** Environments a workflow is assigned to (names). */
  readonly assignedAgentNames = computed(() => {
    const workflow = this.openWorkflow();

    return workflow && workflow.scope === 'environments' ? workflow.agentIds.map((id) => this.agentName(id)) : [];
  });
  /** The opened run while it is queued / in progress (refreshed periodically). */
  readonly activeOpenRunId = computed(() => {
    const detail = this.openRun();

    return detail && isDeploymentRunActive(detail.run.status) ? detail.run.id : null;
  });
  /** Environment that proposed the opened workflow (`createdBy: agent`). */
  readonly openWorkflowProposedBy = computed(() => {
    const workflow = this.openWorkflow();

    return workflow?.createdBy === 'agent' && workflow.createdByAgentId
      ? this.agentName(workflow.createdByAgentId)
      : null;
  });
  /**
   * Environment whose change the opened workflow waits for (pending and last changed by an environment). Environments
   * only change workflows assigned exclusively to themselves.
   */
  readonly openWorkflowChangedBy = computed(() => {
    const workflow = this.openWorkflow();

    // A fresh proposal (never changed since it was created) reads as "proposed", not "changed".
    if (
      !workflow ||
      !isDeploymentWorkflowPending(workflow) ||
      workflow.updatedBy !== 'agent' ||
      workflow.updatedAt === workflow.createdAt
    ) {
      return null;
    }

    const agentId =
      workflow.scope === 'environments' && workflow.agentIds.length === 1
        ? workflow.agentIds[0]
        : workflow.createdByAgentId;

    return agentId ? this.agentName(agentId) : null;
  });
  readonly openWorkflowInputs = computed(() => Object.entries(this.openWorkflow()?.defaultInputs ?? {}));
  readonly openRunInputs = computed(() => Object.entries(this.openRun()?.run.inputs ?? {}));
  readonly logsJob = computed(() => {
    const target = this.logsTarget();

    return target?.jobId ? (this.openRun()?.jobs.find((job) => job.id === target.jobId) ?? null) : null;
  });
  readonly logsTitle = computed(() => {
    const job = this.logsJob();

    return job
      ? $localize`:@@featureDeployments-logsTitleJob:Job logs: ${job.name}:job:`
      : $localize`:@@featureDeployments-logsTitleRun:Run logs`;
  });

  // --- modals -----------------------------------------------------------------------------------------------
  readonly editorOpen = signal(false);
  readonly editorWorkflow = signal<DeploymentWorkflowSummary | null>(null);
  /** The editor closes once its save request finished without an error. */
  private editorSubmitted = false;
  readonly triggerOpen = signal(false);
  readonly triggerWorkflow = signal<DeploymentWorkflowSummary | null>(null);
  readonly logsModalOpen = signal(false);
  readonly deleteConfirmOpen = signal(false);
  readonly workflowPendingDelete = signal<DeploymentWorkflowSummary | null>(null);
  readonly deleteConfirmMessage = computed(() => {
    const name = this.workflowPendingDelete()?.name ?? '';

    return $localize`:@@featureDeployments-deleteConfirmMessage:Delete "${name}:name:" and its run history? Runs that are still active keep running at the provider.`;
  });
  readonly approveConfirmOpen = signal(false);
  readonly workflowPendingApproval = signal<DeploymentWorkflowSummary | null>(null);
  readonly approvalInputs = computed(() => Object.entries(this.workflowPendingApproval()?.defaultInputs ?? {}));
  readonly approvalAssignedAgentNames = computed(() => {
    const workflow = this.workflowPendingApproval();

    return workflow && workflow.scope === 'environments' ? workflow.agentIds.map((id) => this.agentName(id)) : [];
  });
  readonly cancelConfirmOpen = signal(false);
  readonly runPendingCancel = signal<DeploymentRunSummary | null>(null);
  readonly cancelConfirmMessage = $localize`:@@featureDeployments-cancelConfirmMessage:Cancel this run at the provider? Jobs in progress are stopped.`;
  readonly bulkBusy = signal(false);
  readonly bulkResult = signal<{ tone: BulkTone; message: string } | null>(null);
  readonly bulkDeleteConfirmOpen = signal(false);
  readonly bulkDeleteMessage = computed(
    () =>
      $localize`:@@featureDeployments-bulkDeleteMessage:Delete ${this.selectedWorkflows().length}:count: pipelines and their run history?`,
  );

  readonly workspaceSwitchModalOpen = signal(false);
  readonly workspaceSwitchSearch = signal('');
  readonly workspaceSwitchHasMore = toSignal(this.clientsFacade.hasMore$, { initialValue: false });
  readonly workspaceSwitchAppendLoading = toSignal(this.clientsFacade.appendLoading$, { initialValue: false });
  readonly workspaceSwitchAppendError = toSignal(this.clientsFacade.appendError$, {
    initialValue: null as string | null,
  });

  constructor() {
    this.clientsFacade.loadClients();

    toObservable(this.workspaceSwitchSearch)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => this.clientsFacade.loadClients({ search: search.trim() || undefined }));

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const agentId = params.get('agentId')?.trim() || null;
      const workflowId = params.get('workflowId')?.trim() || null;
      const approvalParam = params.get('approval');
      const approval: DeploymentWorkflowApprovalStatus | null =
        approvalParam === 'pending' || approvalParam === 'approved' ? approvalParam : null;

      if (agentId !== this.agentFilter() || approval !== this.approvalFilter()) {
        this.workflowPage.set(1);
      }

      this.approvalFilter.set(approval);

      if (workflowId !== this.selectedWorkflowId()) {
        this.runPage.set(1);
        this.runSearch.set('');
        this.runStatusFilter.set(null);
      }

      this.agentFilter.set(agentId);
      this.selectedWorkflowId.set(workflowId);
      this.selectedRunId.set(params.get('runId')?.trim() || null);
    });

    this.effectiveClientId$
      .pipe(
        filter((clientId): clientId is string => !!clientId),
        switchMap((clientId) => {
          this.agentsFacade.loadClientAgents(clientId);

          return this.ensureSocketClient(clientId);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    // Workflows: server-side search / filter / paging (search debounced while typing).
    const debouncedWorkflowSearch = toSignal(
      toObservable(this.workflowSearch).pipe(debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged()),
      { initialValue: '' },
    );

    effect(() => {
      const clientId = this.effectiveClientId();
      const agentId = this.agentFilter();
      const approvalStatus = this.approvalFilter();
      const search = debouncedWorkflowSearch();
      const page = this.workflowPage();
      const pageSize = this.workflowPageSize();

      if (clientId) {
        untracked(() =>
          this.deploymentsFacade.loadWorkflows(clientId, {
            agentId,
            approvalStatus,
            search,
            limit: pageSize,
            offset: (page - 1) * pageSize,
          }),
        );
      }
    });

    // Opened workflow (deep link / row).
    effect(() => {
      const clientId = this.effectiveClientId();
      const workflowId = this.selectedWorkflowId();

      untracked(() => {
        if (clientId && workflowId) {
          this.deploymentsFacade.openWorkflow(clientId, workflowId);
        } else {
          this.deploymentsFacade.closeWorkflow();
        }
      });
    });

    // Run history of the opened workflow.
    const debouncedRunSearch = toSignal(
      toObservable(this.runSearch).pipe(debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged()),
      { initialValue: '' },
    );

    effect(() => {
      const clientId = this.effectiveClientId();
      const workflowId = this.selectedWorkflowId();
      const search = debouncedRunSearch();
      const status = this.runStatusFilter();
      const page = this.runPage();
      const pageSize = this.runPageSize();

      if (clientId && workflowId) {
        untracked(() =>
          this.deploymentsFacade.loadRuns(clientId, {
            workflowId,
            search,
            status,
            limit: pageSize,
            offset: (page - 1) * pageSize,
          }),
        );
      }
    });

    // Opened run (deep link / row / trigger).
    effect(() => {
      const clientId = this.effectiveClientId();
      const runId = this.selectedRunId();

      untracked(() => {
        if (clientId && runId) {
          this.deploymentsFacade.openRun(clientId, runId);
        } else {
          this.deploymentsFacade.closeRun();
        }

        this.logsModalOpen.set(false);
      });
    });

    // Deep link `?runId=` without its workflow (e.g. from the audit log): the run names its workflow.
    effect(() => {
      const detail = this.openRun();

      if (detail && !this.selectedWorkflowId()) {
        untracked(
          () =>
            void this.router.navigate([], {
              relativeTo: this.route,
              queryParams: { workflowId: detail.run.workflowId },
              queryParamsHandling: 'merge',
              replaceUrl: true,
            }),
        );
      }
    });

    // A live status change of the opened run reloads its jobs (debounced); active runs also refresh periodically.
    toObservable(this.openRun)
      .pipe(
        filter((detail) => !!detail),
        map((detail) => ({
          runId: detail.run.id,
          key: `${detail.run.id}:${detail.run.status}:${detail.run.updatedAt}`,
        })),
        distinctUntilChanged((a, b) => a.key === b.key),
        skip(1),
        debounceTime(RUN_RELOAD_DEBOUNCE_MS),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ runId }) => this.refreshRun(runId));

    // The timer runs outside the Angular zone (the app stays stable while a run is active); the reload re-enters it.
    toObservable(this.activeOpenRunId)
      .pipe(
        distinctUntilChanged(),
        switchMap((runId) =>
          runId
            ? new Observable<string>((subscriber) =>
                this.zone.runOutsideAngular(() => {
                  const timer = setInterval(() => subscriber.next(runId), ACTIVE_RUN_REFRESH_MS);

                  return () => clearInterval(timer);
                }),
              )
            : EMPTY,
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((runId) => this.zone.run(() => this.refreshRun(runId)));

    // A run triggered from this page opens right away.
    effect(() => {
      const run = this.lastTriggeredRun();

      if (!run) {
        return;
      }

      untracked(() => {
        this.triggerOpen.set(false);
        this.deploymentsFacade.clearLastTriggeredRun();
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { workflowId: run.workflowId, runId: run.id },
          queryParamsHandling: 'merge',
        });
      });
    });

    // The editor closes after a successful save.
    effect(() => {
      const saving = this.saving();
      const error = this.error();

      if (!saving && this.editorSubmitted) {
        untracked(() => {
          this.editorSubmitted = false;

          if (!error) {
            this.editorOpen.set(false);
          }
        });
      }
    });
  }

  ngAfterViewInit(): void {
    this.effectiveClientId$
      .pipe(
        filter((id) => !id),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => setTimeout(() => this.openWorkspaceSwitchModal(), 0));
  }

  workspaceDisplayName(name: string | null | undefined): string {
    return resolveNamedDisplayLabel(name);
  }

  agentName(agentId: string): string {
    return resolveNamedDisplayLabel(this.agents().find((agent) => agent.id === agentId)?.name ?? agentId);
  }

  formatDate(value: string | null | undefined): string {
    return fpcFormatDateTime(value ?? null, this.locale, '—');
  }

  /** Run label: provider run name, else `#<provider run number>`, else the workflow name. */
  runTitle(run: DeploymentRunSummary): string {
    return run.name?.trim() || (run.providerRunId ? `#${run.providerRunId}` : run.workflowName);
  }

  isSyncing(workflowId: string): boolean {
    return this.syncingWorkflowIds().includes(workflowId);
  }

  /** Overview "Last run" badge: disabled or the last run, without the approval state. */
  lastRunState(workflow: DeploymentWorkflowSummary): FpcTableState {
    return deploymentWorkflowState({
      enabled: workflow.enabled,
      lastRunStatus: workflow.lastRunStatus,
      lastRunConclusion: workflow.lastRunConclusion,
    });
  }

  isApproving(workflowId: string): boolean {
    return this.approvingWorkflowIds().includes(workflowId);
  }

  isCancelling(runId: string): boolean {
    return this.cancellingRunIds().includes(runId);
  }

  // --- navigation ---------------------------------------------------------------------------------------------

  openWorkspaceSwitchModal(): void {
    this.workspaceSwitchSearch.set('');
    this.clientsFacade.loadClients();
    this.workspaceSwitchModalOpen.set(true);
  }

  goToSpaces(event?: Event): void {
    event?.preventDefault();
    this.workspaceSwitchModalOpen.set(false);
    void this.router.navigate(['/clients']);
  }

  onLoadMoreWorkspaces(): void {
    this.clientsFacade.loadMoreClients();
  }

  onSelectWorkspace(client: ClientResponseDto): void {
    this.workspaceSwitchModalOpen.set(false);
    this.clientsFacade.setActiveClient(client.id);
    void this.router.navigate(['/pipelines', client.id]);
  }

  onApprovalFilterChange(approval: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { approval: approval === 'pending' || approval === 'approved' ? approval : null },
      queryParamsHandling: 'merge',
    });
  }

  /** Filters drawer "clear": environment and approval. */
  onClearWorkflowFilters(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { agentId: null, approval: null },
      queryParamsHandling: 'merge',
    });
  }

  /** Active filters of the workflows table (badge on the Filters button). */
  readonly workflowFiltersActive = computed(() => (this.agentFilter() ? 1 : 0) + (this.approvalFilter() ? 1 : 0));

  onAgentFilterChange(agentId: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { agentId: agentId || null },
      queryParamsHandling: 'merge',
    });
  }

  onWorkflowSearchChange(search: string): void {
    this.workflowSearch.set(search);
  }

  onRunSearchChange(search: string): void {
    this.runSearch.set(search);
  }

  onRunStatusFilterChange(status: string): void {
    this.runPage.set(1);
    this.runStatusFilter.set(
      (DEPLOYMENT_RUN_STATUSES as readonly string[]).includes(status) ? (status as DeploymentRunStatus) : null,
    );
  }

  onSelectWorkflow(workflow: DeploymentWorkflowSummary): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { workflowId: workflow.id, runId: null },
      queryParamsHandling: 'merge',
    });
  }

  /** Phone back button: the list becomes the view again. */
  onCloseWorkflow(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { workflowId: null, runId: null },
      queryParamsHandling: 'merge',
    });
  }

  onSelectRun(run: DeploymentRunSummary): void {
    if (this.selectedRunId() !== run.id) {
      this.jobSearch.set('');
    }

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { workflowId: run.workflowId, runId: run.id },
      queryParamsHandling: 'merge',
    });
  }

  /** History row: opens the run in the right column; activating the open run again closes it (like /clients). */
  onRunRowActivate(run: DeploymentRunSummary): void {
    if (this.selectedRunId() === run.id) {
      this.onCloseRun();

      return;
    }

    this.onSelectRun(run);
  }

  onCloseRun(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { runId: null },
      queryParamsHandling: 'merge',
    });
  }

  onRefresh(): void {
    const clientId = this.effectiveClientId();

    if (!clientId) {
      return;
    }

    this.deploymentsFacade.loadWorkflows(clientId, {
      agentId: this.agentFilter(),
      approvalStatus: this.approvalFilter(),
      search: this.workflowSearch(),
      limit: this.workflowPageSize(),
      offset: (this.workflowPage() - 1) * this.workflowPageSize(),
    });

    const workflowId = this.selectedWorkflowId();

    if (workflowId) {
      this.deploymentsFacade.openWorkflow(clientId, workflowId);
      this.onRefreshRuns();
    }

    const runId = this.selectedRunId();

    if (runId) {
      this.refreshRun(runId);
    }
  }

  onRefreshRuns(): void {
    const clientId = this.effectiveClientId();
    const workflowId = this.selectedWorkflowId();

    if (clientId && workflowId) {
      this.deploymentsFacade.loadRuns(clientId, {
        workflowId,
        search: this.runSearch(),
        status: this.runStatusFilter(),
        limit: this.runPageSize(),
        offset: (this.runPage() - 1) * this.runPageSize(),
      });
    }
  }

  onDismissError(): void {
    this.deploymentsFacade.clearError();
  }

  // --- row actions ----------------------------------------------------------------------------------------------

  onWorkflowRowAction(workflow: DeploymentWorkflowSummary, action: string): void {
    switch (action) {
      case 'open':
        this.onSelectWorkflow(workflow);
        break;
      case 'trigger':
        this.openTrigger(workflow);
        break;
      case 'approve':
        this.onRequestApprove(workflow);
        break;
      case 'edit':
        this.openEditEditor(workflow);
        break;
      case 'copy-id':
        fpcCopyText(workflow.id);
        break;
      case 'delete':
        this.onRequestDelete(workflow);
        break;
    }
  }

  onRunRowAction(run: DeploymentRunSummary, action: string): void {
    switch (action) {
      case 'open':
        this.onSelectRun(run);
        break;
      case 'logs':
        this.onSelectRun(run);
        this.onViewLogs(run.id, null);
        break;
      case 'provider':
        this.openExternal(run.url);
        break;
      case 'cancel':
        this.onRequestCancel(run);
        break;
      case 'copy-id':
        fpcCopyText(run.id);
        break;
    }
  }

  onJobRowAction(job: DeploymentRunJobSummary, action: string): void {
    const run = this.openRun()?.run;

    switch (action) {
      case 'logs':
        if (run) this.onViewLogs(run.id, job.id);
        break;
      case 'provider':
        this.openExternal(job.url);
        break;
      case 'copy-id':
        fpcCopyText(job.id);
        break;
    }
  }

  onJobActivate(job: DeploymentRunJobSummary): void {
    const run = this.openRun()?.run;

    if (run) {
      this.onViewLogs(run.id, job.id);
    }
  }

  openExternal(url: string | null | undefined): void {
    if (url && /^https?:\/\//i.test(url)) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  // --- workflow actions -----------------------------------------------------------------------------------------

  openCreateEditor(): void {
    if (!this.canManage()) {
      return;
    }

    this.deploymentsFacade.clearError();
    this.editorWorkflow.set(null);
    this.editorOpen.set(true);
  }

  openEditEditor(workflow: DeploymentWorkflowSummary): void {
    if (!this.canManage()) {
      return;
    }

    this.deploymentsFacade.clearError();
    this.editorWorkflow.set(workflow);
    this.editorOpen.set(true);
  }

  onSaveWorkflow(dto: CreateDeploymentWorkflowDto): void {
    const clientId = this.effectiveClientId();
    const workflow = this.editorWorkflow();

    if (!clientId || !this.canManage()) {
      return;
    }

    this.editorSubmitted = true;

    if (workflow) {
      this.deploymentsFacade.updateWorkflow(clientId, workflow.id, dto);
    } else {
      this.deploymentsFacade.createWorkflow(clientId, dto);
    }
  }

  onToggleEnabled(workflow: DeploymentWorkflowSummary, enabled: boolean): void {
    const clientId = this.effectiveClientId();

    if (clientId && this.canManage() && workflow.enabled !== enabled) {
      this.deploymentsFacade.updateWorkflow(clientId, workflow.id, { enabled });
    }
  }

  openTrigger(workflow: DeploymentWorkflowSummary): void {
    // Nobody can start runs of a workflow that waits for approval (the controller refuses too).
    if (!workflow.enabled || isDeploymentWorkflowPending(workflow)) {
      return;
    }

    this.deploymentsFacade.clearError();
    this.triggerWorkflow.set(workflow);
    this.triggerOpen.set(true);
  }

  onTrigger(dto: TriggerDeploymentWorkflowDto): void {
    const clientId = this.effectiveClientId();
    const workflow = this.triggerWorkflow();

    if (clientId && workflow) {
      this.deploymentsFacade.trigger(clientId, workflow.id, dto);
    }
  }

  onSync(workflow: DeploymentWorkflowSummary): void {
    const clientId = this.effectiveClientId();

    if (clientId) {
      this.deploymentsFacade.sync(clientId, workflow.id);
    }
  }

  /** Workspace admins: review what is approved (confirm dialog), then approve that version. */
  onRequestApprove(workflow: DeploymentWorkflowSummary): void {
    if (!this.canManage() || !isDeploymentWorkflowPending(workflow)) {
      return;
    }

    this.deploymentsFacade.clearError();
    this.workflowPendingApproval.set(workflow);
    this.approveConfirmOpen.set(true);
  }

  onConfirmApprove(): void {
    const clientId = this.effectiveClientId();
    const workflow = this.workflowPendingApproval();

    this.approveConfirmOpen.set(false);
    this.workflowPendingApproval.set(null);

    if (clientId && workflow && this.canManage()) {
      // Bound to the reviewed version: if the environment changed the workflow meanwhile the controller refuses (409)
      // with its message and the page reloads the workflow.
      this.deploymentsFacade.approveWorkflow(clientId, workflow.id, workflow.updatedAt);
    }
  }

  onRequestDelete(workflow: DeploymentWorkflowSummary): void {
    this.deploymentsFacade.clearError();
    this.workflowPendingDelete.set(workflow);
    this.deleteConfirmOpen.set(true);
  }

  onConfirmDelete(): void {
    const clientId = this.effectiveClientId();
    const workflow = this.workflowPendingDelete();

    this.deleteConfirmOpen.set(false);
    this.workflowPendingDelete.set(null);

    if (!clientId || !workflow || !this.canManage()) {
      return;
    }

    if (this.selectedWorkflowId() === workflow.id) {
      this.onCloseWorkflow();
    }

    this.deploymentsFacade.deleteWorkflow(clientId, workflow.id);
  }

  onCancelDelete(): void {
    this.workflowPendingDelete.set(null);
  }

  // --- bulk -----------------------------------------------------------------------------------------------------

  onBulkSync(): void {
    void this.runWorkflowBulk(this.selectedWorkflows(), (clientId, workflow) =>
      firstValueFrom(this.deploymentsService.syncWorkflow(clientId, workflow.id)),
    );
  }

  onBulkEnabled(enabled: boolean): void {
    void this.runWorkflowBulk(
      this.selectedWorkflows().filter((workflow) => workflow.enabled !== enabled),
      (clientId, workflow) =>
        firstValueFrom(this.deploymentsService.updateWorkflow(clientId, workflow.id, { enabled })),
    );
  }

  onConfirmBulkDelete(): void {
    const workflows = this.selectedWorkflows();

    if (workflows.some((workflow) => workflow.id === this.selectedWorkflowId())) {
      this.onCloseWorkflow();
    }

    void this.runWorkflowBulk(workflows, (clientId, workflow) =>
      firstValueFrom(this.deploymentsService.deleteWorkflow(clientId, workflow.id)),
    );
  }

  /** Client fan-out over the single-workflow endpoints (the server checks every workflow); the list reloads after. */
  private async runWorkflowBulk(
    workflows: readonly DeploymentWorkflowSummary[],
    run: (clientId: string, workflow: DeploymentWorkflowSummary) => Promise<unknown>,
  ): Promise<void> {
    const clientId = this.effectiveClientId();

    if (!clientId || workflows.length === 0) {
      return;
    }

    this.bulkBusy.set(true);
    this.bulkResult.set(null);

    try {
      const result = await fpcRunBulk(workflows, (workflow) => run(clientId, workflow));

      this.bulkResult.set(agBulkSummary(result, (workflow) => workflow.name));
      this.selectedWorkflowIds.set(result.failed.concat(result.denied).map((workflow) => workflow.id));
      this.onRefresh();
    } finally {
      this.bulkBusy.set(false);
    }
  }

  // --- runs -----------------------------------------------------------------------------------------------------

  onRequestCancel(run: DeploymentRunSummary): void {
    this.runPendingCancel.set(run);
    this.cancelConfirmOpen.set(true);
  }

  onConfirmCancel(): void {
    const clientId = this.effectiveClientId();
    const run = this.runPendingCancel();

    this.cancelConfirmOpen.set(false);
    this.runPendingCancel.set(null);

    if (clientId && run) {
      this.deploymentsFacade.cancelRun(clientId, run.id);
    }
  }

  onViewLogs(runId: string, jobId: string | null): void {
    const clientId = this.effectiveClientId();

    if (!clientId) {
      return;
    }

    this.deploymentsFacade.loadLogs(clientId, runId, jobId);
    this.logsModalOpen.set(true);
  }

  onReloadLogs(): void {
    const target = this.logsTarget();

    if (target) {
      this.onViewLogs(target.runId, target.jobId);
    }
  }

  onLogsModalOpenChange(open: boolean): void {
    this.logsModalOpen.set(open);

    if (!open) {
      this.deploymentsFacade.clearLogs();
    }
  }

  onCopyLogs(): void {
    const logs = this.logs()?.logs;

    if (logs) {
      fpcCopyText(logs);
    }
  }

  onDownloadLogs(): void {
    const logs = this.logs()?.logs;
    const detail = this.openRun();

    if (!logs) {
      return;
    }

    const filename = deploymentLogFileName([
      detail?.run.workflowName,
      detail ? this.runTitle(detail.run) : null,
      this.logsJob()?.name,
    ]);
    const url = URL.createObjectURL(new Blob([logs], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private refreshRun(runId: string): void {
    const clientId = this.effectiveClientId();

    if (clientId && this.selectedRunId() === runId) {
      this.deploymentsFacade.openRun(clientId, runId, { refresh: true });
    }
  }

  /** Live updates arrive on the clients socket of the workspace room (`setClient` dedupes). */
  private ensureSocketClient(clientId: string) {
    return this.socketsFacade.connected$.pipe(
      take(1),
      switchMap((connected) => {
        if (!connected) {
          this.socketsFacade.connect();
        }

        return this.socketsFacade.connected$.pipe(filter(Boolean), take(1));
      }),
      switchMap(() => {
        this.socketsFacade.setClient(clientId);

        return EMPTY;
      }),
    );
  }
}
