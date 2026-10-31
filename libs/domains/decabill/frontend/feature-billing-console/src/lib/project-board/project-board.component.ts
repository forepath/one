import { CommonModule } from '@angular/common';
import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  Injector,
  Input,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  BOARD_LANE_STATUSES,
  ProjectMilestonesFacade,
  ProjectTicketsFacade,
  ProjectTicketsService,
  ProjectTimeEntriesFacade,
  createProjectTicketSuccess,
  type BoardLaneStatus,
  type CreateProjectTicketDto,
  type ProjectMilestoneResponse,
  type ProjectTicketAttachmentResponse,
  type ProjectTicketBoardRow,
  type ProjectTicketPriority,
  type ProjectTicketResponse,
  type ProjectTicketStatus,
  type ProjectTimeEntryResponse,
  type ProjectTicketActivityResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
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
  FpcDropdownComponent,
  FpcDropdownItemComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcLabelComponent,
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcListToolbarComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcProgressComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  fpcCopyText,
  fpcListQueryState,
  type FpcBulkResult,
  type FpcFilterChip,
  type FpcMenuItem,
  type FpcTableColumn,
  type FpcTableRowDropEvent,
  type FpcTableSort,
  type FpcBadgeTone,
  FpcSectionRowComponent,
  FpcSectionColumnComponent,
  FpcDatePipe,
} from '@forepath/shared/frontend/ui-components';
import { Actions, ofType } from '@ngrx/effects';
import { filter, firstValueFrom, pairwise, take } from 'rxjs';

import {
  BILLING_MODAL_TRANSITION_MS,
  hideBillingModal,
  restoreUnderlyingBillingModal,
  showBillingModal,
  swapToOverlayBillingModal,
  watchBillingMutationModalClose,
  type BillingModalSwapState,
} from '../billing-modal';
import { formatBillingClockRange } from '../billing-format';
import { getUnavailableLabel, isProjectTimeEntryBilled } from '../billing-status-labels';
import {
  projectTicketActivityActionBadgeTone,
  projectTicketActivityActionLabel,
} from '../project-ticket-activity-labels';
import { ProjectMilestoneSelectComponent } from '../project-milestone-select/project-milestone-select.component';
import { ProjectTicketEditorComponent } from '../project-ticket-editor/project-ticket-editor.component';
import { projectTicketLaneStatusLabel } from '../project-ticket-lane-status-label';
import {
  dbBulkSummary,
  dbCopyIdItem,
  dbOpenItem,
  DB_DL_CANCEL,
  DB_DL_DELETE,
  type DbBulkResult,
} from '../shared/data-list';
import { timeEntryBillingState } from '../shared/table-states';
import {
  bulkDeleteProjectTickets,
  bulkUpdateProjectTickets,
  buildProjectTicketTableRows,
  filterProjectTicketLaneRows,
  PROJECT_TICKET_STATUSES,
  projectTicketEditable,
  projectTicketHiddenMatchCount,
  projectTicketHiddenMatchLabel,
  projectTicketPriorityLabel,
  projectTicketPriorityTone,
  projectTicketStatusFilterLabel,
  projectTicketStatusState,
  projectTicketStatusTone,
  projectTicketTableColumns,
  type ProjectTicketStatusFilter,
} from './project-board-table';
import { projectBoardViewState, type ProjectBoardView } from './project-board-view';

const ALL_TICKET_STATUSES: ProjectTicketStatus[] = ['draft', 'todo', 'in_progress', 'prototype', 'done', 'closed'];

const PRIORITY_OPTIONS: ProjectTicketPriority[] = ['low', 'medium', 'high', 'critical'];

interface ProjectTicketDetailSubtaskRow {
  ticket: ProjectTicketResponse;
  depth: number;
}

@Component({
  selector: 'framework-project-board',
  standalone: true,
  imports: [
    FpcDatePipe,
    FpcSectionRowComponent,
    FpcSectionColumnComponent,
    CommonModule,
    FormsModule,
    ProjectMilestoneSelectComponent,
    ProjectTicketEditorComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcBoardLaneComponent,
    FpcBreadcrumbItemComponent,
    FpcBreadcrumbsComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcDropdownComponent,
    FpcDropdownItemComponent,
    FpcEmptyStateComponent,
    FpcTableCellDirective,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcLabelComponent,
    FpcLaneHeaderComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcListToolbarComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcProgressComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
  ],
  templateUrl: './project-board.component.html',
  styleUrls: ['./project-board.component.scss'],
})
export class ProjectBoardComponent implements OnInit {
  readonly pageTitle = $localize`:@@featureProjectBoard-title:Board`;
  readonly copyFullShaLabel = $localize`:@@featureProjectBoard-copyFullSha:Copy full hash`;

  copyText(value: string): void {
    fpcCopyText(value);
  }
  readonly commentInputAriaLabel = $localize`:@@featureProjectBoard-commentPlaceholder:Add a comment...`;
  readonly laneSearchPlaceholder = $localize`:@@featureProjectBoard-searchLanePlaceholder:Search tickets`;
  readonly laneSearchAriaLabel = $localize`:@@featureProjectBoard-searchLaneLabel:Search tickets`;
  readonly addTitle = $localize`:@@featureProjectBoard-add:Add`;
  readonly viewSwitchLabel = $localize`:@@featureProjectBoard-viewSwitch:View`;
  readonly tableViewLabel = $localize`:@@featureProjectBoard-viewTable:Table view`;
  readonly lanesViewLabel = $localize`:@@featureProjectBoard-viewLanes:Lanes view`;
  readonly statusFilterLabel = $localize`:@@featureProjectBoard-filterStatus:Status`;
  readonly priorityFilterLabel = $localize`:@@featureProjectBoard-filterPriority:Priority`;
  readonly bulkStatusLabel = $localize`:@@featureProjectBoard-bulkStatus:Set status…`;
  readonly bulkPriorityLabel = $localize`:@@featureProjectBoard-bulkPriority:Set priority…`;
  readonly bulkDeleteTitle = $localize`:@@featureProjectBoard-bulkDeleteTitle:Delete tickets`;
  readonly moveToHeading = $localize`:@@featureProjectBoard-moveTo:Move to`;
  readonly deleteLabel = DB_DL_DELETE;
  readonly cancelLabel = DB_DL_CANCEL;

  @Input({ required: true }) projectId!: string;
  @Input() isAdmin = false;

  private readonly detailTitleInputRef = viewChild<ElementRef<HTMLInputElement>>('detailTitleInput');

  readonly detailModalOpen = signal(false);
  readonly createModalOpen = signal(false);
  readonly createTimeModalOpen = signal(false);
  readonly deleteTicketConfirmModalOpen = signal(false);
  private readonly ticketsFacade = inject(ProjectTicketsFacade);
  private readonly ticketsService = inject(ProjectTicketsService);
  private readonly milestonesFacade = inject(ProjectMilestonesFacade);
  private readonly timeEntriesFacade = inject(ProjectTimeEntriesFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly actions$ = inject(Actions);

  /** Lanes: one stacked `fpc-data-table` per lane; rows drag between the lanes of this group. */
  readonly laneDropGroup = 'decabill-project-board-lanes';
  /** Lanes render every ticket (variable-height cards; drag and drop is off in the table's virtual mode). */
  readonly laneVirtualThreshold = Number.MAX_SAFE_INTEGER;
  readonly lanes = BOARD_LANE_STATUSES;
  readonly statusOptions = ALL_TICKET_STATUSES;
  readonly priorityOptions = PRIORITY_OPTIONS;
  readonly selectedLane = signal<BoardLaneStatus>('todo');
  readonly activityOccurredAtFormat = 'MMM d, y, h:mm a';

  readonly createParentId = signal<string | null>(null);
  readonly descriptionDraft = signal('');
  readonly commentBody = signal('');
  readonly detailTitleEditing = signal(false);
  readonly detailTitleDraft = signal('');

  readonly ticketPendingDelete = signal<{ id: string; title: string } | null>(null);

  private lastDetailIdForDraft: string | null = null;
  private detailTitleEditSyncDetailId: string | null = null;
  private readonly detailModalSwap: BillingModalSwapState = { suspended: false };
  /** Bumps on each {@link openTicketDetailFlow} so stale load completions cannot reopen the modal. */
  private ticketDetailOpenGeneration = 0;

  /** Admins move unlocked tickets (drag and drop, ⋮ Move to); locked or non-admin cards stay put. */
  isTicketDraggable(ticket: ProjectTicketResponse): boolean {
    return this.isAdmin && !ticket.locked;
  }

  /** Lane cards (bound as `isAdmin ? laneRowDraggable : false`, so a role change re-renders the cards). */
  readonly laneRowDraggable = (row: ProjectTicketBoardRow): boolean => this.isTicketDraggable(row.ticket);

  readonly ticketsBoardRowsByStatus$ = this.ticketsFacade.boardRowsByStatus$;
  readonly ticketsList = toSignal(this.ticketsFacade.tickets$, { initialValue: [] as ProjectTicketResponse[] });

  /** Table | Lanes (URL `view=`, then localStorage, default table). */
  private readonly boardView = projectBoardViewState();
  readonly view = this.boardView.view;

  // Board table (client paging; the list API returns the project's tickets at once).
  readonly ticketStatusFilterOptions: readonly ProjectTicketStatusFilter[] = [
    'board',
    'all',
    ...PROJECT_TICKET_STATUSES,
  ];
  readonly ticketColumns = projectTicketTableColumns((milestoneId) => this.milestoneLabel(milestoneId));
  /** Lane cards: State (icon) · Ticket (short hash + title, lock) / Priority · Subtasks (priority-1 lines). */
  readonly laneColumns: FpcTableColumn<ProjectTicketBoardRow>[] = this.ticketColumns
    .filter((column) => ['status', 'ticket', 'priority', 'subtasks'].includes(column.id))
    .map((column) => (column.id === 'subtasks' ? { ...column, priority: 1 } : column));
  readonly ticketRowId = (row: ProjectTicketBoardRow): string => row.ticket.id;
  readonly ticketStatusFilter = signal<ProjectTicketStatusFilter>('board');
  readonly ticketPriorityFilter = signal<ProjectTicketPriority | ''>('');
  readonly ticketSearch = signal('');
  readonly ticketSort = signal<FpcTableSort | null>(null);
  readonly ticketPage = signal(1);
  readonly ticketFiltersOpen = signal(false);
  readonly ticketFilterState = fpcListQueryState({
    filters: { status: this.ticketStatusFilter, priority: this.ticketPriorityFilter },
    search: this.ticketSearch,
    open: this.ticketFiltersOpen,
    page: this.ticketPage,
  });
  readonly ticketTableRows = computed(() =>
    buildProjectTicketTableRows(
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
  /** Lanes view drawer: only the priority filter applies (the lanes are the statuses). */
  readonly laneFiltersActive = computed(() => (this.ticketPriorityFilter() ? 1 : 0));
  private readonly laneRowsByStatus = toSignal(this.ticketsBoardRowsByStatus$, { initialValue: null });
  /** Rows of each lane narrowed by the strip's search + priority (one array per lane until the inputs change). */
  readonly laneTableRows = computed(() => {
    const byStatus = this.laneRowsByStatus();

    return Object.fromEntries(this.lanes.map((lane) => [lane, this.filteredLaneRows(byStatus?.[lane])])) as Record<
      BoardLaneStatus,
      ProjectTicketBoardRow[]
    >;
  });
  readonly hiddenMatchesTitle = $localize`:@@featureProjectBoard-moreMatchesTitle:Matches in other statuses (for example closed tickets) — show them in the table with all statuses`;
  /** Removable chips of the applied filters (status when not the default board statuses, priority). */
  readonly ticketChips = computed((): FpcFilterChip[] => [
    ...(this.ticketStatusFilter() !== 'board'
      ? [
          {
            id: 'status',
            value: this.ticketStatusFilter(),
            label: `${this.statusFilterLabel}: ${projectTicketStatusFilterLabel(this.ticketStatusFilter())}`,
          },
        ]
      : []),
    ...this.laneChips(),
  ]);
  readonly laneChips = computed((): FpcFilterChip[] => {
    const priority = this.ticketPriorityFilter();

    return priority
      ? [{ id: 'priority', value: priority, label: `${this.priorityFilterLabel}: ${this.priorityLabel(priority)}` }]
      : [];
  });
  /** Search / priority matches the current view hides (closed tickets, other statuses). */
  readonly hiddenMatchCount = computed(() => {
    const query = { priority: this.ticketPriorityFilter(), search: this.ticketSearch() };
    let visible: Set<string>;

    if (this.view() === 'table') {
      visible = new Set(this.ticketTableRows().map((row) => row.ticket.id));
    } else {
      const byStatus = this.laneRowsByStatus();

      visible = new Set(
        this.lanes.flatMap((lane) => this.filteredLaneRows(byStatus?.[lane]).map((row) => row.ticket.id)),
      );
    }

    return projectTicketHiddenMatchCount(this.ticketsList(), query, visible, this.ticketColumns);
  });
  readonly hiddenMatchLabel = computed(() => projectTicketHiddenMatchLabel(this.hiddenMatchCount()));
  readonly selectedTicketIds = signal<readonly string[]>([]);
  readonly bulkBusy = signal(false);
  readonly bulkResult = signal<DbBulkResult | null>(null);
  readonly ticketsPendingBulkDelete = signal<readonly ProjectTicketResponse[]>([]);
  readonly bulkDeleteConfirmOpen = signal(false);
  readonly bulkDeleteMessage = computed(() => {
    const pending = this.ticketsPendingBulkDelete();

    return pending.length === 1
      ? $localize`:@@featureProjectBoard-bulkDeleteOne:Delete "${pending[0].title}:title:"? This cannot be undone.`
      : $localize`:@@featureProjectBoard-bulkDeleteMany:Delete ${pending.length}:count: tickets? Subtasks of deleted tickets are deleted too. This cannot be undone.`;
  });
  /** ⋮ of a ticket row: the card's actions (open; move between lanes for admins) plus Copy ID / Delete. */
  readonly ticketRowMenu = (row: ProjectTicketBoardRow): FpcMenuItem[] => {
    const editable = projectTicketEditable(row.ticket, this.isAdmin);

    return [
      dbOpenItem(),
      ...(editable
        ? this.statusOptions
            .filter((status) => status !== row.ticket.status)
            .map((status, index) => ({
              id: `status:${status}`,
              label: this.laneLabel(status),
              icon: projectTicketStatusState(status).icon,
              heading: index === 0 ? this.moveToHeading : undefined,
              dividerBefore: index === 0,
            }))
        : []),
      dbCopyIdItem(),
      ...(editable ? [{ id: 'delete', label: DB_DL_DELETE, icon: 'trash', danger: true }] : []),
    ];
  };
  readonly loadingList$ = this.ticketsFacade.loadingList$;
  readonly detail$ = this.ticketsFacade.detail$;
  readonly detailBreadcrumb$ = this.ticketsFacade.detailBreadcrumb$;
  readonly comments$ = this.ticketsFacade.comments$;
  readonly activity$ = this.ticketsFacade.activity$;
  readonly loadingDetail$ = this.ticketsFacade.loadingDetail$;
  readonly saving$ = this.ticketsFacade.saving$;
  readonly error$ = this.ticketsFacade.error$;

  readonly ticketTimeEntries$ = this.timeEntriesFacade.ticketEntries$;
  readonly ticketTimeLoading$ = this.timeEntriesFacade.ticketLoading$;
  readonly ticketTimeError$ = this.timeEntriesFacade.ticketError$;
  readonly ticketTimeSaving$ = this.timeEntriesFacade.saving$;

  readonly detail = toSignal(this.detail$, { initialValue: null as ProjectTicketResponse | null });
  readonly saving = toSignal(this.saving$, { initialValue: false });
  readonly ticketTimeEntries = toSignal(this.ticketTimeEntries$, { initialValue: [] as ProjectTimeEntryResponse[] });
  readonly activity = toSignal(this.activity$, { initialValue: [] as ProjectTicketActivityResponse[] });

  readonly subtasksLabel = $localize`:@@featureProjectBoard-subtasksHeading:Subtasks`;
  readonly timeEntriesLabel = $localize`:@@featureProjectBoard-timeEntriesHeading:Time entries`;
  readonly activityLabel = $localize`:@@featureProjectBoard-activityHeading:Activity`;
  readonly subtaskRowId = (row: ProjectTicketDetailSubtaskRow): string => row.ticket.id;
  /** Subtasks of the open ticket (tree order, indented by depth): State (lane) · Ticket · Priority. */
  readonly subtaskColumns: FpcTableColumn<ProjectTicketDetailSubtaskRow>[] = [
    {
      id: 'status',
      label: $localize`:@@featureProjectBoard-colStatus:Status`,
      type: 'state',
      state: (row) => ({
        label: this.laneLabel(row.ticket.status),
        tone: this.ticketStatusBadgeTone(row.ticket.status),
      }),
    },
    { id: 'ticket', label: $localize`:@@featureProjectBoard-colTicket:Ticket`, required: true, priority: 1 },
    {
      id: 'priority',
      label: $localize`:@@featureProjectBoard-colPriority:Priority`,
      value: (row) => this.priorityLabel(row.ticket.priority),
      priority: 1,
    },
  ];
  /** Time logged on the open ticket: State (billed) · Entry · date · time · duration. */
  readonly timeColumns: FpcTableColumn<ProjectTimeEntryResponse>[] = [
    {
      id: 'billing',
      label: $localize`:@@featureProjectDetail-colBilling:Billing`,
      type: 'state',
      state: (entry) => timeEntryBillingState(isProjectTimeEntryBilled(entry)),
    },
    {
      id: 'entry',
      label: $localize`:@@featureProjectDetail-colEntry:Entry`,
      value: (entry) => this.timeEntryTitle(entry),
      required: true,
      priority: 1,
    },
    {
      id: 'date',
      label: $localize`:@@featureProjectDetail-colDate:Date`,
      value: (entry) => entry.startedAt,
      priority: 1,
    },
    {
      id: 'time',
      label: $localize`:@@featureProjectDetail-colTime:Time`,
      value: (entry) => this.formatTimeEntryClockRange(entry.startedAt, entry.endedAt),
      priority: 2,
    },
    {
      id: 'duration',
      label: $localize`:@@featureProjectDetail-colDuration:Duration`,
      value: (entry) => this.formatMinutes(entry.durationMinutes),
      align: 'end',
      priority: 2,
    },
  ];
  /** Ticket activity feed: State (readable action) · Time · Actor. */
  readonly activityColumns: FpcTableColumn<ProjectTicketActivityResponse>[] = [
    {
      id: 'action',
      label: $localize`:@@featureProjectBoard-colAction:Action`,
      type: 'state',
      state: (event) => ({
        label: this.activityActionLabel(event.actionType),
        tone: this.activityActionBadgeTone(event.actionType),
      }),
      iconOnly: false,
    },
    {
      id: 'time',
      label: $localize`:@@featureProjectDetail-colTime:Time`,
      value: (event) => event.occurredAt,
      required: true,
      priority: 1,
    },
    {
      id: 'actor',
      label: $localize`:@@featureProjectBoard-colActor:Actor`,
      value: (event) => event.actorEmail ?? '',
      priority: 1,
    },
  ];
  readonly ticketTimeLoading = toSignal(this.ticketTimeLoading$, { initialValue: false });
  readonly ticketTimeSaving = toSignal(this.ticketTimeSaving$, { initialValue: false });
  readonly milestones = toSignal(this.milestonesFacade.milestones$, {
    initialValue: [] as ProjectMilestoneResponse[],
  });

  readonly detailSubtaskRows = computed((): ProjectTicketDetailSubtaskRow[] => {
    const children = this.detail()?.children ?? [];

    return [...children]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((ticket) => ({ ticket, depth: 1 }));
  });

  createForm: CreateProjectTicketDto & { content: string } = {
    title: '',
    content: '',
    priority: 'medium',
    status: 'todo',
  };

  timeFormStartedAt = '';
  timeFormEndedAt = '';
  timeFormDescription = '';

  constructor() {
    effect(() => {
      const d = this.detail();

      if (!d) {
        this.lastDetailIdForDraft = null;

        return;
      }

      if (d.id !== this.lastDetailIdForDraft) {
        this.lastDetailIdForDraft = d.id;
        this.descriptionDraft.set(d.content ?? '');
      }
    });

    effect(() => {
      const id = this.detail()?.id ?? null;

      if (id === this.detailTitleEditSyncDetailId) {
        return;
      }

      this.detailTitleEditSyncDetailId = id;
      this.detailTitleEditing.set(false);
    });
  }

  ngOnInit(): void {
    this.ticketsFacade.loadTickets({ projectId: this.projectId });
    this.milestonesFacade.load(this.projectId);

    watchBillingMutationModalClose({
      loading$: this.saving$,
      error$: this.error$,
      open: this.createModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.createParentId.set(null);
        this.resetCreateForm();
      },
    });

    this.actions$
      .pipe(ofType(createProjectTicketSuccess), takeUntilDestroyed(this.destroyRef))
      .subscribe(({ ticket }) => {
        if (!ticket.parentId) {
          return;
        }

        // Prevent create-modal `(closed)` from restoring the parent detail over the new ticket.
        this.detailModalSwap.suspended = false;
        this.openTicketDetailFlow(ticket.id);
      });

    watchBillingMutationModalClose({
      loading$: this.ticketTimeSaving$,
      error$: this.timeEntriesFacade.error$,
      open: this.createTimeModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.resetTicketTimeForm();
        // `hideBillingModal` does not emit `fpc-modal` `(closed)`, so restore here (cancel still uses `(closed)`).
        restoreUnderlyingBillingModal({
          underlyingOpen: this.detailModalOpen,
          swapState: this.detailModalSwap,
        });
      },
    });

    watchBillingMutationModalClose({
      loading$: this.saving$,
      error$: this.error$,
      open: this.deleteTicketConfirmModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.ticketPendingDelete.set(null);
        this.detailModalSwap.suspended = false;
        this.closeDetail();
      },
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

  setView(view: ProjectBoardView): void {
    if (view !== this.view()) {
      this.boardView.set(view);
    }
  }

  statusFilterOptionLabel(value: ProjectTicketStatusFilter): string {
    return projectTicketStatusFilterLabel(value);
  }

  onTicketRowAction(row: ProjectTicketBoardRow, action: string): void {
    const ticket = row.ticket;

    if (action === 'open') {
      this.openTicketDetailFlow(ticket.id);
    } else if (action === 'copy-id') {
      fpcCopyText(ticket.id);
    } else if (action === 'delete' && projectTicketEditable(ticket, this.isAdmin)) {
      this.ticketsPendingBulkDelete.set([ticket]);
      this.bulkDeleteConfirmOpen.set(true);
    } else if (action.startsWith('status:') && projectTicketEditable(ticket, this.isAdmin)) {
      this.ticketsFacade.update(this.projectId, ticket.id, {
        status: action.slice('status:'.length) as ProjectTicketStatus,
      });
    }
  }

  /** Selected tickets an admin may change (locked ones are read-only and skipped). */
  private selectedEditableTickets(): ProjectTicketResponse[] {
    const ids = new Set(this.selectedTicketIds());

    return this.ticketsList().filter((ticket) => ids.has(ticket.id) && projectTicketEditable(ticket, this.isAdmin));
  }

  onBulkStatus(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const status = select.value as ProjectTicketStatus;

    select.value = '';
    this.onBulkStatusValue(status);
  }

  /** Batch menu (status): fan the change out over the selected tickets. */
  onBulkStatusValue(status: ProjectTicketStatus): void {
    if (status) {
      void this.runTicketBulk(() =>
        bulkUpdateProjectTickets(this.selectedEditableTickets(), { status }, this.updateTicket),
      );
    }
  }

  onBulkPriority(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const priority = select.value as ProjectTicketPriority;

    select.value = '';
    this.onBulkPriorityValue(priority);
  }

  /** Batch menu (priority): fan the change out over the selected tickets. */
  onBulkPriorityValue(priority: ProjectTicketPriority): void {
    if (priority) {
      void this.runTicketBulk(() =>
        bulkUpdateProjectTickets(this.selectedEditableTickets(), { priority }, this.updateTicket),
      );
    }
  }

  requestBulkDelete(): void {
    const tickets = this.selectedEditableTickets();

    if (tickets.length > 0) {
      this.ticketsPendingBulkDelete.set(tickets);
      this.bulkDeleteConfirmOpen.set(true);
    }
  }

  onConfirmBulkDelete(): void {
    const tickets = this.ticketsPendingBulkDelete();

    this.ticketsPendingBulkDelete.set([]);
    void this.runTicketBulk(() =>
      bulkDeleteProjectTickets(tickets, (id) => firstValueFrom(this.ticketsService.delete(this.projectId, id))),
    );
  }

  private readonly updateTicket = (
    id: string,
    dto: { status?: ProjectTicketStatus; priority?: ProjectTicketPriority },
  ) => firstValueFrom(this.ticketsService.update(this.projectId, id, dto));

  /** Runs a bulk action (client fan-out over the single-ticket endpoints), shows the per-ticket result, reloads. */
  async runTicketBulk(bulk: () => Promise<FpcBulkResult<ProjectTicketResponse>>): Promise<void> {
    this.bulkBusy.set(true);
    this.bulkResult.set(null);

    try {
      const result = await bulk();

      if (result.results.length === 0) {
        return;
      }

      this.bulkResult.set(dbBulkSummary(result, (ticket) => ticket.title));
      this.selectedTicketIds.set(result.failed.concat(result.denied).map((ticket) => ticket.id));

      if (result.succeeded.length > 0) {
        this.ticketsFacade.loadTickets({ projectId: this.projectId });
      }
    } finally {
      this.bulkBusy.set(false);
    }
  }

  /** Lane rows narrowed by the board search + priority filter (one toolbar above all lanes, shared with the table). */
  filteredLaneRows(rows: ProjectTicketBoardRow[] | undefined): ProjectTicketBoardRow[] {
    return filterProjectTicketLaneRows(rows ?? [], {
      priority: this.ticketPriorityFilter(),
      search: this.ticketSearch(),
    });
  }

  laneLabel(status: string): string {
    return projectTicketLaneStatusLabel(status);
  }

  onSelectedLaneTabChange(tabId: string | null): void {
    if (tabId && (this.lanes as readonly string[]).includes(tabId)) {
      this.selectedLane.set(tabId as BoardLaneStatus);
    }
  }

  milestoneLabel(milestoneId: string | null | undefined): string {
    if (!milestoneId) {
      return $localize`:@@featureProjectBoard-milestoneNone:None`;
    }

    return (
      this.milestones()
        .find((m) => m.id === milestoneId)
        ?.name?.trim() || getUnavailableLabel()
    );
  }

  priorityLabel(priority: ProjectTicketPriority): string {
    return projectTicketPriorityLabel(priority);
  }

  activityActionLabel(actionType: string): string {
    return projectTicketActivityActionLabel(actionType);
  }

  activityActionBadgeTone(actionType: string): FpcBadgeTone {
    return projectTicketActivityActionBadgeTone(actionType);
  }

  ticketPriorityBadgeTone(priority: ProjectTicketPriority): FpcBadgeTone {
    return projectTicketPriorityTone(priority);
  }

  ticketStatusBadgeTone(status: ProjectTicketStatus): FpcBadgeTone {
    return projectTicketStatusTone(status);
  }

  /** Lane card click / Enter (a drag never activates it): open the detail. */
  onLaneRowActivate(row: ProjectTicketBoardRow): void {
    this.openTicketDetailFlow(row.ticket.id);
  }

  onBreadcrumbNavigate(ticketId: string): void {
    this.openTicketDetailFlow(ticketId);
  }

  onHierarchyBreadcrumbSelected(event: MouseEvent, ticketId: string): void {
    event.preventDefault();
    this.onBreadcrumbNavigate(ticketId);
  }

  openSubtaskDetail(ticketId: string): void {
    this.openTicketDetailFlow(ticketId);
  }

  /**
   * Close any open detail/overlay fully, then load ticket detail and reopen
   * (avoids unloading state while the modal is still animating closed).
   */
  openTicketDetailFlow(ticketId: string): void {
    if (this.detail()?.id === ticketId && this.detailModalOpen()) {
      return;
    }

    const generation = ++this.ticketDetailOpenGeneration;

    this.detailModalSwap.suspended = false;
    const closingOverlay = this.createModalOpen() || this.createTimeModalOpen() || this.deleteTicketConfirmModalOpen();
    hideBillingModal(this.createModalOpen);
    hideBillingModal(this.createTimeModalOpen);
    hideBillingModal(this.deleteTicketConfirmModalOpen);

    const wasOpen = this.detailModalOpen();

    if (wasOpen) {
      hideBillingModal(this.detailModalOpen);
    }

    const closeMs = wasOpen || closingOverlay ? BILLING_MODAL_TRANSITION_MS : 0;

    setTimeout(() => {
      if (generation !== this.ticketDetailOpenGeneration) {
        return;
      }

      const whenReady$ = this.loadingDetail$.pipe(
        pairwise(),
        filter(([wasLoading, loading]) => wasLoading && !loading),
        take(1),
      );

      this.ticketsFacade.openDetail(ticketId);

      whenReady$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        if (generation !== this.ticketDetailOpenGeneration || this.detail()?.id !== ticketId) {
          return;
        }

        showBillingModal(this.detailModalOpen);
      });
    }, closeMs);
  }

  closeDetail(): void {
    this.detailModalOpen.set(false);
    this.onDetailModalClosed();
  }

  onDetailModalClosed(): void {
    this.detailModalSwap.suspended = false;
    this.detailTitleEditing.set(false);
    this.ticketsFacade.closeDetail();
    this.commentBody.set('');
  }

  showCreateTicketModal(): void {
    if (!this.isAdmin) return;

    this.createParentId.set(null);
    this.resetCreateForm();
    showBillingModal(this.createModalOpen);
  }

  showCreateSubtaskModal(): void {
    const parent = this.detail();
    const parentId = parent?.id;

    if (!this.isAdmin || !parentId) return;

    this.createParentId.set(parentId);
    this.createForm = {
      title: '',
      content: '',
      priority: 'medium',
      status: 'draft',
      parentId,
      milestoneId: parent.milestoneId ?? undefined,
    };

    swapToOverlayBillingModal({
      underlyingOpen: this.detailModalOpen,
      overlayOpen: this.createModalOpen,
      swapState: this.detailModalSwap,
    });
  }

  onCreateModalClosed(): void {
    restoreUnderlyingBillingModal({
      underlyingOpen: this.detailModalOpen,
      swapState: this.detailModalSwap,
    });
    this.createParentId.set(null);
    this.resetCreateForm();
  }

  closeCreateModal(): void {
    hideBillingModal(this.createModalOpen);
    this.onCreateModalClosed();
  }

  submitCreate(): void {
    if (!this.createForm.title.trim()) return;

    const parentId = this.createParentId();

    this.ticketsFacade.create(this.projectId, {
      ...this.createForm,
      title: this.createForm.title.trim(),
      ...(parentId ? { parentId } : {}),
      milestoneId: this.createForm.milestoneId || undefined,
    });
  }

  onDetailStatusChange(ticketId: string, status: ProjectTicketStatus): void {
    if (!this.isAdmin) return;

    this.ticketsFacade.update(this.projectId, ticketId, { status });
  }

  onDetailPriorityChange(ticketId: string, priority: ProjectTicketPriority): void {
    if (!this.isAdmin) return;

    this.ticketsFacade.update(this.projectId, ticketId, { priority });
  }

  onCreateMilestoneChange(milestoneId: string | null): void {
    this.createForm.milestoneId = milestoneId ?? undefined;
  }

  onDetailMilestoneChange(ticketId: string, milestoneId: string | null): void {
    if (!this.isAdmin) return;

    const d = this.detail();

    if (!d) return;

    const normalized = milestoneId ?? null;

    if (normalized === (d.milestoneId ?? null)) return;

    this.ticketsFacade.update(this.projectId, ticketId, { milestoneId: normalized });
  }

  lockTicket(ticketId: string): void {
    if (!this.isAdmin) return;

    const d = this.detail();

    if (!d || d.locked) return;

    this.ticketsFacade.update(this.projectId, ticketId, { locked: true });
  }

  onRequestDeleteTicket(ticket: ProjectTicketResponse): void {
    if (!this.isAdmin || ticket.locked) return;

    this.ticketPendingDelete.set({ id: ticket.id, title: ticket.title });
    swapToOverlayBillingModal({
      underlyingOpen: this.detailModalOpen,
      overlayOpen: this.deleteTicketConfirmModalOpen,
      swapState: this.detailModalSwap,
    });
  }

  onDeleteTicketConfirmModalClosed(): void {
    restoreUnderlyingBillingModal({
      underlyingOpen: this.detailModalOpen,
      swapState: this.detailModalSwap,
    });
  }

  onCancelDeleteTicketConfirm(): void {
    this.ticketPendingDelete.set(null);
    this.onDeleteTicketConfirmModalClosed();
  }

  onConfirmDeleteTicket(): void {
    const pending = this.ticketPendingDelete();

    if (!pending || !this.isAdmin) return;

    this.ticketsFacade.remove(this.projectId, pending.id);
  }

  lockedTicketLabel(): string {
    return $localize`:@@featureProjectBoard-lockedTicket:Locked`;
  }

  showCreateTimeEntryModal(): void {
    if (!this.isAdmin || !this.detail()?.id || this.detail()?.locked) return;

    this.resetTicketTimeForm();
    swapToOverlayBillingModal({
      underlyingOpen: this.detailModalOpen,
      overlayOpen: this.createTimeModalOpen,
      swapState: this.detailModalSwap,
    });
  }

  onCreateTimeModalClosed(): void {
    restoreUnderlyingBillingModal({
      underlyingOpen: this.detailModalOpen,
      swapState: this.detailModalSwap,
    });
  }

  submitTicketTimeEntry(): void {
    const ticketId = this.detail()?.id;

    if (!this.isAdmin || !ticketId || this.detail()?.locked || !this.isTicketTimeFormValid()) return;

    this.timeEntriesFacade.create(this.projectId, {
      ticketId,
      startedAt: this.datetimeLocalToIso(this.timeFormStartedAt),
      endedAt: this.datetimeLocalToIso(this.timeFormEndedAt),
      description: this.timeFormDescription.trim() || undefined,
    });
  }

  timeEntryTitle(entry: ProjectTimeEntryResponse): string {
    const description = entry.description?.trim();

    return description || this.formatMinutes(entry.durationMinutes);
  }

  timeEntryStart(entry: ProjectTimeEntryResponse): string {
    return entry.startedAt;
  }

  activityTime(event: ProjectTicketActivityResponse): string {
    return event.occurredAt;
  }

  subtaskDepth(row: ProjectTicketDetailSubtaskRow): number {
    return row.depth;
  }

  subtaskShortSha(row: ProjectTicketDetailSubtaskRow): string | null {
    return row.ticket.shas.short || null;
  }

  subtaskTitle(row: ProjectTicketDetailSubtaskRow): string {
    return row.ticket.title;
  }

  formatMinutes(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;

    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  formatTimeEntryClockRange(startedAt: string, endedAt: string): string {
    return formatBillingClockRange(startedAt, endedAt);
  }

  isTicketTimeFormValid(): boolean {
    if (!this.timeFormStartedAt || !this.timeFormEndedAt) return false;

    return new Date(this.timeFormEndedAt).getTime() > new Date(this.timeFormStartedAt).getTime();
  }

  onDetailTitleClick(ticket: ProjectTicketResponse): void {
    if (!this.isAdmin || ticket.locked) return;

    this.detailTitleDraft.set(ticket.title);
    this.detailTitleEditing.set(true);
    afterNextRender(
      () => {
        this.detailTitleInputRef()?.nativeElement?.querySelector('input')?.focus() ??
          this.detailTitleInputRef()?.nativeElement?.focus();
      },
      { injector: this.injector },
    );
  }

  onDetailTitleBlur(): void {
    const d = this.detail();

    if (!d || !this.detailTitleEditing() || !this.isAdmin || d.locked) {
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

    this.ticketsFacade.update(this.projectId, d.id, { title: trimmed });
    this.detailTitleEditing.set(false);
  }

  onDescriptionDraftCommit(): void {
    const d = this.detail();

    if (!d || !this.isAdmin || d.locked) return;

    const content = this.descriptionDraft();

    if (content === (d.content ?? '')) return;

    this.ticketsFacade.update(this.projectId, d.id, { content });
  }

  onTicketAttachmentSelected(event: Event, ticket: ProjectTicketResponse): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);

    if (files.length === 0) return;

    for (const file of files) {
      this.ticketsService
        .uploadAttachment(this.projectId, ticket.id, file)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: (attachment) => this.ticketsFacade.addAttachment(ticket.id, attachment) });
    }

    input.value = '';
  }

  downloadTicketAttachment(attachment: ProjectTicketAttachmentResponse, ticket: ProjectTicketResponse): void {
    this.ticketsService
      .downloadAttachment(this.projectId, ticket.id, attachment.id)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => this.saveBlob(blob, attachment.fileName));
  }

  deleteTicketAttachment(attachment: ProjectTicketAttachmentResponse, ticket: ProjectTicketResponse): void {
    if (!this.isAdmin || ticket.locked) return;

    this.ticketsService
      .deleteAttachment(this.projectId, ticket.id, attachment.id)
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

  submitComment(): void {
    const ticketId = this.detail()?.id;
    const body = this.commentBody().trim();

    if (!ticketId || !body || this.detail()?.locked) return;

    this.ticketsFacade.addComment(this.projectId, ticketId, body);
    this.commentBody.set('');
  }

  /** A lane card dropped on another lane: same status update as before, admins and unlocked tickets only. */
  onLaneRowDrop(event: FpcTableRowDropEvent<ProjectTicketBoardRow>): void {
    const status = event.toData as BoardLaneStatus;
    const ticket = event.row.ticket;

    if (!(this.lanes as readonly string[]).includes(status) || ticket.status === status) return;
    if (!this.isTicketDraggable(ticket)) return;

    this.ticketsFacade.update(this.projectId, ticket.id, { status });
  }

  private resetCreateForm(): void {
    this.createForm = { title: '', content: '', priority: 'medium', status: 'todo' };
  }

  private resetTicketTimeForm(): void {
    const { startedAt, endedAt } = this.defaultTicketTimeRangeLocal();

    this.timeFormStartedAt = startedAt;
    this.timeFormEndedAt = endedAt;
    this.timeFormDescription = '';
  }

  private defaultTicketTimeRangeLocal(): { startedAt: string; endedAt: string } {
    const end = new Date();

    end.setSeconds(0, 0);

    const start = new Date(end.getTime() - 60 * 60 * 1000);

    return {
      startedAt: this.toDatetimeLocalValue(start),
      endedAt: this.toDatetimeLocalValue(end),
    };
  }

  private toDatetimeLocalValue(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private datetimeLocalToIso(value: string): string {
    return new Date(value).toISOString();
  }
}
