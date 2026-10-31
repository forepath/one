import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  inject,
  signal,
  untracked,
  viewChild,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  AgentsFacade,
  approveTicketAutomationFailure,
  approveTicketAutomationSuccess,
  BOARD_LANE_STATUSES,
  cancelTicketAutomationRunFailure,
  cancelTicketAutomationRunSuccess,
  ClientsFacade,
  ClientsService,
  deleteTicketFailure,
  deleteTicketSuccess,
  createTicketSuccess,
  KnowledgeFacade,
  KnowledgeService,
  loadTickets,
  loadTicketsFailure,
  loadTicketsSuccess,
  migrateTicketSuccess,
  patchTicketAutomationFailure,
  patchTicketAutomationSuccess,
  ContainerSocketFacade,
  ChatTimelineFacade,
  TicketAutomationFacade,
  TicketsBoardSocketFacade,
  TicketsFacade,
  TicketsService,
  unapproveTicketAutomationFailure,
  unapproveTicketAutomationSuccess,
  type AgentResponseDto,
  type BoardLaneStatus,
  type ClientResponseDto,
  type KnowledgeNodeDto,
  type KnowledgeNodeType,
  type KnowledgeRelationDto,
  type TicketAutomationBranchStrategy,
  type TicketAutomationResponseDto,
  type TicketAutomationRunResponseDto,
  type TicketAutomationRunStatus,
  type TicketBoardRow,
  type TicketCreationTemplate,
  type TicketPriority,
  type TicketResponseDto,
  type AttachmentResponseDto,
  type TicketStatus,
  type UpdateTicketAutomationDto,
  type UpdateTicketDto,
  VcsService,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  ReferenceComboboxComponent,
  type ReferenceComboboxLoader,
} from '@forepath/agenstra/frontend/feature-agent-config';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcBoardLaneComponent,
  FpcBreadcrumbItemComponent,
  FpcBreadcrumbsComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcTableCellDirective,
  fpcCopyText,
  fpcListQueryState,
  type FpcBulkResult,
  type FpcFilterChip,
  type FpcMenuItem,
  type FpcTableColumn,
  type FpcTableRowDropEvent,
  type FpcTableSort,
  FpcDropdownComponent,
  FpcDropdownItemComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcLaneHeaderComponent,
  FpcListToolbarComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcProgressComponent,
  FpcSearchFieldComponent,
  FpcSectionColumnComponent,
  FpcSectionRowComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTypeaheadSelectComponent,
  type FpcBadgeColor,
  type FpcBadgeTone,
  FpcDatePipe,
} from '@forepath/shared/frontend/ui-components';
import { Actions, ofType } from '@ngrx/effects';
import {
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  firstValueFrom,
  map,
  merge,
  Observable,
  of,
  pairwise,
  switchMap,
  skip,
  take,
  tap,
} from 'rxjs';

import {
  AGENT_MODAL_TRANSITION_MS,
  AgentModalSwapState,
  hideAgentModal,
  restoreUnderlyingAgentModal,
  showAgentModal,
  swapToOverlayAgentModal,
} from '../agent-modal';
import { getGitRepositoryDisplayLabel, isLocalGitRepository } from '../git-repository-display';
import { resolveNamedDisplayLabel } from '../display-name.util';

import {
  automationBranchEnvironmentId as pickAutomationBranchEnvironment,
  automationBranchLoader as buildAutomationBranchLoader,
} from './automation-branch-reference';
import { storeAgentConsoleChatDraft } from './chat-draft-storage';
import { AgentSelectComponent } from '../agent-select/agent-select.component';
import {
  ticketAutomationCancellationReasonLabel,
  ticketAutomationFailureCodeLabel,
  ticketAutomationRunPhaseLabel,
  ticketAutomationRunStatusLabel,
  ticketAutomationRunStepKindLabel,
} from './ticket-automation-run-labels';
import { buildTicketBodyHierarchyContext } from './ticket-body-hierarchy-context';
import { TicketEditorComponent } from './ticket-editor/ticket-editor.component';
import {
  bulkDeleteTickets,
  bulkUpdateTickets,
  buildTicketTableRows,
  filterTicketLaneRows,
  ticketHiddenMatchCount,
  ticketHiddenMatchLabel,
  TICKET_TABLE_CHUNK,
  TICKET_STATUSES,
  ticketPriorityLabel,
  ticketPriorityTone,
  ticketStatusFilterLabel,
  ticketStatusState,
  ticketSubtaskText,
  ticketTableColumns,
  type TicketStatusFilter,
} from './ticket-table';
import { AttachmentChipsComponent } from '../shared/attachment-chips.component';
import { agBulkSummary, agCopyIdItem, agOpenItem, AG_DL_CLOSE, AG_DL_DELETE } from '../shared/data-list';
import { WorkspaceChipComponent } from '../shared/workspace-chip.component';
import { WorkspaceSwitchTableComponent } from '../shared/workspace-switch-table.component';
import { ticketModelPlaceholder } from './ticket-model-placeholder';
import { ticketBoardViewState, type TicketBoardView } from './ticket-board-view';
import { ticketLaneStatusLabel } from './ticket-lane-status-label';

const ALL_TICKET_STATUSES: TicketStatus[] = ['draft', 'todo', 'in_progress', 'prototype', 'done', 'closed'];

function normalizeAllowedAgentIdList(ids: string[] | undefined): string[] {
  return [...new Set((ids ?? []).map((id) => id.trim()).filter((id) => id.length > 0))].sort();
}

function normalizeVerifierCommandsForCompare(
  cmds: Array<{ cmd: string; cwd?: string }> | undefined | null,
): Array<{ cmd: string; cwd?: string | undefined }> {
  return (cmds ?? [])
    .map((c) => ({ cmd: c.cmd.trim(), cwd: c.cwd?.trim() ? c.cwd.trim() : undefined }))
    .filter((c) => c.cmd.length > 0);
}

function automationDtoMatchesServerConfig(dto: UpdateTicketAutomationDto, cfg: TicketAutomationResponseDto): boolean {
  if (dto.eligible !== cfg.eligible) {
    return false;
  }

  if ((dto.includeWorkspaceContext ?? true) !== (cfg.includeWorkspaceContext !== false)) {
    return false;
  }

  if ((dto.autoEnrichmentEnabled ?? true) !== (cfg.autoEnrichmentEnabled !== false)) {
    return false;
  }

  if (dto.requiresApproval !== cfg.requiresApproval) {
    return false;
  }

  const dAgents = normalizeAllowedAgentIdList(dto.allowedAgentIds);
  const cAgents = normalizeAllowedAgentIdList(cfg.allowedAgentIds);

  if (dAgents.length !== cAgents.length || dAgents.some((id, i) => id !== cAgents[i])) {
    return false;
  }

  if ((dto.preferredModel ?? null) !== (cfg.preferredModel ?? null)) {
    return false;
  }

  const dContextAgents = normalizeAllowedAgentIdList(dto.contextEnvironmentIds);
  const cContextAgents = normalizeAllowedAgentIdList(cfg.contextEnvironmentIds);

  if (dContextAgents.length !== cContextAgents.length || dContextAgents.some((id, i) => id !== cContextAgents[i])) {
    return false;
  }

  const dBranch = (dto.defaultBranchOverride ?? '').trim();
  const cBranch = (cfg.defaultBranchOverride ?? '').trim();

  if (dBranch !== cBranch) {
    return false;
  }

  if ((dto.automationBranchStrategy ?? 'reuse_per_ticket') !== cfg.automationBranchStrategy) {
    return false;
  }

  if ((dto.forceNewAutomationBranchNextRun ?? false) !== cfg.forceNewAutomationBranchNextRun) {
    return false;
  }

  const dVer = normalizeVerifierCommandsForCompare(dto.verifierProfile?.commands);
  const cVer = normalizeVerifierCommandsForCompare(cfg.verifierProfile?.commands);

  if (dVer.length !== cVer.length) {
    return false;
  }

  return dVer.every((row, i) => row.cmd === cVer[i].cmd && row.cwd === cVer[i].cwd);
}

interface TicketDetailSubtaskRow {
  ticket: TicketResponseDto;
  depth: number;
}

const AUTOMATION_RUN_TONE: Record<TicketAutomationRunStatus, FpcBadgeTone> = {
  pending: 'primary',
  running: 'primary',
  succeeded: 'success',
  failed: 'danger',
  timed_out: 'danger',
  escalated: 'warning',
  cancelled: 'neutral',
};

const AUTOMATION_RUN_ICON: Record<TicketAutomationRunStatus, string> = {
  pending: 'hourglass-split',
  running: 'arrow-repeat',
  succeeded: 'check-circle-fill',
  failed: 'x-circle-fill',
  timed_out: 'clock-history',
  escalated: 'exclamation-triangle-fill',
  cancelled: 'slash-circle',
};

@Component({
  selector: 'framework-tickets-board',
  standalone: true,
  imports: [
    FpcDatePipe,
    CommonModule,
    RouterModule,
    FormsModule,
    TicketEditorComponent,
    AgentSelectComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcBoardLaneComponent,
    FpcBreadcrumbItemComponent,
    FpcBreadcrumbsComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcDropdownComponent,
    FpcDropdownItemComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcLaneHeaderComponent,
    FpcListToolbarComponent,
    FpcPageHeaderComponent,
    FpcProgressComponent,
    FpcSearchFieldComponent,
    FpcSectionColumnComponent,
    FpcSectionRowComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    AttachmentChipsComponent,
    WorkspaceChipComponent,
    WorkspaceSwitchTableComponent,
    FpcTypeaheadSelectComponent,
    ReferenceComboboxComponent,
  ],
  templateUrl: './tickets-board.component.html',
  styleUrls: ['./tickets-board.component.scss'],
})
export class TicketsBoardComponent implements OnInit {
  readonly pageTitle = $localize`:@@featureTicketsBoard-title:Tickets`;
  readonly commentInputAriaLabel = $localize`:@@featureTicketsBoard-commentPlaceholder:Add a comment...`;
  readonly workspaceBadgeSwitchTitle = $localize`:@@featureTicketsBoard-workspaceBadgeSwitchTitle:Switch workspace`;
  readonly newTicketAriaLabel = $localize`:@@featureTicketsBoard-newTicket:Add`;
  readonly loadingLabel = $localize`:@@featureTicketsBoard-loading:Loading tickets...`;
  readonly laneSearchPlaceholder = $localize`:@@featureTicketsBoard-searchLanePlaceholder:Search tickets`;
  readonly laneSearchAriaLabel = $localize`:@@featureTicketsBoard-searchLaneLabel:Search tickets`;
  /** Lanes: one stacked `fpc-data-table` per lane; rows drag between the lanes of this group. */
  readonly laneDropGroup = 'agenstra-tickets-lanes';
  /** Lanes render every ticket (variable-height cards; drag and drop is off in the table's virtual mode). */
  readonly laneVirtualThreshold = Number.MAX_SAFE_INTEGER;
  readonly viewSwitchLabel = $localize`:@@featureTicketsBoard-viewSwitch:View`;
  readonly tableViewLabel = $localize`:@@featureTicketsBoard-viewTable:Table view`;
  readonly lanesViewLabel = $localize`:@@featureTicketsBoard-viewLanes:Lanes view`;
  readonly ticketSubtaskText = ticketSubtaskText;
  readonly closedInTableLabel = $localize`:@@featureTicketsBoard-closedInTable:Done / closed: in the table`;
  readonly closedInTableTitle = $localize`:@@featureTicketsBoard-closedInTableTitle:Lanes show the open workflow (draft to prototype). Show all statuses in the table`;
  readonly subtaskCountTitle = $localize`:@@featureTicketsBoard-subtaskCountTitle:Direct subtasks (done / total)`;
  private readonly RELATION_TARGET_KIND_KNOWLEDGE = 'knowledge';
  private readonly RELATION_TARGET_KIND_TICKET = 'ticket';
  private readonly clientsFacade = inject(ClientsFacade);
  private readonly clientsService = inject(ClientsService);
  private readonly agentsFacade = inject(AgentsFacade);
  private readonly ticketsFacade = inject(TicketsFacade);
  private readonly knowledgeFacade = inject(KnowledgeFacade);
  private readonly knowledgeService = inject(KnowledgeService);
  private readonly ticketsService = inject(TicketsService);
  private readonly vcsService = inject(VcsService);
  private readonly socketsFacade = inject(ContainerSocketFacade);
  private readonly chatTimelineFacade = inject(ChatTimelineFacade);
  private readonly ticketsBoardSocketFacade = inject(TicketsBoardSocketFacade);
  private readonly ticketAutomationFacade = inject(TicketAutomationFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly actions$ = inject(Actions);

  /**
   * Tracks which ticket the automation form was last aligned to (detail open).
   * `automationDraftLastSyncedConfigUpdatedAt` avoids re-applying the same server snapshot repeatedly,
   * but allows websocket / REST config updates when `updatedAt` advances.
   */
  private automationDraftSyncTicketId: string | null = null;
  private automationDraftLastSyncedConfigUpdatedAt: string | null = null;
  /** If autosave ran while `ticketAutomationSaving`, flush again once the store finishes saving. */
  private pendingAutomationAutosaveAfterBusy = false;
  readonly ticketDetailModalOpen = signal(false);
  readonly ticketRelationsModalOpen = signal(false);
  readonly ticketMigrateModalOpen = signal(false);
  readonly ticketAutomationRunModalOpen = signal(false);
  readonly deleteTicketConfirmModalOpen = signal(false);
  readonly createTicketModalOpen = signal(false);
  readonly workspaceSwitchModalOpen = signal(false);

  /** Tracks ticket-detail hide/show when a nested overlay opens over it. */
  readonly ticketDetailOverlaySwapState: AgentModalSwapState = { suspended: false };

  @ViewChild('ticketRelationsSearchInput', { static: false })
  private ticketRelationsSearchInput?: ElementRef<HTMLElement>;

  private readonly detailTitleInputRef = viewChild<ElementRef<HTMLElement>>('detailTitleInput');

  readonly lanes = BOARD_LANE_STATUSES;
  readonly ticketsBoardRowsByStatus$ = this.ticketsFacade.ticketsBoardRowsByStatus$;
  /** Table | Lanes (URL `view=`, then localStorage, default table). */
  private readonly boardView = ticketBoardViewState();
  readonly view = this.boardView.view;
  readonly statusOptions: TicketStatus[] = [...ALL_TICKET_STATUSES];
  readonly priorityOptions: TicketPriority[] = ['low', 'medium', 'high', 'critical'];

  // Tickets table (3.38 D1; infinite mode — the one exception to paging, decision 5).
  readonly statusFilterLabel = $localize`:@@featureTicketsBoard-filterStatus:Status`;
  readonly priorityFilterLabel = $localize`:@@featureTicketsBoard-filterPriority:Priority`;
  readonly bulkStatusLabel = $localize`:@@featureTicketsBoard-bulkStatus:Set status…`;
  readonly bulkPriorityLabel = $localize`:@@featureTicketsBoard-bulkPriority:Set priority…`;
  readonly deleteLabel = AG_DL_DELETE;
  readonly closeLabel = AG_DL_CLOSE;
  readonly bulkDeleteTitle = $localize`:@@featureTicketsBoard-bulkDeleteTitle:Delete tickets`;
  readonly cancelLabel = $localize`:@@featureTicketsBoard-bulkDeleteCancel:Cancel`;
  readonly automationEligibleLabel = $localize`:@@featureTicketsBoard-automationEligibleTitle:Autonomous prototyping enabled`;
  readonly subtasksLabel = $localize`:@@featureTicketsBoard-subtasksHeading:Subtasks`;
  readonly automationRunsLabel = $localize`:@@featureTicketsBoard-automationRunsHeading:Runs`;
  readonly moveToHeading = $localize`:@@featureTicketsBoard-moveTo:Move to`;
  readonly ticketStatusFilterOptions: readonly TicketStatusFilter[] = ['open', 'all', ...TICKET_STATUSES];
  readonly ticketColumns = ticketTableColumns();
  /** Lane cards: State (icon) · Ticket (short hash + title) / Priority · Subtasks (priority-1 lines). */
  readonly laneColumns: FpcTableColumn<TicketBoardRow>[] = this.ticketColumns
    .filter((column) => ['status', 'ticket', 'priority', 'subtasks'].includes(column.id))
    .map((column) => (column.id === 'subtasks' ? { ...column, priority: 1 } : column));
  /** Main table: subtasks as a count chip next to the title instead of a mostly empty column (AG-10). */
  readonly mainTicketColumns = this.ticketColumns.filter((column) => column.id !== 'subtasks');
  readonly subtaskColumns = this.ticketColumns.filter(
    (column) => column.id !== 'createdBy' && column.id !== 'subtasks',
  );
  readonly ticketRowId = (row: TicketBoardRow): string => row.ticket.id;
  /** Real link of a ticket row: the board route with `openTicketId` (opens the detail modal, then clears itself). */
  readonly ticketRowLink = (row: TicketBoardRow): string | null => {
    const parent = this.route.parent;
    const commands = ['tickets', row.ticket.clientId];
    const tree = parent
      ? this.router.createUrlTree(commands, { relativeTo: parent, queryParams: { openTicketId: row.ticket.id } })
      : this.router.createUrlTree(['/', ...commands], { queryParams: { openTicketId: row.ticket.id } });

    return this.router.serializeUrl(tree);
  };
  readonly ticketStatusFilter = signal<TicketStatusFilter>('open');
  readonly ticketPriorityFilter = signal<TicketPriority | ''>('');
  readonly ticketSearch = signal('');
  readonly ticketSort = signal<FpcTableSort | null>(null);
  readonly ticketFiltersOpen = signal(false);
  readonly ticketFilterState = fpcListQueryState({
    filters: { status: this.ticketStatusFilter, priority: this.ticketPriorityFilter },
    search: this.ticketSearch,
    open: this.ticketFiltersOpen,
  });
  /** All rows matching the filters / search / sort (the table shows the first `ticketVisibleCount`). */
  readonly ticketAllRows = computed(() =>
    buildTicketTableRows(
      this.ticketsList(),
      {
        status: this.ticketStatusFilter(),
        priority: this.ticketPriorityFilter(),
        search: this.ticketSearch(),
        sort: this.ticketSort(),
      },
      this.ticketColumns,
    ),
  );
  readonly ticketVisibleCount = signal(TICKET_TABLE_CHUNK);
  /** Back to the first chunk when the workspace, filters, search or sort change. */
  private readonly resetTicketChunk = effect(() => {
    this.effectiveClientId();
    this.ticketStatusFilter();
    this.ticketPriorityFilter();
    this.ticketSearch();
    this.ticketSort();
    untracked(() => this.ticketVisibleCount.set(TICKET_TABLE_CHUNK));
  });
  readonly ticketTableRows = computed(() => this.ticketAllRows().slice(0, this.ticketVisibleCount()));
  readonly ticketTableHasMore = computed(() => this.ticketAllRows().length > this.ticketVisibleCount());
  readonly selectedTicketIds = signal<readonly string[]>([]);
  readonly bulkBusy = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  /** Tickets of the open delete confirmation (selection or one row). */
  readonly ticketsPendingBulkDelete = signal<readonly TicketResponseDto[]>([]);
  readonly bulkDeleteConfirmOpen = signal(false);
  readonly bulkDeleteMessage = computed(() => {
    const pending = this.ticketsPendingBulkDelete();

    return pending.length === 1
      ? $localize`:@@featureTicketsBoard-bulkDeleteOne:Delete "${pending[0].title}:title:"? This cannot be undone.`
      : $localize`:@@featureTicketsBoard-bulkDeleteMany:Delete ${pending.length}:count: tickets? Subtasks of deleted tickets are deleted too. This cannot be undone.`;
  });
  readonly ticketRowMenu = (row: TicketBoardRow): FpcMenuItem[] => [
    agOpenItem(),
    ...this.statusOptions
      .filter((status) => status !== row.ticket.status)
      .map((status, index) => ({
        id: `status:${status}`,
        label: this.laneLabel(status),
        icon: ticketStatusState(status).icon,
        heading: index === 0 ? this.moveToHeading : undefined,
        dividerBefore: index === 0,
      })),
    agCopyIdItem(),
    { id: 'delete', label: AG_DL_DELETE, icon: 'trash', danger: true },
  ];
  readonly subtaskRowMenu = (row: TicketBoardRow): FpcMenuItem[] =>
    this.ticketRowMenu(row).filter((item) => item.id !== 'delete');
  readonly automationRunColumns: FpcTableColumn<TicketAutomationRunResponseDto>[] = [
    {
      id: 'status',
      label: $localize`:@@featureTicketsBoard-colRunStatus:Status`,
      type: 'state',
      state: (run) => ({
        label: ticketAutomationRunStatusLabel(run.status),
        tone: AUTOMATION_RUN_TONE[run.status] ?? 'neutral',
        icon: AUTOMATION_RUN_ICON[run.status],
      }),
    },
    {
      id: 'started',
      label: $localize`:@@featureTicketsBoard-colRunStarted:Started`,
      value: (run) => run.startedAt,
      required: true,
      priority: 1,
    },
    {
      id: 'phase',
      label: $localize`:@@featureTicketsBoard-colRunPhase:Phase`,
      value: (run) => ticketAutomationRunPhaseLabel(run.phase),
      priority: 1,
    },
    { id: 'verification', label: $localize`:@@featureTicketsBoard-colRunVerification:Verification`, priority: 2 },
    {
      id: 'branch',
      label: $localize`:@@featureTicketsBoard-colRunBranch:Branch`,
      value: (run) => run.branchName ?? '',
      mono: true,
      priority: 3,
    },
  ];
  readonly automationRunMenu = (run: TicketAutomationRunResponseDto): FpcMenuItem[] => [
    agOpenItem(),
    ...(this.ticketAutomationRunCanCancel(run)
      ? [
          {
            id: 'cancel',
            label: $localize`:@@featureTicketsBoard-automationCancelRunTitle:Cancel run`,
            icon: 'stop-circle',
            danger: true,
            disabled: this.ticketAutomationSaving(),
          },
        ]
      : []),
    agCopyIdItem(),
  ];
  readonly detailBreadcrumb$ = this.ticketsFacade.detailBreadcrumb$;
  readonly loadingList$ = this.ticketsFacade.loadingList$;
  readonly listError$ = this.ticketsFacade.error$;
  /** Workspace for this board: URL `:clientId` wins so deep links load before store catches up. */
  readonly effectiveClientId$ = combineLatest([this.route.paramMap, this.clientsFacade.activeClientId$]).pipe(
    map(([params, active]) => {
      const fromRoute = params.get('clientId')?.trim();

      return (fromRoute || active || null) as string | null;
    }),
    distinctUntilChanged(),
  );
  readonly effectiveClientId = toSignal(this.effectiveClientId$, { initialValue: null });

  readonly clients$ = this.clientsFacade.clients$;
  readonly clientsList = toSignal(this.clients$, { initialValue: [] as ClientResponseDto[] });
  readonly clientsLoading$ = this.clientsFacade.loading$;

  /** Workspace shown for the current board URL / active client (name when list is loaded). */
  readonly effectiveWorkspace$ = combineLatest([this.effectiveClientId$, this.clientsFacade.clients$]).pipe(
    map(([id, clients]) => {
      if (!id) {
        return null;
      }

      return { id, client: clients.find((c) => c.id === id) ?? null };
    }),
    distinctUntilChanged(
      (a, b) =>
        a?.id === b?.id &&
        (a?.client?.id ?? '') === (b?.client?.id ?? '') &&
        (a?.client?.name ?? '') === (b?.client?.name ?? ''),
    ),
  );
  readonly effectiveWorkspace = toSignal(this.effectiveWorkspace$, { initialValue: null });

  /** Target workspace for POST /tickets/:id/migrate (choices exclude current workspace). */
  migrationTargetClientId = signal('');

  readonly migrationTargetChoices = computed((): ClientResponseDto[] => {
    const wsId = this.effectiveWorkspace()?.id ?? this.detail()?.clientId ?? null;

    return this.clientsList().filter((c) => c.canManageWorkspaceConfiguration && wsId !== null && c.id !== wsId);
  });

  /** Filter text for the workspace switcher modal (same idea as the workspace list on /clients). */
  workspaceSwitchSearch = signal('');

  readonly detailLoading$ = this.ticketsFacade.loadingDetail$;
  readonly comments$ = this.ticketsFacade.comments$.pipe(map((comments) => [...comments].reverse()));
  readonly activity$ = this.ticketsFacade.activity$;
  readonly saving$ = this.ticketsFacade.saving$;
  readonly ticketsSaving = toSignal(this.saving$, { initialValue: false });

  readonly detail = toSignal(this.ticketsFacade.detail$, { initialValue: null });
  readonly detailBreadcrumb = toSignal(this.ticketsFacade.detailBreadcrumb$, { initialValue: [] });
  readonly ticketsList = toSignal(this.ticketsFacade.tickets$, { initialValue: [] });
  readonly knowledgeTree = toSignal(this.knowledgeFacade.tree$, { initialValue: [] as KnowledgeNodeDto[] });
  readonly ticketRelations = toSignal(this.knowledgeFacade.relations$, { initialValue: [] as KnowledgeRelationDto[] });
  readonly ticketRelationsLoading = toSignal(this.knowledgeFacade.relationsLoading$, { initialValue: false });

  readonly workspaceSwitchSearch$ = toObservable(this.workspaceSwitchSearch);

  /** Direct subtasks only (same depth rule as swimlanes; deeper work stays on the subtask’s own detail). */
  readonly detailSubtaskRows = computed((): TicketDetailSubtaskRow[] => {
    const children = this.detail()?.children ?? [];
    const sorted = [...children].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return sorted.map((ticket) => ({ ticket, depth: 1 }));
  });

  readonly agents$: Observable<AgentResponseDto[]> = this.effectiveClientId$.pipe(
    switchMap((clientId) => (clientId ? this.agentsFacade.getClientAgents$(clientId) : of([]))),
  );

  /** Agents for the board workspace (same store as `loadClientAgents` in `ngOnInit`). */
  readonly automationAgentChoices = toSignal(this.agents$, { initialValue: [] });
  readonly automationAgentsLoading = toSignal(
    this.effectiveClientId$.pipe(
      switchMap((clientId) => (clientId ? this.agentsFacade.getClientAgentsLoading$(clientId) : of(false))),
    ),
    { initialValue: false },
  );

  /** Agent IDs with prototype autonomy enabled (`client_agent_autonomy.enabled`); required for the scheduler to pick runs. */
  autonomyEnabledAgentIds = signal<string[]>([]);
  autonomyEnabledAgentIdsLoading = signal(false);

  /** Workspace agents that may actually run autonomous prototyping for this client. */
  readonly automationTicketAutomationAgentChoices = computed(() => {
    const enabled = new Set(this.autonomyEnabledAgentIds());

    return this.automationAgentChoices().filter((a) => enabled.has(a.id));
  });

  readonly chatCapableAgents$: Observable<AgentResponseDto[]> = this.agents$;

  /** Mirrors `chatCapableAgents$` for constructor effects (WebSocket detail updates, socket agent changes). */
  private readonly chatCapableAgentsSignal = toSignal(this.chatCapableAgents$, {
    initialValue: [] as AgentResponseDto[],
  });
  private readonly socketSelectedAgentIdSignal = toSignal(this.socketsFacade.selectedAgentId$, {
    initialValue: null as string | null,
  });

  selectedLane = signal<BoardLaneStatus>('draft');
  selectedAgentForAi = signal<string | null>(null);
  /** OpenCode `provider/model` for chat/AI on the open ticket. */
  selectedModelForAi = signal<string | null>(null);
  /** Model dropdown options for the selected chat agent (from GET .../models). */
  ticketAiModelOptions = signal<Array<{ value: string; label: string }>>([]);
  ticketAiModelsLoading = signal(false);
  /** The model catalog request failed or timed out (AG-05: no endless "Loading models…"). */
  ticketAiModelsFailed = signal(false);
  readonly ticketAiModelPlaceholder = computed(() =>
    ticketModelPlaceholder({
      hasAgent: !!this.selectedAgentForAi(),
      loading: this.ticketAiModelsLoading(),
      failed: this.ticketAiModelsFailed(),
    }),
  );
  newCommentText = signal('');
  prototypeError = signal<string | null>(null);
  bodyGenError = signal<string | null>(null);
  bodyGenInProgress = signal(false);
  pendingBodyCorrelation = signal<string | null>(null);
  ticketRelationsSearchQuery = signal('');
  ticketRelationsSuggestionsOpen = signal(false);
  selectedTicketRelationTargets = signal<
    Array<
      { kind: 'knowledge'; nodeId: string; nodeType: KnowledgeNodeType } | { kind: 'ticket'; ticketLongSha: string }
    >
  >([]);
  /** Flat knowledge nodes for relation search (independent of nested store tree). */
  readonly ticketRelationKnowledgeNodes = signal<KnowledgeNodeDto[]>([]);

  readonly ticketRelationCandidates = computed(() => {
    const detail = this.detail();
    const clientId = this.effectiveClientId();
    const query = this.ticketRelationsSearchQuery().trim().toLowerCase();

    if (!detail || !clientId || !query.length) {
      return [];
    }

    const existingNodeIds = new Set(
      this.ticketRelations()
        .map((relation) => relation.targetNodeId ?? null)
        .filter((id): id is string => id !== null),
    );
    const existingTicketShas = new Set(
      this.ticketRelations()
        .map((relation) => relation.targetTicketLongSha ?? null)
        .filter((sha): sha is string => sha !== null),
    );
    const pendingNodeIds = new Set(
      this.selectedTicketRelationTargets()
        .filter(
          (target): target is { kind: 'knowledge'; nodeId: string; nodeType: KnowledgeNodeType } =>
            target.kind === this.RELATION_TARGET_KIND_KNOWLEDGE,
        )
        .map((target) => target.nodeId),
    );
    const pendingTicketShas = new Set(
      this.selectedTicketRelationTargets()
        .filter(
          (target): target is { kind: 'ticket'; ticketLongSha: string } =>
            target.kind === this.RELATION_TARGET_KIND_TICKET,
        )
        .map((target) => target.ticketLongSha),
    );
    const candidates: Array<
      { kind: 'knowledge'; node: KnowledgeNodeDto } | { kind: 'ticket'; ticket: TicketResponseDto }
    > = [];

    for (const node of this.ticketRelationKnowledgeNodesForSearch()) {
      if (node.nodeType !== 'page' && node.nodeType !== 'folder') {
        continue;
      }

      if (existingNodeIds.has(node.id) || pendingNodeIds.has(node.id)) {
        continue;
      }

      const title = (node.title ?? '').toLowerCase();
      const shortSha = (node.shas?.short ?? '').toLowerCase();
      const longSha = (node.shas?.long ?? '').toLowerCase();
      const matchesQuery = title.includes(query) || shortSha.includes(query) || longSha.includes(query);

      if (matchesQuery) {
        candidates.push({ kind: this.RELATION_TARGET_KIND_KNOWLEDGE, node });
      }
    }

    for (const ticket of this.ticketsList()) {
      if (ticket.clientId !== clientId || ticket.id === detail.id || !ticket.shas?.long) {
        continue;
      }

      const shortSha = ticket.shas.short.toLowerCase();
      const longSha = ticket.shas.long.toLowerCase();
      const title = (ticket.title ?? '').toLowerCase();
      const matchesQuery = title.includes(query) || shortSha.includes(query) || longSha.includes(query);

      if (!matchesQuery || existingTicketShas.has(ticket.shas.long) || pendingTicketShas.has(ticket.shas.long)) {
        continue;
      }

      candidates.push({ kind: this.RELATION_TARGET_KIND_TICKET, ticket });
    }

    return candidates;
  });
  private activeGenerationId: string | null = null;

  readonly ticketAutomationConfig = toSignal(this.ticketAutomationFacade.config$, { initialValue: null });
  readonly ticketAutomationRuns = toSignal(this.ticketAutomationFacade.runs$, { initialValue: [] });
  readonly ticketAutomationRunDetail = toSignal(this.ticketAutomationFacade.runDetail$, { initialValue: null });
  readonly ticketAutomationLoadingConfig = toSignal(this.ticketAutomationFacade.loadingConfig$, {
    initialValue: false,
  });
  readonly ticketAutomationLoadingRuns = toSignal(this.ticketAutomationFacade.loadingRuns$, { initialValue: false });
  readonly ticketAutomationLoadingRunDetail = toSignal(this.ticketAutomationFacade.loadingRunDetail$, {
    initialValue: false,
  });
  readonly ticketAutomationSaving = toSignal(this.ticketAutomationFacade.saving$, { initialValue: false });
  readonly ticketAutomationError = toSignal(this.ticketAutomationFacade.error$, { initialValue: null });

  readonly automationSortedRuns = computed(() =>
    [...this.ticketAutomationRuns()].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
  );

  /**
   * Branch label for the automation accordion: saved `defaultBranchOverride`, or else `branchName`
   * from the most recent run (by `startedAt`).
   */
  readonly ticketAutomationBranchBadge = computed(() => {
    const cfg = this.ticketAutomationConfig();
    const override = cfg?.defaultBranchOverride?.trim();

    if (override && override.length > 0) {
      return override;
    }

    const runs = this.automationSortedRuns();
    const fromRun = runs[0]?.branchName?.trim();

    return fromRun && fromRun.length > 0 ? fromRun : null;
  });

  /** Stable fingerprint of automation draft for debounced autosave (JSON key order follows `buildTicketAutomationPatchDto`). */
  private readonly automationAutosaveFingerprint = computed(() => JSON.stringify(this.buildTicketAutomationPatchDto()));

  /**
   * Allowed agent IDs not shown in the main checkbox list (removed agent, autonomy disabled, etc.).
   */
  readonly automationOrphanAllowedAgentIds = computed(() => {
    const allowed = this.automationDraftAllowedAgentIds();
    const listed = new Set(this.automationTicketAutomationAgentChoices().map((a) => a.id));

    return allowed.filter((id) => !listed.has(id));
  });

  automationDraftEligible = signal(false);
  /**
   * Accordion open state for autonomous prototyping (user-controlled via toggle).
   * Defaults from server `eligible` only on the first automation config apply after opening a ticket;
   * later websocket/REST config updates must not reset it.
   */
  ticketAutomationAccordionExpanded = signal(false);
  automationDraftRequiresApproval = signal(false);
  /** Sorted unique agent UUIDs allowed to run automation for this ticket. */
  automationDraftAllowedAgentIds = signal<string[]>([]);
  /** OpenCode `provider/model` for autonomous runs. */
  automationDraftPreferredModel = signal<string | null>(null);
  automationDraftIncludeWorkspaceContext = signal(true);
  automationDraftAutoEnrichmentEnabled = signal(true);
  automationDraftContextEnvironmentIds = signal<string[]>([]);
  automationDraftDefaultBranch = signal('');
  automationDraftBranchStrategy = signal<TicketAutomationBranchStrategy>('reuse_per_ticket');
  /**
   * Default branch override suggestions (2026-10-29): the branches of the environment the run starts in (the chat
   * environment when it may run, else the first allowed one), from that environment's VCS listing (scoped; a 401 / 403
   * leaves the plain input with a hint). Free text stays allowed.
   */
  readonly automationBranchEnvironmentId = computed(() =>
    pickAutomationBranchEnvironment(this.automationDraftAllowedAgentIds(), this.selectedAgentForAi()),
  );
  readonly automationBranchLoader = computed<ReferenceComboboxLoader | null>(() => {
    const clientId = this.effectiveClientId();
    const agentId = this.automationBranchEnvironmentId();

    return clientId && agentId
      ? buildAutomationBranchLoader(this.vcsService, clientId, agentId, {
          local: this.localBranchLabel,
          remote: this.remoteBranchLabel,
        })
      : null;
  });
  readonly localBranchLabel = $localize`:@@featureGitBranchModal-stateLocal:Local branch`;
  readonly remoteBranchLabel = $localize`:@@featureGitBranchModal-stateRemote:Remote branch`;
  readonly automationBranchEmpty = $localize`:@@featureTicketsBoard-automationBranchEmpty:No branches found in this environment.`;
  automationDraftForceNewBranchNextRun = signal(false);
  automationVerifierRows = signal<Array<{ cmd: string; cwd: string }>>([{ cmd: '', cwd: '' }]);
  /** Lanes view drawer: only the priority filter applies (the lanes are the statuses). */
  readonly laneFiltersActive = computed(() => (this.ticketPriorityFilter() ? 1 : 0));
  private readonly laneRowsByStatus = toSignal(this.ticketsBoardRowsByStatus$, { initialValue: null });
  /** Rows of each lane narrowed by the strip's search + priority (one array per lane until the inputs change). */
  readonly laneTableRows = computed(() => {
    const byStatus = this.laneRowsByStatus();

    return Object.fromEntries(this.lanes.map((lane) => [lane, this.filteredLaneRows(byStatus?.[lane])])) as Record<
      BoardLaneStatus,
      TicketBoardRow[]
    >;
  });
  readonly hiddenMatchesTitle = $localize`:@@featureTicketsBoard-moreMatchesTitle:Matches in other statuses or hidden lanes (done, closed) — show them in the table with all statuses`;
  /** Removable chips of the applied filters (status when not the default "open", priority). */
  readonly ticketChips = computed((): FpcFilterChip[] => [
    ...(this.ticketStatusFilter() !== 'open'
      ? [
          {
            id: 'status',
            value: this.ticketStatusFilter(),
            label: `${this.statusFilterLabel}: ${ticketStatusFilterLabel(this.ticketStatusFilter())}`,
          },
        ]
      : []),
    ...this.laneChips(),
  ]);
  readonly laneChips = computed((): FpcFilterChip[] => {
    const priority = this.ticketPriorityFilter();

    return priority
      ? [{ id: 'priority', value: priority, label: `${this.priorityFilterLabel}: ${ticketPriorityLabel(priority)}` }]
      : [];
  });
  /** Search / priority matches the current view hides (other statuses, ticket statuses without a lane). */
  readonly hiddenMatchCount = computed(() => {
    const query = { priority: this.ticketPriorityFilter(), search: this.ticketSearch() };
    let visible: Set<string>;

    if (this.view() === 'table') {
      visible = new Set(this.ticketAllRows().map((row) => row.ticket.id));
    } else {
      const byStatus = this.laneRowsByStatus();

      visible = new Set(
        this.lanes.flatMap((lane) => this.filteredLaneRows(byStatus?.[lane]).map((row) => row.ticket.id)),
      );
    }

    return ticketHiddenMatchCount(this.ticketsList(), query, visible);
  });
  readonly hiddenMatchLabel = computed(() => ticketHiddenMatchLabel(this.hiddenMatchCount()));

  createTicketTitle = signal('');
  createTicketContent = signal('');
  createTicketStatus = signal<TicketStatus>('draft');
  createTicketPriority = signal<TicketPriority>('medium');
  /** Root ticket only: adds spec-driven subtasks when `specification`. */
  createTicketCreationTemplate = signal<TicketCreationTemplate>('empty');
  /** When set, new ticket is created as a subtask of this ticket (clientId inferred by API). */
  createTicketParentId = signal<string | null>(null);
  createTicketError = signal<string | null>(null);

  /** Set when opening the delete confirmation modal (stacked over detail modal). */
  ticketPendingDelete = signal<{ id: string; title: string } | null>(null);
  /** When true, DELETE /tickets includes releaseExternalSyncMarker so Jira import can recreate the ticket. */
  releaseExternalSyncMarkerOnTicketDelete = signal(false);

  /** Local description text; synced from `detail` when the open ticket id or server `updatedAt` changes. */
  readonly descriptionDraft = signal('');
  private descriptionDraftSyncTicketId: string | null = null;
  private descriptionDraftLastSyncedUpdatedAt: string | null = null;

  /** Inline rename of the ticket title in the detail modal header (blur commits via {@link TicketsFacade.update}). */
  detailTitleEditing = signal(false);
  detailTitleDraft = signal('');
  private readonly pendingDetailTitleRename = signal<{ ticketId: string; sentTitle: string } | null>(null);
  private detailTitleEditSyncDetailId: string | null = null;

  /**
   * Keeps "Agent for chat / AI" aligned with `detail` (incl. `ticketUpsert`) and with socket / agent list changes.
   * Replaces a one-shot `combineLatest`+`take(1)` on open that never saw later store updates.
   */
  private chatAgentForAiSyncTicketId: string | null = null;
  private chatAgentForAiLastSyncedDetailUpdatedAt: string | null = null;
  /** Bumps on each {@link openTicketDetailFlow} so stale load completions cannot reopen the modal. */
  private ticketDetailOpenGeneration = 0;

  constructor() {
    effect(() => {
      if (this.ticketRelationsModalOpen()) {
        afterNextRender(
          () => {
            this.ticketRelationsSearchInput?.nativeElement
              ?.querySelector<HTMLInputElement>('input')
              ?.focus({ preventScroll: true });
          },
          { injector: this.injector },
        );
      }
    });

    effect(() => {
      const clientId = this.effectiveClientId();

      if (!clientId) {
        return;
      }

      this.knowledgeFacade.loadTree(clientId);
    });

    effect(() => {
      const clientId = this.effectiveClientId();
      const detail = this.detail();

      if (!clientId || !detail?.id) {
        return;
      }

      this.knowledgeFacade.loadRelations(clientId, 'ticket', detail.id);
      this.refreshTicketRelationKnowledgeNodes();
    });

    effect(() => {
      const id = this.detail()?.id ?? null;

      if (id === this.detailTitleEditSyncDetailId) {
        return;
      }

      this.detailTitleEditSyncDetailId = id;
      this.detailTitleEditing.set(false);
      this.pendingDetailTitleRename.set(null);
    });

    effect(() => {
      const saving = this.ticketsSaving();
      const pending = this.pendingDetailTitleRename();
      const editing = this.detailTitleEditing();
      const d = this.detail();

      if (saving || !pending || !editing) {
        return;
      }

      if (!d || d.id !== pending.ticketId) {
        this.pendingDetailTitleRename.set(null);

        return;
      }

      if (d.title.trim() === pending.sentTitle.trim()) {
        this.detailTitleEditing.set(false);
        this.pendingDetailTitleRename.set(null);

        return;
      }

      this.pendingDetailTitleRename.set(null);
      afterNextRender(
        () => {
          this.detailTitleInputRef()?.nativeElement?.querySelector<HTMLInputElement>('input')?.focus();
        },
        { injector: this.injector },
      );
    });

    effect(() => {
      const d = this.detail();

      if (!d) {
        this.descriptionDraftSyncTicketId = null;
        this.descriptionDraftLastSyncedUpdatedAt = null;
        this.descriptionDraft.set('');

        return;
      }

      if (this.descriptionDraftSyncTicketId !== d.id) {
        this.descriptionDraftSyncTicketId = d.id;
        this.descriptionDraftLastSyncedUpdatedAt = null;
      }

      const rev = d.updatedAt;

      if (rev === this.descriptionDraftLastSyncedUpdatedAt) {
        return;
      }

      this.descriptionDraftLastSyncedUpdatedAt = rev;
      this.descriptionDraft.set(d.content ?? '');
    });

    effect(() => {
      const d = this.detail();
      const chatAgents = this.chatCapableAgentsSignal();
      const socketAgentId = this.socketSelectedAgentIdSignal();

      if (!d) {
        this.chatAgentForAiSyncTicketId = null;
        this.chatAgentForAiLastSyncedDetailUpdatedAt = null;
        this.selectedAgentForAi.set(null);
        this.selectedModelForAi.set(null);
        this.ticketAiModelOptions.set([]);

        return;
      }

      if (this.chatAgentForAiSyncTicketId !== d.id) {
        this.chatAgentForAiSyncTicketId = d.id;
        this.chatAgentForAiLastSyncedDetailUpdatedAt = null;
        this.selectedAgentForAi.set(null);
        this.selectedModelForAi.set(d.preferredChatModel ?? null);
      }

      if (chatAgents.length === 0 && this.chatAgentForAiLastSyncedDetailUpdatedAt === null) {
        return;
      }

      const pick = this.pickChatAgentForTicket(d, chatAgents, socketAgentId);
      const rev = d.updatedAt;
      const revBumped = rev !== this.chatAgentForAiLastSyncedDetailUpdatedAt;
      const prevPick = this.selectedAgentForAi();

      if (!revBumped && pick === prevPick) {
        return;
      }

      if (revBumped) {
        this.chatAgentForAiLastSyncedDetailUpdatedAt = rev;
        this.selectedModelForAi.set(d.preferredChatModel ?? this.selectedModelForAi());
      }

      this.selectedAgentForAi.set(pick);
      queueMicrotask(() => {
        this.ensureChatAgentInAutomationAllowedList();
        this.ensureChatAgentInAutomationContextEnvironmentList();
        this.ensureChatModelInAutomationPreferredModel();
      });
    });

    effect(() => {
      const clientId = this.effectiveClientId();
      const agentId = this.selectedAgentForAi();

      if (!clientId || !agentId) {
        this.ticketAiModelOptions.set([]);
        this.ticketAiModelsLoading.set(false);
        this.ticketAiModelsFailed.set(false);

        return;
      }

      this.ticketAiModelsLoading.set(true);
      this.ticketAiModelsFailed.set(false);
      this.agentsFacade.loadClientAgentModels(clientId, agentId);
    });

    combineLatest([toObservable(this.effectiveClientId), toObservable(this.selectedAgentForAi)])
      .pipe(
        switchMap(([clientId, agentId]) => {
          if (!clientId || !agentId) {
            return of({ models: null as Record<string, string> | null, loading: false, error: null as string | null });
          }

          return combineLatest([
            this.agentsFacade.getClientAgentModels$(clientId, agentId),
            this.agentsFacade.getClientAgentModelsLoading$(clientId, agentId),
            this.agentsFacade.getClientAgentModelsError$(clientId, agentId),
          ]).pipe(map(([models, loading, error]) => ({ models, loading, error })));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ models, loading, error }) => {
        this.ticketAiModelsLoading.set(loading || (models === null && error === null));
        this.ticketAiModelsFailed.set(!loading && error !== null);
        const opts = models ? Object.entries(models).map(([value, label]) => ({ value, label })) : [];

        this.ticketAiModelOptions.set(opts);
        const current = this.selectedModelForAi();

        if (opts.length === 0) {
          return;
        }

        if (!current || !opts.some((o) => o.value === current)) {
          const next = opts[0]?.value ?? null;

          this.selectedModelForAi.set(next);
          const detail = this.detail();

          if (detail && next && next !== (detail.preferredChatModel ?? null)) {
            this.ticketsFacade.update(detail.id, { preferredChatModel: next });
          }

          queueMicrotask(() => this.ensureChatModelInAutomationPreferredModel());
        }
      });

    effect(() => {
      const d = this.detail()?.id;

      if (!d) {
        this.automationDraftSyncTicketId = null;
        this.automationDraftLastSyncedConfigUpdatedAt = null;
        this.ticketAutomationAccordionExpanded.set(false);

        return;
      }

      const cfg = this.ticketAutomationConfig();

      if (!cfg || cfg.ticketId !== d) {
        return;
      }

      if (this.automationDraftSyncTicketId !== d) {
        this.automationDraftSyncTicketId = d;
        this.automationDraftLastSyncedConfigUpdatedAt = null;
      }

      const rev = cfg.updatedAt;

      if (rev === this.automationDraftLastSyncedConfigUpdatedAt) {
        return;
      }

      const applyAccordionDefaultFromEligible = this.automationDraftLastSyncedConfigUpdatedAt === null;

      this.automationDraftLastSyncedConfigUpdatedAt = rev;
      this.automationDraftEligible.set(cfg.eligible);

      if (applyAccordionDefaultFromEligible) {
        this.ticketAutomationAccordionExpanded.set(cfg.eligible);
      }

      this.automationDraftRequiresApproval.set(cfg.requiresApproval);
      this.automationDraftAllowedAgentIds.set(normalizeAllowedAgentIdList(cfg.allowedAgentIds));
      this.automationDraftPreferredModel.set(cfg.preferredModel ?? null);
      this.automationDraftIncludeWorkspaceContext.set(cfg.includeWorkspaceContext !== false);
      this.automationDraftAutoEnrichmentEnabled.set(cfg.autoEnrichmentEnabled !== false);
      this.automationDraftContextEnvironmentIds.set(normalizeAllowedAgentIdList(cfg.contextEnvironmentIds ?? []));
      this.automationDraftDefaultBranch.set(cfg.defaultBranchOverride ?? '');
      this.automationDraftBranchStrategy.set(cfg.automationBranchStrategy ?? 'reuse_per_ticket');
      this.automationDraftForceNewBranchNextRun.set(cfg.forceNewAutomationBranchNextRun === true);
      const cmds = cfg.verifierProfile?.commands?.length
        ? cfg.verifierProfile.commands.map((c) => ({ cmd: c.cmd, cwd: c.cwd ?? '' }))
        : [{ cmd: '', cwd: '' }];

      this.automationVerifierRows.set(cmds);
      queueMicrotask(() => {
        this.ensureChatAgentInAutomationAllowedList();
        this.ensureChatAgentInAutomationContextEnvironmentList();
        this.ensureChatModelInAutomationPreferredModel();
      });
    });

    effect(() => {
      const d = this.detail()?.id;
      const cfg = this.ticketAutomationConfig();

      this.selectedAgentForAi();
      this.selectedModelForAi();
      this.automationTicketAutomationAgentChoices();
      this.autonomyEnabledAgentIds();

      if (!d || !cfg || cfg.ticketId !== d) {
        return;
      }

      if (this.automationDraftSyncTicketId !== d) {
        return;
      }

      queueMicrotask(() => {
        this.ensureChatAgentInAutomationAllowedList();
        this.ensureChatAgentInAutomationContextEnvironmentList();
        this.ensureChatModelInAutomationPreferredModel();
      });
    });

    toObservable(this.automationAutosaveFingerprint)
      .pipe(debounceTime(500), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.tryAutosaveTicketAutomationSettings();
      });

    this.actions$
      .pipe(
        ofType(
          patchTicketAutomationSuccess,
          patchTicketAutomationFailure,
          approveTicketAutomationSuccess,
          approveTicketAutomationFailure,
          unapproveTicketAutomationSuccess,
          unapproveTicketAutomationFailure,
          cancelTicketAutomationRunSuccess,
          cancelTicketAutomationRunFailure,
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((action) => {
        if (
          action.type === patchTicketAutomationFailure.type ||
          action.type === approveTicketAutomationFailure.type ||
          action.type === unapproveTicketAutomationFailure.type ||
          action.type === cancelTicketAutomationRunFailure.type
        ) {
          this.pendingAutomationAutosaveAfterBusy = false;

          return;
        }

        const tid = this.detail()?.id;

        if (!tid) {
          return;
        }

        const affectedTicketId =
          'config' in action ? action.config.ticketId : 'run' in action ? action.run.ticketId : null;

        if (!affectedTicketId || affectedTicketId !== tid) {
          return;
        }

        if (!this.pendingAutomationAutosaveAfterBusy) {
          return;
        }

        this.pendingAutomationAutosaveAfterBusy = false;
        queueMicrotask(() => this.tryAutosaveTicketAutomationSettings());
      });

    this.actions$.pipe(ofType(migrateTicketSuccess), takeUntilDestroyed(this.destroyRef)).subscribe((a) => {
      this.ticketDetailOverlaySwapState.suspended = false;
      hideAgentModal(this.ticketMigrateModalOpen);
      hideAgentModal(this.deleteTicketConfirmModalOpen);
      const targetId = a.rootTicket.clientId;
      const current = this.effectiveClientId();

      if (current && current !== targetId) {
        this.clientsFacade.setActiveClient(targetId);
        const parent = this.route.parent;
        const queryClear = {
          queryParams: { openTicketId: null, openAutomationRunId: null },
          queryParamsHandling: 'merge' as const,
        };
        const nav = parent
          ? this.router.navigate(['tickets', targetId], { relativeTo: parent, ...queryClear })
          : this.router.navigate(['/tickets', targetId], queryClear);

        void nav.then(() => {
          this.showTicketDetailModalAfterTicketListLoadForClient(targetId, a.requestedTicketId);
          this.ticketsFacade.loadTickets({ clientId: targetId });
        });
      } else {
        this.showTicketDetailModalAfterTicketListLoadForClient(targetId, a.requestedTicketId);
        this.ticketsFacade.loadTickets({ clientId: targetId });
      }
    });

    this.actions$.pipe(ofType(createTicketSuccess), takeUntilDestroyed(this.destroyRef)).subscribe(({ ticket }) => {
      if (!ticket.parentId) {
        return;
      }

      // Subtask create: leave the parent and open the new ticket detail.
      this.ticketDetailOverlaySwapState.suspended = false;
      this.openTicketDetailFlow(ticket.id);
    });
  }

  ngOnInit(): void {
    this.clientsFacade.loadClients();

    this.workspaceSwitchSearch$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.clientsFacade.loadClients({ search: search.trim() || undefined });
      });

    this.effectiveClientId$
      .pipe(
        distinctUntilChanged(),
        switchMap((clientId) => {
          if (!clientId) {
            this.ticketsBoardSocketFacade.disconnect();

            return EMPTY;
          }

          return this.ticketsBoardSocketFacade.ensureConnectedAndSetClient(clientId);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    this.effectiveClientId$
      .pipe(
        distinctUntilChanged(),
        tap((clientId) => {
          if (!clientId) {
            this.autonomyEnabledAgentIds.set([]);
            this.autonomyEnabledAgentIdsLoading.set(false);
          }
        }),
        switchMap((clientId) => {
          if (!clientId) {
            return of({ agentIds: [] as string[] });
          }

          this.agentsFacade.loadClientAgents(clientId);
          this.ticketsFacade.loadTickets({ clientId });
          this.autonomyEnabledAgentIdsLoading.set(true);

          return this.clientsService.listEnabledAutonomyAgentIds(clientId).pipe(
            catchError(() => of({ agentIds: [] as string[] })),
            finalize(() => this.autonomyEnabledAgentIdsLoading.set(false)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => this.autonomyEnabledAgentIds.set(r.agentIds));

    this.chatTimelineFacade.ticketBodyLastResult$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter(
          (r) => !!r && this.pendingBodyCorrelation() !== null && r.correlationId === this.pendingBodyCorrelation(),
        ),
      )
      .subscribe((r) => {
        if (!r) {
          return;
        }

        this.pendingBodyCorrelation.set(null);
        this.bodyGenInProgress.set(false);
        const generationId = this.activeGenerationId;
        const ticketId = this.detail()?.id;
        const clientId = this.effectiveClientId();

        if (!ticketId || !generationId || !clientId) {
          this.bodyGenError.set(
            $localize`:@@featureTicketsBoard-bodyGenMissingContext:Could not apply generated text (missing session).`,
          );

          return;
        }

        if (!r.success) {
          this.bodyGenError.set(r.errorMessage ?? $localize`:@@featureTicketsBoard-bodyGenFailed:Generation failed`);
          this.activeGenerationId = null;

          return;
        }

        const text = r.enhancedText ?? '';

        this.ticketsService.applyGeneratedBody(ticketId, generationId, text).subscribe({
          next: () => {
            this.activeGenerationId = null;
            this.bodyGenError.set(null);
            this.ticketsFacade.loadTickets({ clientId });
            this.ticketsFacade.openDetail(ticketId);
          },
          error: (err: unknown) => {
            this.activeGenerationId = null;
            this.bodyGenError.set(this.httpErrorMessage(err));
          },
        });
      });

    this.route.queryParamMap.pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const ticketId = params.get('openTicketId')?.trim();
      const runId = params.get('openAutomationRunId')?.trim();

      if (ticketId && runId) {
        queueMicrotask(() => {
          this.openTicketDetailFlow(ticketId);
          this.scheduleOpenAutomationRunWhenDetailReady(ticketId, runId);
        });
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { openTicketId: null, openAutomationRunId: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });

        return;
      }

      if (ticketId) {
        queueMicrotask(() => this.openTicketDetailFlow(ticketId));
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { openTicketId: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });

    this.watchOpenWorkspaceSwitchWhenNoClientSelected();
  }

  private watchOpenWorkspaceSwitchWhenNoClientSelected(): void {
    this.effectiveClientId$
      .pipe(
        distinctUntilChanged(),
        filter((id) => !id),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        queueMicrotask(() => this.openWorkspaceSwitchModal());
      });
  }

  /** "and n more": widen to the table with every status (removable "Status: All statuses" chip). */
  showHiddenMatches(): void {
    this.setView('table');
    this.ticketStatusFilter.set('all');
    this.ticketFilterState.syncDraft();
  }

  removeTicketChip(chip: FpcFilterChip): void {
    if (chip.id === 'status' || chip.id === 'priority') {
      this.ticketFilterState.reset(chip.id);
    }
  }

  setView(view: TicketBoardView): void {
    if (view !== this.view()) {
      this.boardView.set(view);
    }
  }

  /** Lane rows narrowed by the board search + priority filter (one toolbar above all lanes, shared with the table). */
  filteredLaneRows(rows: TicketBoardRow[] | undefined): TicketBoardRow[] {
    return filterTicketLaneRows(rows ?? [], { priority: this.ticketPriorityFilter(), search: this.ticketSearch() });
  }

  onSelectedLaneTabChange(status: string | null): void {
    if (status === null || !(BOARD_LANE_STATUSES as readonly string[]).includes(status)) {
      return;
    }

    this.selectedLane.set(status as BoardLaneStatus);
  }

  laneLabel(status: TicketStatus): string {
    return ticketLaneStatusLabel(status);
  }

  priorityLabel(priority: TicketPriority): string {
    return ticketPriorityLabel(priority);
  }

  statusFilterOptionLabel(value: TicketStatusFilter): string {
    return ticketStatusFilterLabel(value);
  }

  /** Infinite mode: show the next chunk of the loaded tickets (the list API returns them all; no backend paging). */
  onLoadMoreTickets(): void {
    if (this.ticketTableHasMore()) {
      this.ticketVisibleCount.update((count) => count + TICKET_TABLE_CHUNK);
    }
  }

  onTicketRowAction(row: TicketBoardRow, action: string): void {
    const ticket = row.ticket;

    if (action === 'open') {
      this.openTicketDetailFlow(ticket.id);
    } else if (action === 'copy-id') {
      fpcCopyText(ticket.id);
    } else if (action === 'delete') {
      this.ticketsPendingBulkDelete.set([ticket]);
      this.bulkDeleteConfirmOpen.set(true);
    } else if (action.startsWith('status:')) {
      this.ticketsFacade.update(ticket.id, { status: action.slice('status:'.length) as TicketStatus });
    }
  }

  /** The selected tickets that are still loaded. */
  private selectedTickets(): TicketResponseDto[] {
    const ids = new Set(this.selectedTicketIds());

    return this.ticketsList().filter((ticket) => ids.has(ticket.id));
  }

  onBulkStatus(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const status = select.value as TicketStatus;

    select.value = '';
    this.onBulkStatusValue(status);
  }

  /** Batch menu (status): fan the change out over the selected tickets. */
  onBulkStatusValue(status: TicketStatus): void {
    if (status) {
      void this.runTicketBulk(() =>
        bulkUpdateTickets(this.selectedTickets(), { status }, this.updateTicket, this.upsertTicket),
      );
    }
  }

  onBulkPriority(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const priority = select.value as TicketPriority;

    select.value = '';
    this.onBulkPriorityValue(priority);
  }

  /** Batch menu (priority): fan the change out over the selected tickets. */
  onBulkPriorityValue(priority: TicketPriority): void {
    if (priority) {
      void this.runTicketBulk(() =>
        bulkUpdateTickets(this.selectedTickets(), { priority }, this.updateTicket, this.upsertTicket),
      );
    }
  }

  requestBulkDelete(): void {
    const tickets = this.selectedTickets();

    if (tickets.length > 0) {
      this.ticketsPendingBulkDelete.set(tickets);
      this.bulkDeleteConfirmOpen.set(true);
    }
  }

  onConfirmBulkDelete(): void {
    const tickets = this.ticketsPendingBulkDelete();

    this.ticketsPendingBulkDelete.set([]);
    void this.runTicketBulk(() =>
      bulkDeleteTickets(
        tickets,
        (id) => firstValueFrom(this.ticketsService.deleteTicket(id)),
        (ticket) => this.ticketsFacade.applyTicketRemoved(ticket.id, ticket.clientId),
      ),
    );
  }

  private readonly updateTicket = (id: string, dto: UpdateTicketDto): Promise<TicketResponseDto> =>
    firstValueFrom(this.ticketsService.updateTicket(id, dto));
  private readonly upsertTicket = (ticket: TicketResponseDto): void => this.ticketsFacade.applyTicketUpsert(ticket);

  /**
   * Runs a bulk action of the tickets table (client fan-out over the single-ticket endpoints, see `ticket-table.ts`)
   * and shows the per-ticket result.
   */
  private async runTicketBulk(bulk: () => Promise<FpcBulkResult<TicketResponseDto>>): Promise<void> {
    this.bulkBusy.set(true);
    this.bulkResult.set(null);

    try {
      const result = await bulk();

      if (result.results.length === 0) {
        return;
      }

      this.bulkResult.set(agBulkSummary(result, (ticket) => ticket.title));
      this.selectedTicketIds.set(result.failed.concat(result.denied).map((ticket) => ticket.id));
    } finally {
      this.bulkBusy.set(false);
    }
  }

  onAutomationRunAction(run: TicketAutomationRunResponseDto, action: string): void {
    if (action === 'open') {
      this.openTicketAutomationRunDetailModal(run.id);
    } else if (action === 'cancel') {
      this.onCancelTicketAutomationRun(run);
    } else if (action === 'copy-id') {
      fpcCopyText(run.id);
    }
  }

  activityActionLabel(actionType: string): string {
    switch (actionType) {
      case 'CREATED':
        return $localize`:@@featureTicketsBoard-activityActionCreated:Created`;
      case 'DELETED':
        return $localize`:@@featureTicketsBoard-activityActionDeleted:Deleted`;
      case 'COMMENT_ADDED':
        return $localize`:@@featureTicketsBoard-activityActionCommentAdded:Comment added`;
      case 'STATUS_CHANGED':
        return $localize`:@@featureTicketsBoard-activityActionStatusChanged:Status changed`;
      case 'PRIORITY_CHANGED':
        return $localize`:@@featureTicketsBoard-activityActionPriorityChanged:Priority changed`;
      case 'WORKSPACE_MOVED':
        return $localize`:@@featureTicketsBoard-activityActionWorkspaceMoved:Workspace changed`;
      case 'PARENT_CHANGED':
        return $localize`:@@featureTicketsBoard-activityActionParentChanged:Parent changed`;
      case 'FIELD_UPDATED':
        return $localize`:@@featureTicketsBoard-activityActionFieldUpdated:Details updated`;
      case 'CONTENT_APPLIED_FROM_AI':
        return $localize`:@@featureTicketsBoard-activityActionContentAppliedFromAi:Description applied (AI)`;
      case 'BODY_GENERATION_STARTED':
        return $localize`:@@featureTicketsBoard-activityActionBodyGenerationStarted:AI description generation started`;
      case 'PROTOTYPE_PROMPT_GENERATED':
        return $localize`:@@featureTicketsBoard-activityActionPrototypePromptGenerated:Prototype prompt generated`;
      case 'AUTOMATION_CLAIMED':
        return $localize`:@@featureTicketsBoard-activityActionAutomationClaimed:Automation claimed`;
      case 'AUTOMATION_STARTED':
        return $localize`:@@featureTicketsBoard-activityActionAutomationStarted:Automation started`;
      case 'AUTOMATION_SUCCEEDED':
        return $localize`:@@featureTicketsBoard-activityActionAutomationSucceeded:Automation succeeded`;
      case 'AUTOMATION_FAILED':
        return $localize`:@@featureTicketsBoard-activityActionAutomationFailed:Automation failed`;
      case 'AUTOMATION_TIMED_OUT':
        return $localize`:@@featureTicketsBoard-activityActionAutomationTimedOut:Automation timed out`;
      case 'AUTOMATION_ESCALATED':
        return $localize`:@@featureTicketsBoard-activityActionAutomationEscalated:Automation escalated`;
      case 'AUTOMATION_REQUEUED':
        return $localize`:@@featureTicketsBoard-activityActionAutomationRequeued:Automation requeued`;
      case 'AUTOMATION_APPROVAL_INVALIDATED':
        return $localize`:@@featureTicketsBoard-activityActionAutomationApprovalInvalidated:Automation approval invalidated`;
      case 'AUTOMATION_CANCELLED':
        return $localize`:@@featureTicketsBoard-activityActionAutomationCancelled:Automation cancelled`;
      case 'AUTOMATION_APPROVED':
        return $localize`:@@featureTicketsBoard-activityActionAutomationApproved:Automation approved`;
      case 'AUTOMATION_UNAPPROVED':
        return $localize`:@@featureTicketsBoard-activityActionAutomationUnapproved:Automation approval revoked`;
      case 'AUTOMATION_ELIGIBILITY_CHANGED':
        return $localize`:@@featureTicketsBoard-activityActionAutomationEligibilityChanged:Automated runs eligibility changed`;
      case 'AUTOMATION_APPROVAL_REQUIREMENT_CHANGED':
        return $localize`:@@featureTicketsBoard-activityActionAutomationApprovalRequirementChanged:Automation approval requirement changed`;
      case 'AUTOMATION_SETTINGS_UPDATED':
        return $localize`:@@featureTicketsBoard-activityActionAutomationSettingsUpdated:Automation settings updated`;
      default:
        return $localize`:@@featureTicketsBoard-activityActionUnknown:Unknown activity`;
    }
  }

  /**
   * Semantic tint modifier for `fpc-badge variant="info"` chips.
   */
  activityActionBadgeTone(actionType: string): FpcBadgeTone {
    switch (actionType) {
      case 'CREATED':
        return 'success';
      case 'DELETED':
        return 'danger';
      case 'COMMENT_ADDED':
        return 'info';
      case 'STATUS_CHANGED':
        return 'primary';
      case 'PRIORITY_CHANGED':
        return 'warning';
      case 'WORKSPACE_MOVED':
      case 'PARENT_CHANGED':
      case 'FIELD_UPDATED':
      case 'AUTOMATION_ELIGIBILITY_CHANGED':
      case 'AUTOMATION_APPROVAL_REQUIREMENT_CHANGED':
      case 'AUTOMATION_SETTINGS_UPDATED':
        return 'neutral';
      case 'CONTENT_APPLIED_FROM_AI':
        return 'dark';
      case 'BODY_GENERATION_STARTED':
      case 'PROTOTYPE_PROMPT_GENERATED':
        return 'info';
      case 'AUTOMATION_SUCCEEDED':
      case 'AUTOMATION_APPROVED':
      case 'AUTOMATION_UNAPPROVED':
        return 'success';
      case 'AUTOMATION_FAILED':
      case 'AUTOMATION_TIMED_OUT':
      case 'AUTOMATION_ESCALATED':
      case 'AUTOMATION_CANCELLED':
      case 'AUTOMATION_APPROVAL_INVALIDATED':
        return 'danger';
      case 'AUTOMATION_CLAIMED':
      case 'AUTOMATION_STARTED':
      case 'AUTOMATION_REQUEUED':
        return 'primary';
      default:
        return 'neutral';
    }
  }

  /** Priority chip modifier (paired with `fpc-badge variant="info"`). */
  ticketPriorityBadgeTone(priority: TicketPriority): FpcBadgeTone {
    return ticketPriorityTone(priority);
  }

  /** Lane card click / Enter (a drag never activates it): open the detail. */
  onLaneRowActivate(row: TicketBoardRow): void {
    this.openTicketDetailFlow(row.ticket.id);
  }

  openTicketRelationsModal(): void {
    this.ticketRelationsSearchQuery.set('');
    this.ticketRelationsSuggestionsOpen.set(false);
    this.selectedTicketRelationTargets.set([]);
    this.refreshTicketRelationKnowledgeNodes();
    swapToOverlayAgentModal({
      underlyingOpen: this.ticketDetailModalOpen,
      overlayOpen: this.ticketRelationsModalOpen,
      swapState: this.ticketDetailOverlaySwapState,
    });
  }

  onCloseTicketRelationsModal(): void {
    hideAgentModal(this.ticketRelationsModalOpen);
    this.onTicketRelationsModalClosed();
  }

  onTicketRelationsModalClosed(): void {
    restoreUnderlyingAgentModal({
      underlyingOpen: this.ticketDetailModalOpen,
      swapState: this.ticketDetailOverlaySwapState,
    });
    this.ticketRelationsSearchQuery.set('');
    this.ticketRelationsSuggestionsOpen.set(false);
    this.selectedTicketRelationTargets.set([]);
  }

  /** Prefer flat list from `/knowledge`; fall back to flattening the store tree. */
  private ticketRelationKnowledgeNodesForSearch(): KnowledgeNodeDto[] {
    const flat = this.ticketRelationKnowledgeNodes();

    if (flat.length > 0) {
      return flat;
    }

    return this.flattenKnowledgeNodes(this.knowledgeTree());
  }

  private flattenKnowledgeNodes(nodes: KnowledgeNodeDto[]): KnowledgeNodeDto[] {
    const result: KnowledgeNodeDto[] = [];
    const walk = (list: KnowledgeNodeDto[]) => {
      for (const node of list) {
        result.push(node);
        walk(node.children ?? []);
      }
    };

    walk(nodes);

    return result;
  }

  private refreshTicketRelationKnowledgeNodes(): void {
    const clientId = this.effectiveClientId();

    if (!clientId) {
      this.ticketRelationKnowledgeNodes.set([]);

      return;
    }

    this.knowledgeFacade.loadTree(clientId);
    this.knowledgeService
      .listByClient(clientId)
      .pipe(
        take(1),
        catchError(() => of([] as KnowledgeNodeDto[])),
      )
      .subscribe((nodes) => this.ticketRelationKnowledgeNodes.set(nodes));
  }

  onTicketRelationInputChange(value: string): void {
    this.ticketRelationsSearchQuery.set(value);
    this.ticketRelationsSuggestionsOpen.set(value.trim().length > 0 && this.ticketRelationCandidates().length > 0);
  }

  onTicketRelationSuggestionsOpenChange(open: boolean): void {
    this.ticketRelationsSuggestionsOpen.set(
      open && this.ticketRelationsSearchQuery().trim().length > 0 && this.ticketRelationCandidates().length > 0,
    );
  }

  onPickTicketRelationCandidate(
    candidate: { kind: 'knowledge'; node: KnowledgeNodeDto } | { kind: 'ticket'; ticket: TicketResponseDto },
    event?: Event,
  ): void {
    event?.preventDefault();
    this.addTicketRelationCandidate(candidate);
    this.ticketRelationsSearchQuery.set('');
    this.ticketRelationsSuggestionsOpen.set(false);
  }

  onAddSelectedTicketRelations(): void {
    const detail = this.detail();
    const clientId = this.effectiveClientId();
    const targets = this.selectedTicketRelationTargets();

    if (!detail?.id || !clientId || !targets.length) {
      return;
    }

    for (const target of targets) {
      if (target.kind === this.RELATION_TARGET_KIND_TICKET) {
        this.knowledgeFacade.createRelation({
          clientId,
          sourceType: 'ticket',
          sourceId: detail.id,
          targetType: 'ticket',
          targetTicketSha: target.ticketLongSha,
        });

        continue;
      }

      this.knowledgeFacade.createRelation({
        clientId,
        sourceType: 'ticket',
        sourceId: detail.id,
        targetType: target.nodeType,
        targetNodeId: target.nodeId,
      });
    }

    this.onCloseTicketRelationsModal();
  }

  onRemoveTicketRelation(relation: KnowledgeRelationDto): void {
    this.knowledgeFacade.deleteRelation(relation.id);
  }

  ticketRelationNodeById(nodeId?: string | null): KnowledgeNodeDto | null {
    if (!nodeId) {
      return null;
    }

    const fromFlat = this.ticketRelationKnowledgeNodes().find((node) => node.id === nodeId);

    if (fromFlat) {
      return fromFlat;
    }

    const find = (nodes: KnowledgeNodeDto[]): KnowledgeNodeDto | null => {
      for (const node of nodes) {
        if (node.id === nodeId) {
          return node;
        }

        const child = find(node.children ?? []);

        if (child) {
          return child;
        }
      }

      return null;
    };

    return find(this.knowledgeTree());
  }

  ticketRelationTrackId(
    target:
      | { kind: 'knowledge'; nodeId: string; nodeType?: KnowledgeNodeType }
      | { kind: 'ticket'; ticketLongSha: string },
  ): string {
    return target.kind === this.RELATION_TARGET_KIND_KNOWLEDGE
      ? `knowledge:${target.nodeId}`
      : `ticket:${target.ticketLongSha}`;
  }

  ticketRelationChipDisplay(
    target:
      | { kind: 'knowledge'; nodeId: string; nodeType?: KnowledgeNodeType }
      | { kind: 'ticket'; ticketLongSha: string },
  ): string {
    if (target.kind === this.RELATION_TARGET_KIND_TICKET) {
      const ticket = this.ticketByLongSha(target.ticketLongSha);

      if (!ticket) {
        return `Ticket: Unavailable ticket (${target.ticketLongSha.slice(0, 7)})`;
      }

      return `Ticket: ${ticket.title ?? ''} (${ticket.shas.short})`;
    }

    const node = this.ticketRelationNodeById(target.nodeId);

    if (!node) {
      const type = target.nodeType === 'folder' ? 'Folder' : 'Page';

      return `${type}: Unavailable knowledge (${target.nodeId.slice(0, 7)})`;
    }

    const type = node.nodeType === 'folder' ? 'Folder' : 'Page';

    return `${type}: ${node.title} (${node.shas.short})`;
  }

  onRemovePendingTicketRelation(
    target:
      | { kind: 'knowledge'; nodeId: string; nodeType?: KnowledgeNodeType }
      | { kind: 'ticket'; ticketLongSha: string },
  ): void {
    const trackId = this.ticketRelationTrackId(target);

    this.selectedTicketRelationTargets.set(
      this.selectedTicketRelationTargets().filter((item) => this.ticketRelationTrackId(item) !== trackId),
    );
  }

  ticketRelationTicketShortSha(longSha?: string | null): string {
    if (!longSha) {
      return '';
    }

    const ticket = this.ticketByLongSha(longSha);

    if (!ticket?.shas?.short) {
      return longSha.slice(0, 7);
    }

    return ticket.shas.short;
  }

  ticketRelationTicketTitle(longSha?: string | null): string {
    if (!longSha) {
      return 'Unavailable ticket';
    }

    const ticket = this.ticketByLongSha(longSha);

    if (!ticket) {
      return 'Unavailable ticket';
    }

    return ticket.title ?? 'Untitled ticket';
  }

  onTicketRelationClick(relation: KnowledgeRelationDto): void {
    if (relation.targetType === 'ticket') {
      const longSha = relation.targetTicketLongSha ?? null;

      if (!longSha) {
        return;
      }

      const ticket = this.ticketByLongSha(longSha);

      if (!ticket) {
        return;
      }

      this.openTicketDetailFlow(ticket.id);

      return;
    }

    const clientId = this.effectiveClientId();
    const targetNodeId = relation.targetNodeId;

    if (!clientId || !targetNodeId) {
      return;
    }

    this.closeTicketModalStackForCrossRouteNavigation();
    setTimeout(() => {
      void this.router.navigate(['/knowledge', clientId], {
        queryParams: { openNodeId: targetNodeId },
      });
    }, 0);
  }

  /** Open detail modal for a ticket (board card, breadcrumb, or nested row). */
  openTicketDetailFlow(ticketId: string): void {
    if (this.detail()?.id === ticketId && this.ticketDetailModalOpen()) {
      return;
    }

    const generation = ++this.ticketDetailOpenGeneration;

    this.prototypeError.set(null);
    this.bodyGenError.set(null);
    this.newCommentText.set('');

    // Drop overlays without restoring the previous detail shell (relation/subtask navigation).
    this.ticketDetailOverlaySwapState.suspended = false;
    const closingOverlay =
      this.ticketRelationsModalOpen() ||
      this.ticketMigrateModalOpen() ||
      this.createTicketModalOpen() ||
      this.deleteTicketConfirmModalOpen() ||
      this.ticketAutomationRunModalOpen();
    hideAgentModal(this.ticketRelationsModalOpen);
    hideAgentModal(this.ticketMigrateModalOpen);
    hideAgentModal(this.createTicketModalOpen);
    hideAgentModal(this.deleteTicketConfirmModalOpen);
    hideAgentModal(this.ticketAutomationRunModalOpen);

    const wasOpen = this.ticketDetailModalOpen();

    if (wasOpen) {
      hideAgentModal(this.ticketDetailModalOpen);
    }

    const closeMs = wasOpen || closingOverlay ? AGENT_MODAL_TRANSITION_MS : 0;

    setTimeout(() => {
      if (generation !== this.ticketDetailOpenGeneration) {
        return;
      }

      const whenReady$ = this.detailLoading$.pipe(
        pairwise(),
        filter(([wasLoading, loading]) => wasLoading && !loading),
        take(1),
      );

      this.ticketsFacade.openDetail(ticketId);
      this.ticketAutomationFacade.loadConfig(ticketId);
      this.ticketAutomationFacade.loadRuns(ticketId);

      const clientId = this.effectiveClientId();

      if (clientId) {
        this.agentsFacade.loadClientAgents(clientId);
      }

      whenReady$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        if (generation !== this.ticketDetailOpenGeneration || this.detail()?.id !== ticketId) {
          return;
        }

        showAgentModal(this.ticketDetailModalOpen);
      });
    }, closeMs);
  }

  onBreadcrumbNavigate(ticketId: string): void {
    this.openTicketDetailFlow(ticketId);
  }

  onHierarchyBreadcrumbSelected(event: MouseEvent, ticketId: string): void {
    event.preventDefault();
    this.onBreadcrumbNavigate(ticketId);
  }

  /** Prefer stored ticket choice when still valid; else socket agent; else first chat-capable agent. */
  private pickChatAgentForTicket(
    detail: TicketResponseDto,
    chatAgents: AgentResponseDto[],
    socketAgentId: string | null,
  ): string | null {
    const ids = new Set(chatAgents.map((a) => a.id));
    const preferred = detail.preferredChatAgentId ?? null;

    if (preferred && ids.has(preferred)) {
      return preferred;
    }

    if (socketAgentId && ids.has(socketAgentId)) {
      return socketAgentId;
    }

    return chatAgents[0]?.id ?? null;
  }

  onPreferredChatAgentChange(ticket: TicketResponseDto, agentId: string | null): void {
    this.selectedAgentForAi.set(agentId);
    const current = ticket.preferredChatAgentId ?? null;

    if (agentId === current) {
      return;
    }

    this.ticketsFacade.update(ticket.id, { preferredChatAgentId: agentId });
  }

  onPreferredChatModelChange(ticket: TicketResponseDto, model: string | null): void {
    const next = model?.trim() ? model.trim() : null;

    this.selectedModelForAi.set(next);
    const current = ticket.preferredChatModel ?? null;

    if (next === current) {
      queueMicrotask(() => this.ensureChatModelInAutomationPreferredModel());

      return;
    }

    this.ticketsFacade.update(ticket.id, { preferredChatModel: next });
    queueMicrotask(() => this.ensureChatModelInAutomationPreferredModel());
  }

  onAutomationPreferredModelChange(model: string | null): void {
    const next = model?.trim() ? model.trim() : null;

    this.automationDraftPreferredModel.set(next);
  }

  /**
   * When chat has a model selected, keep automation preferredModel aligned so enabling automation
   * does not leave eligible=true without a model (OpenCode has no auto).
   */
  private ensureChatModelInAutomationPreferredModel(): void {
    const chatModel = this.selectedModelForAi();

    if (!chatModel) {
      return;
    }

    if (!this.automationDraftPreferredModel()) {
      this.automationDraftPreferredModel.set(chatModel);
    }
  }

  showCreateSubtaskModal(): void {
    const parentId = this.detail()?.id;

    if (!parentId) {
      return;
    }

    this.createTicketError.set(null);
    this.createTicketTitle.set('');
    this.createTicketContent.set('');
    this.createTicketStatus.set('draft');
    this.createTicketPriority.set('medium');
    this.createTicketCreationTemplate.set('empty');
    this.createTicketParentId.set(parentId);
    swapToOverlayAgentModal({
      underlyingOpen: this.ticketDetailModalOpen,
      overlayOpen: this.createTicketModalOpen,
      swapState: this.ticketDetailOverlaySwapState,
    });
  }

  onCloseModal(): void {
    this.detailTitleEditing.set(false);
    this.pendingDetailTitleRename.set(null);
    this.ticketDetailOverlaySwapState.suspended = false;
    hideAgentModal(this.ticketDetailModalOpen);
    hideAgentModal(this.ticketAutomationRunModalOpen);
    hideAgentModal(this.ticketRelationsModalOpen);
    hideAgentModal(this.ticketMigrateModalOpen);
    hideAgentModal(this.deleteTicketConfirmModalOpen);
    hideAgentModal(this.createTicketModalOpen);
    this.ticketPendingDelete.set(null);
    this.ticketsFacade.closeDetail();
    this.prototypeError.set(null);
    this.bodyGenError.set(null);
    this.pendingBodyCorrelation.set(null);
    this.bodyGenInProgress.set(false);
    this.activeGenerationId = null;
    this.ticketAutomationFacade.clear();
  }

  onDismissTicketAutomationError(): void {
    this.ticketAutomationFacade.clearError();
  }

  toggleTicketAutomationAccordion(): void {
    this.ticketAutomationAccordionExpanded.update((open) => !open);
  }

  private tryAutosaveTicketAutomationSettings(): void {
    const tid = this.detail()?.id;
    const cfg = this.ticketAutomationConfig();

    if (!tid || !cfg || cfg.ticketId !== tid) {
      return;
    }

    if (this.automationDraftSyncTicketId !== tid) {
      return;
    }

    if (this.ticketAutomationLoadingConfig()) {
      return;
    }

    const dto = this.buildTicketAutomationPatchDto();

    if (automationDtoMatchesServerConfig(dto, cfg)) {
      return;
    }

    if (this.ticketAutomationSaving()) {
      this.pendingAutomationAutosaveAfterBusy = true;

      return;
    }

    this.pendingAutomationAutosaveAfterBusy = false;
    this.ticketAutomationFacade.clearError();
    this.ticketAutomationFacade.patchConfig(tid, dto);
    const clientId = this.effectiveClientId();

    if (clientId) {
      setTimeout(() => this.ticketAutomationFacade.loadRuns(tid), 400);
    }
  }

  onApproveTicketAutomation(): void {
    const tid = this.detail()?.id;

    if (!tid) {
      return;
    }

    this.ticketAutomationFacade.clearError();
    this.ticketAutomationFacade.approve(tid);
  }

  onUnapproveTicketAutomation(): void {
    const tid = this.detail()?.id;

    if (!tid) {
      return;
    }

    this.ticketAutomationFacade.clearError();
    this.ticketAutomationFacade.unapprove(tid);
  }

  onRefreshTicketAutomationRuns(): void {
    const tid = this.detail()?.id;

    if (!tid) {
      return;
    }

    this.ticketAutomationFacade.loadRuns(tid);
  }

  /**
   * Polls until ticket detail matches `ticketId` (after {@link openTicketDetailFlow}), then opens the run modal.
   */
  private scheduleOpenAutomationRunWhenDetailReady(ticketId: string, runId: string, attempt = 0): void {
    if (attempt > 60) {
      return;
    }

    if (this.detail()?.id !== ticketId) {
      setTimeout(() => this.scheduleOpenAutomationRunWhenDetailReady(ticketId, runId, attempt + 1), 40);

      return;
    }

    this.openTicketAutomationRunDetailModal(runId);
  }

  openTicketAutomationRunDetailModal(runId: string): void {
    const tid = this.detail()?.id;

    if (!tid) {
      return;
    }

    this.ticketAutomationFacade.loadRunDetail(tid, runId);
    swapToOverlayAgentModal({
      underlyingOpen: this.ticketDetailModalOpen,
      overlayOpen: this.ticketAutomationRunModalOpen,
      swapState: this.ticketDetailOverlaySwapState,
    });
  }

  onCancelTicketAutomationRun(run: TicketAutomationRunResponseDto): void {
    const tid = this.detail()?.id;

    if (!tid || !this.ticketAutomationRunCanCancel(run)) {
      return;
    }

    this.ticketAutomationFacade.clearError();
    this.ticketAutomationFacade.cancelRun(tid, run.id);
  }

  addAutomationVerifierRow(): void {
    this.automationVerifierRows.update((rows) => [...rows, { cmd: '', cwd: '' }]);
  }

  removeAutomationVerifierRow(index: number): void {
    this.automationVerifierRows.update((rows) => {
      if (rows.length <= 1) {
        return [{ cmd: '', cwd: '' }];
      }

      return rows.filter((_, i) => i !== index);
    });
  }

  ticketAutomationRunCanCancel(run: TicketAutomationRunResponseDto): boolean {
    return run.status === 'pending' || run.status === 'running';
  }

  ticketAutomationRunStatusBadgeColor(status: TicketAutomationRunStatus): FpcBadgeColor {
    switch (status) {
      case 'succeeded':
        return 'success';
      case 'failed':
      case 'timed_out':
      case 'escalated':
        return 'danger';
      case 'running':
      case 'pending':
        return 'primary';
      case 'cancelled':
        return 'secondary';
      default:
        return 'secondary';
    }
  }

  automationRunStatusLabel(status: TicketAutomationRunStatus): string {
    return ticketAutomationRunStatusLabel(status);
  }

  automationRunPhaseLabel(phase: string): string {
    return ticketAutomationRunPhaseLabel(phase);
  }

  automationRunStepKindLabel(kind: string): string {
    return ticketAutomationRunStepKindLabel(kind);
  }

  automationFailureCodeLabel(code: string): string {
    return ticketAutomationFailureCodeLabel(code);
  }

  automationCancellationReasonLabel(reason: string): string {
    return ticketAutomationCancellationReasonLabel(reason);
  }

  formatAutomationJson(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  isAutomationContextEnvironmentLocalRepo(agent: AgentResponseDto): boolean {
    return isLocalGitRepository(agent, this.effectiveWorkspace()?.client?.config ?? null);
  }

  getAutomationContextEnvironmentGitLabel(agent: AgentResponseDto): string | null {
    return getGitRepositoryDisplayLabel(agent, this.effectiveWorkspace()?.client?.config ?? null);
  }

  /**
   * Parse git repository URL to `owner/repo`.
   */
  parseGitRepository(gitUrl: string | null | undefined): string | null {
    if (!gitUrl) {
      return null;
    }

    try {
      const trimmed = gitUrl.trim();

      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const url = new URL(trimmed);
        const pathParts = url.pathname.split('/').filter(Boolean);

        if (pathParts.length >= 2) {
          const owner = pathParts[0];
          const repo = pathParts[1].replace(/\.git$/, '');

          return `${owner}/${repo}`;
        }
      }

      const sshMatch = trimmed.match(/^[^@]+@[^:]+:([^/]+)\/(.+)$/);

      if (sshMatch && sshMatch[1] && sshMatch[2]) {
        const owner = sshMatch[1];
        const repo = sshMatch[2].replace(/\.git$/, '');

        return `${owner}/${repo}`;
      }
    } catch {
      // ignore parse errors and keep label fallback
    }

    return null;
  }

  private buildTicketAutomationPatchDto(): UpdateTicketAutomationDto {
    const commands = this.automationVerifierRows()
      .map((r) => ({
        cmd: r.cmd.trim(),
        cwd: r.cwd.trim().length > 0 ? r.cwd.trim() : undefined,
      }))
      .filter((r) => r.cmd.length > 0);
    const branch = this.automationDraftDefaultBranch().trim();

    return {
      eligible: this.automationDraftEligible(),
      requiresApproval: this.automationDraftRequiresApproval(),
      allowedAgentIds: this.automationDraftAllowedAgentIds(),
      preferredModel: this.automationDraftPreferredModel(),
      includeWorkspaceContext: this.automationDraftIncludeWorkspaceContext(),
      autoEnrichmentEnabled: this.automationDraftAutoEnrichmentEnabled(),
      contextEnvironmentIds: this.automationDraftContextEnvironmentIds(),
      defaultBranchOverride: branch.length > 0 ? branch : null,
      automationBranchStrategy: this.automationDraftBranchStrategy(),
      forceNewAutomationBranchNextRun: this.automationDraftForceNewBranchNextRun(),
      verifierProfile: { commands },
    };
  }

  isAutomationContextEnvironmentSelected(agentId: string): boolean {
    return this.automationDraftContextEnvironmentIds().includes(agentId);
  }

  /**
   * Mirrors allowlist locking: when context environments include the same agent as "Agent for chat / AI",
   * that row stays checked and cannot be cleared until chat selection changes.
   */
  isAutomationContextEnvironmentLockedToChat(agentId: string): boolean {
    const chatId = this.selectedAgentForAi();

    if (!chatId || chatId !== agentId) {
      return false;
    }

    return this.isAutomationContextEnvironmentSelected(agentId);
  }

  isAutomationAgentAllowed(agentId: string): boolean {
    return this.automationDraftAllowedAgentIds().includes(agentId);
  }

  /**
   * When the allowlist includes the same agent as "Agent for chat / AI", that row stays checked and cannot be cleared
   * until the chat selection changes.
   */
  isAutomationAllowedAgentLockedToChat(agentId: string): boolean {
    const chatId = this.selectedAgentForAi();

    if (!chatId || chatId !== agentId) {
      return false;
    }

    return this.isAutomationAgentAllowed(agentId);
  }

  readonly ticketAutomationChatAgentLockTitle = $localize`:@@featureTicketsBoard-automationChatAgentLockTitle:Matches Environment for chat / AI. Change the chat environment to allow unchecking.`;

  onAutomationBranchStrategyChange(strategy: TicketAutomationBranchStrategy): void {
    this.automationDraftBranchStrategy.set(strategy);

    if (strategy === 'new_per_run') {
      this.automationDraftForceNewBranchNextRun.set(false);
    }
  }

  onAutomationAllowedAgentToggle(agentId: string, checked: boolean): void {
    if (!checked && this.isAutomationAllowedAgentLockedToChat(agentId)) {
      return;
    }

    this.automationDraftAllowedAgentIds.update((ids) => {
      const next = new Set(ids);

      if (checked) {
        next.add(agentId);
      } else {
        next.delete(agentId);
      }

      return [...next].sort();
    });
    queueMicrotask(() => this.ensureChatAgentInAutomationAllowedList());
  }

  onAutomationContextEnvironmentToggle(agentId: string, checked: boolean): void {
    if (!checked && this.isAutomationContextEnvironmentLockedToChat(agentId)) {
      return;
    }

    this.automationDraftContextEnvironmentIds.update((ids) => {
      const next = new Set(ids);

      if (checked) {
        next.add(agentId);
      } else {
        next.delete(agentId);
      }

      return [...next].sort();
    });
    queueMicrotask(() => this.ensureChatAgentInAutomationContextEnvironmentList());
  }

  /**
   * Ensures the "Agent for chat / AI" agent is checked in the automation allowlist when that agent appears in the
   * allowed-agents checkbox list (prototype autonomy enabled). Runs regardless of ticket automation `eligible`.
   * Adding the chat agent when the server had an empty list narrows meaning to that agent on the next autosave.
   */
  private ensureChatAgentInAutomationAllowedList(): void {
    const tid = this.detail()?.id;

    if (!tid || this.automationDraftSyncTicketId !== tid) {
      return;
    }

    const chatId = this.selectedAgentForAi();

    if (!chatId) {
      return;
    }

    if (!this.automationTicketAutomationAgentChoices().some((a) => a.id === chatId)) {
      return;
    }

    this.automationDraftAllowedAgentIds.update((ids) => {
      if (ids.includes(chatId)) {
        return ids;
      }

      return normalizeAllowedAgentIdList([...ids, chatId]);
    });
  }

  /**
   * Ensures the "Agent for chat / AI" agent is checked in context enrichment environments when it exists
   * in the current workspace agent choices.
   */
  private ensureChatAgentInAutomationContextEnvironmentList(): void {
    const tid = this.detail()?.id;

    if (!tid || this.automationDraftSyncTicketId !== tid) {
      return;
    }

    const chatId = this.selectedAgentForAi();

    if (!chatId) {
      return;
    }

    if (!this.automationAgentChoices().some((a) => a.id === chatId)) {
      return;
    }

    this.automationDraftContextEnvironmentIds.update((ids) => {
      if (ids.includes(chatId)) {
        return ids;
      }

      return normalizeAllowedAgentIdList([...ids, chatId]);
    });
  }

  onCloseTicketAutomationRunModal(): void {
    hideAgentModal(this.ticketAutomationRunModalOpen);
    this.onTicketAutomationRunModalClosed();
  }

  onTicketAutomationRunModalClosed(): void {
    restoreUnderlyingAgentModal({
      underlyingOpen: this.ticketDetailModalOpen,
      swapState: this.ticketDetailOverlaySwapState,
    });
  }

  openTicketMigrationModal(): void {
    const choices = this.migrationTargetChoices();

    if (choices.length === 0) {
      return;
    }

    this.ticketsFacade.clearError();
    this.migrationTargetClientId.set(choices[0]?.id ?? '');
    swapToOverlayAgentModal({
      underlyingOpen: this.ticketDetailModalOpen,
      overlayOpen: this.ticketMigrateModalOpen,
      swapState: this.ticketDetailOverlaySwapState,
    });
  }

  onCancelTicketMigrationModal(): void {
    hideAgentModal(this.ticketMigrateModalOpen);
    this.onTicketMigrateModalClosed();
  }

  onTicketMigrateModalClosed(): void {
    restoreUnderlyingAgentModal({
      underlyingOpen: this.ticketDetailModalOpen,
      swapState: this.ticketDetailOverlaySwapState,
    });
  }

  onConfirmTicketMigration(): void {
    const d = this.detail();
    const targetId = this.migrationTargetClientId().trim();

    if (!d || !targetId) {
      return;
    }

    this.ticketsFacade.migrateTicket(d.id, targetId);
  }

  private addTicketRelationCandidate(
    candidate: { kind: 'knowledge'; node: KnowledgeNodeDto } | { kind: 'ticket'; ticket: TicketResponseDto },
  ): void {
    const current = this.selectedTicketRelationTargets();
    const nextTarget =
      candidate.kind === this.RELATION_TARGET_KIND_KNOWLEDGE
        ? ({
            kind: this.RELATION_TARGET_KIND_KNOWLEDGE,
            nodeId: candidate.node.id,
            nodeType: candidate.node.nodeType,
          } as const)
        : ({ kind: this.RELATION_TARGET_KIND_TICKET, ticketLongSha: candidate.ticket.shas.long } as const);
    const nextTargetId = this.ticketRelationTrackId(nextTarget);

    if (!current.some((item) => this.ticketRelationTrackId(item) === nextTargetId)) {
      this.selectedTicketRelationTargets.set([...current, nextTarget]);
    }
  }

  private ticketByLongSha(longSha: string): TicketResponseDto | null {
    return this.ticketsList().find((ticket) => ticket.shas?.long === longSha) ?? null;
  }

  private closeTicketModalStackForCrossRouteNavigation(): void {
    this.ticketDetailOverlaySwapState.suspended = false;
    hideAgentModal(this.ticketRelationsModalOpen);
    hideAgentModal(this.ticketDetailModalOpen);
    hideAgentModal(this.ticketAutomationRunModalOpen);
    hideAgentModal(this.ticketMigrateModalOpen);
    hideAgentModal(this.createTicketModalOpen);
    hideAgentModal(this.deleteTicketConfirmModalOpen);
    this.ticketPendingDelete.set(null);
    this.ticketsFacade.closeDetail();
    this.ticketAutomationFacade.clear();
  }

  effectiveWorkspaceTitle(ew: { id: string; client: ClientResponseDto | null }): string {
    return resolveNamedDisplayLabel(ew.client?.name);
  }

  relationKnowledgeTitle(title: string | null | undefined): string {
    return resolveNamedDisplayLabel(title);
  }

  openWorkspaceSwitchModal(): void {
    this.workspaceSwitchSearch.set('');
    this.clientsFacade.loadClients();
    queueMicrotask(() => showAgentModal(this.workspaceSwitchModalOpen));
  }

  onCloseWorkspaceSwitchModal(): void {
    hideAgentModal(this.workspaceSwitchModalOpen);
  }

  goToSpaces(event?: Event): void {
    event?.preventDefault();
    hideAgentModal(this.workspaceSwitchModalOpen);
    void this.router.navigate(['/clients']);
  }

  onSelectWorkspaceForTickets(client: ClientResponseDto): void {
    if (client.id === this.effectiveClientId()) {
      hideAgentModal(this.workspaceSwitchModalOpen);

      return;
    }

    hideAgentModal(this.workspaceSwitchModalOpen);
    this.ticketDetailOverlaySwapState.suspended = false;
    hideAgentModal(this.ticketDetailModalOpen);
    hideAgentModal(this.ticketAutomationRunModalOpen);
    hideAgentModal(this.ticketMigrateModalOpen);
    hideAgentModal(this.createTicketModalOpen);
    hideAgentModal(this.deleteTicketConfirmModalOpen);
    this.ticketPendingDelete.set(null);
    this.ticketsFacade.closeDetail();
    this.ticketAutomationFacade.clear();
    this.clientsFacade.setActiveClient(client.id);
    const parent = this.route.parent;

    if (parent) {
      void this.router.navigate(['tickets', client.id], { relativeTo: parent });
    } else {
      void this.router.navigate(['/tickets', client.id]);
    }
  }

  onRequestDeleteTicket(ticket: TicketResponseDto): void {
    this.releaseExternalSyncMarkerOnTicketDelete.set(false);
    this.ticketPendingDelete.set({ id: ticket.id, title: ticket.title });
    this.openDeleteTicketConfirmFlow();
  }

  private openDeleteTicketConfirmFlow(): void {
    swapToOverlayAgentModal({
      underlyingOpen: this.ticketDetailModalOpen,
      overlayOpen: this.deleteTicketConfirmModalOpen,
      swapState: this.ticketDetailOverlaySwapState,
    });
  }

  onCancelDeleteTicketConfirm(): void {
    this.ticketPendingDelete.set(null);
    this.releaseExternalSyncMarkerOnTicketDelete.set(false);
    restoreUnderlyingAgentModal({
      underlyingOpen: this.ticketDetailModalOpen,
      swapState: this.ticketDetailOverlaySwapState,
    });
  }

  onConfirmDeleteTicket(): void {
    const pending = this.ticketPendingDelete();

    if (!pending) {
      return;
    }

    const { id } = pending;
    const releaseMarker = this.releaseExternalSyncMarkerOnTicketDelete();

    this.ticketDetailOverlaySwapState.suspended = false;
    hideAgentModal(this.deleteTicketConfirmModalOpen);
    this.ticketPendingDelete.set(null);
    this.releaseExternalSyncMarkerOnTicketDelete.set(false);
    this.ticketsFacade.remove(id, releaseMarker);
    merge(
      this.actions$.pipe(
        ofType(deleteTicketSuccess),
        filter((a) => a.id === id),
        map(() => 'success' as const),
      ),
      this.actions$.pipe(
        ofType(deleteTicketFailure),
        map(() => 'failure' as const),
      ),
    )
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((outcome) => {
        if (outcome === 'success') {
          this.onCloseModal();
        } else {
          queueMicrotask(() => showAgentModal(this.ticketDetailModalOpen));
        }
      });
  }

  onUpdateTicketField(id: string, field: 'status' | 'priority', value: TicketStatus | TicketPriority): void {
    if (field === 'status') {
      this.ticketsFacade.update(id, { status: value as TicketStatus });
    } else {
      this.ticketsFacade.update(id, { priority: value as TicketPriority });
    }
  }

  onDetailStatusModelChange(ticketId: string, value: TicketStatus): void {
    this.onUpdateTicketField(ticketId, 'status', value);
  }

  onDetailPriorityModelChange(ticketId: string, value: TicketPriority): void {
    this.onUpdateTicketField(ticketId, 'priority', value);
  }

  onDetailTitleClick(ticket: TicketResponseDto): void {
    this.detailTitleDraft.set(ticket.title);
    this.detailTitleEditing.set(true);
    afterNextRender(
      () => {
        this.detailTitleInputRef()?.nativeElement?.querySelector<HTMLInputElement>('input')?.focus();
      },
      { injector: this.injector },
    );
  }

  onDetailTitleBlur(): void {
    const d = this.detail();

    if (!d || !this.detailTitleEditing()) {
      return;
    }

    const trimmed = this.detailTitleDraft().trim();
    const current = d.title.trim();

    if (trimmed === current) {
      this.detailTitleEditing.set(false);

      return;
    }

    if (!trimmed.length) {
      this.detailTitleDraft.set(d.title);
      this.detailTitleEditing.set(false);

      return;
    }

    this.pendingDetailTitleRename.set({ ticketId: d.id, sentTitle: trimmed });
    this.ticketsFacade.update(d.id, { title: trimmed });
  }

  /** Persists description when the editor loses focus (if it changed). */
  onDescriptionDraftCommit(): void {
    const d = this.detail();

    if (!d) {
      return;
    }

    const draft = this.descriptionDraft();
    const current = d.content ?? '';

    if (draft === current) {
      return;
    }

    this.ticketsFacade.update(d.id, { content: draft });
  }

  onTicketAttachmentSelected(event: Event, ticket: TicketResponseDto): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);

    if (files.length === 0) {
      return;
    }

    for (const file of files) {
      this.ticketsService
        .uploadAttachment(ticket.id, file)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: (attachment) => this.ticketsFacade.addAttachment(ticket.id, attachment) });
    }

    input.value = '';
  }

  downloadTicketAttachment(attachment: AttachmentResponseDto): void {
    this.ticketsService
      .downloadAttachment(attachment)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => this.saveBlob(blob, attachment.fileName));
  }

  deleteTicketAttachment(ticket: TicketResponseDto, attachment: AttachmentResponseDto): void {
    this.ticketsService
      .deleteAttachment(ticket.id, attachment.id)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.ticketsFacade.removeAttachment(ticket.id, attachment.id));
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /** A lane card dropped on another lane: same status update as before (the facade updates the store). */
  onLaneRowDrop(event: FpcTableRowDropEvent<TicketBoardRow>): void {
    const status = event.toData as BoardLaneStatus;
    const ticket = event.row.ticket;

    if (!(BOARD_LANE_STATUSES as readonly string[]).includes(status) || ticket.status === status) {
      return;
    }

    this.ticketsFacade.update(ticket.id, { status });
  }

  showCreateTicketModal(): void {
    this.createTicketError.set(null);
    this.createTicketTitle.set('');
    this.createTicketContent.set('');
    this.createTicketStatus.set('draft');
    this.createTicketPriority.set('medium');
    this.createTicketCreationTemplate.set('empty');
    this.createTicketParentId.set(null);
    queueMicrotask(() => showAgentModal(this.createTicketModalOpen));
  }

  onCloseCreateTicketModal(): void {
    hideAgentModal(this.createTicketModalOpen);
    this.onCreateTicketModalClosed();
  }

  onCreateTicketModalClosed(): void {
    restoreUnderlyingAgentModal({
      underlyingOpen: this.ticketDetailModalOpen,
      swapState: this.ticketDetailOverlaySwapState,
    });
    this.createTicketError.set(null);
    this.createTicketParentId.set(null);
  }

  onSubmitCreateTicket(): void {
    const clientId = this.effectiveClientId();
    const title = this.createTicketTitle().trim();

    this.createTicketError.set(null);

    if (!clientId) {
      this.createTicketError.set(
        $localize`:@@featureTicketsBoard-createNeedClient:Select a space before creating a ticket.`,
      );

      return;
    }

    if (!title) {
      this.createTicketError.set($localize`:@@featureTicketsBoard-createNeedTitle:Title is required.`);

      return;
    }

    const content = this.createTicketContent().trim();
    const parentId = this.createTicketParentId();

    if (parentId) {
      this.ticketsFacade.create({
        parentId,
        title,
        ...(content ? { content } : {}),
        status: this.createTicketStatus(),
        priority: this.createTicketPriority(),
      });
    } else {
      const creationTemplate = this.createTicketCreationTemplate();

      this.ticketsFacade.create({
        clientId,
        title,
        ...(content ? { content } : {}),
        status: this.createTicketStatus(),
        priority: this.createTicketPriority(),
        ...(creationTemplate === 'specification' ? { creationTemplate: 'specification' } : {}),
      });
    }

    hideAgentModal(this.createTicketModalOpen);
    this.onCreateTicketModalClosed();
  }

  onSubmitComment(): void {
    const ticketId = this.detail()?.id;
    const body = this.newCommentText().trim();

    if (!ticketId || !body) {
      return;
    }

    this.ticketsFacade.addComment(ticketId, body);
    this.newCommentText.set('');
  }

  onPrototypeInChat(): void {
    const ticketId = this.detail()?.id;
    const agentId = this.selectedAgentForAi();
    const clientId = this.effectiveClientId();

    this.prototypeError.set(null);

    if (!ticketId || !agentId || !clientId) {
      this.prototypeError.set($localize`:@@featureTicketsBoard-prototypeNeedAgent:Select an environment for chat.`);

      return;
    }

    this.ticketsService.getPrototypePrompt(ticketId).subscribe({
      next: ({ prompt }) => {
        const ticketAutomation = this.ticketAutomationConfig();
        const shouldApplyAutomationContext =
          !!ticketAutomation && ticketAutomation.ticketId === ticketId && ticketAutomation.eligible === true;

        storeAgentConsoleChatDraft(prompt, {
          ...(shouldApplyAutomationContext
            ? {
                contextInjection: {
                  includeWorkspaceContext: ticketAutomation.includeWorkspaceContext !== false,
                  autoEnrichmentEnabled: ticketAutomation.autoEnrichmentEnabled !== false,
                  selectedEnvironmentContextIds: normalizeAllowedAgentIdList(ticketAutomation.contextEnvironmentIds),
                },
              }
            : {}),
        });
        this.ticketDetailOverlaySwapState.suspended = false;
        hideAgentModal(this.ticketDetailModalOpen);
        hideAgentModal(this.ticketAutomationRunModalOpen);
        hideAgentModal(this.ticketMigrateModalOpen);
        hideAgentModal(this.deleteTicketConfirmModalOpen);
        this.ticketsFacade.closeDetail();
        this.ticketAutomationFacade.clear();
        void this.router.navigate(['/clients', clientId, 'agents', agentId]);
      },
      error: (err: unknown) => {
        this.prototypeError.set(this.httpErrorMessage(err));
      },
    });
  }

  onGenerateBody(): void {
    const d = this.detail();
    const agentId = this.selectedAgentForAi();
    const clientId = this.effectiveClientId();

    this.bodyGenError.set(null);

    if (!d || !agentId || !clientId) {
      this.bodyGenError.set(
        $localize`:@@featureTicketsBoard-bodyGenNeedAgent:Select an environment and ensure a ticket is open.`,
      );

      return;
    }

    if (this.bodyGenInProgress()) {
      return;
    }

    this.bodyGenInProgress.set(true);
    this.ticketsService.startBodyGenerationSession(d.id, agentId).subscribe({
      next: ({ generationId, activity }) => {
        this.ticketsFacade.prependDetailActivity(activity);
        this.activeGenerationId = generationId;
        const correlationId =
          typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

        this.pendingBodyCorrelation.set(correlationId);
        this.ensureSocketAndClient(clientId)
          .pipe(
            tap(() => {
              const hierarchyContext = buildTicketBodyHierarchyContext(d, this.detailBreadcrumb());

              this.socketsFacade.forwardGenerateTicketBody(
                d.title,
                agentId,
                correlationId,
                this.selectedModelForAi() ?? undefined,
                hierarchyContext || undefined,
              );
            }),
            catchError((err: unknown) => {
              this.bodyGenInProgress.set(false);
              this.pendingBodyCorrelation.set(null);
              this.activeGenerationId = null;
              this.bodyGenError.set(this.httpErrorMessage(err));

              return of(undefined);
            }),
          )
          .subscribe();
      },
      error: (err: unknown) => {
        this.bodyGenInProgress.set(false);
        this.bodyGenError.set(this.httpErrorMessage(err));
      },
    });
  }

  private ensureSocketAndClient(clientId: string): Observable<void> {
    return this.socketsFacade.connected$.pipe(
      take(1),
      switchMap((connected) => {
        if (connected) {
          this.socketsFacade.setClient(clientId);

          return this.socketsFacade.selectedClientId$.pipe(
            filter((id) => id === clientId),
            take(1),
            map(() => undefined),
          );
        }

        this.socketsFacade.connect();

        return this.socketsFacade.connected$.pipe(
          filter(Boolean),
          take(1),
          tap(() => this.socketsFacade.setClient(clientId)),
          switchMap(() =>
            this.socketsFacade.selectedClientId$.pipe(
              filter((id) => id === clientId),
              take(1),
            ),
          ),
          map(() => undefined),
        );
      }),
    );
  }

  private httpErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      return (err.error as { message?: string })?.message ?? err.message ?? String(err.status);
    }

    if (err instanceof Error) {
      return err.message;
    }

    return $localize`:@@featureTicketsBoard-requestFailed:Request failed`;
  }

  /**
   * Reopens the ticket detail modal after the list load for `clientId` finishes (used after workspace migrate so
   * the board matches the target workspace before the modal body renders). Subscribes before dispatching load.
   */
  private showTicketDetailModalAfterTicketListLoadForClient(
    clientId: string,
    reopenTicketIdIfDetailMissing: string | null,
  ): void {
    this.actions$
      .pipe(
        ofType(loadTickets),
        filter((a) => (a.params?.clientId ?? '') === clientId),
        switchMap(() =>
          merge(
            this.actions$.pipe(ofType(loadTicketsSuccess), take(1)),
            this.actions$.pipe(ofType(loadTicketsFailure), take(1)),
          ),
        ),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() =>
        queueMicrotask(() => {
          if (reopenTicketIdIfDetailMissing && !this.detail()) {
            this.ticketsFacade.openDetail(reopenTicketIdIfDetailMissing);
          }

          showAgentModal(this.ticketDetailModalOpen);
        }),
      );
  }
}
