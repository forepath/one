import { ScrollingModule } from '@angular/cdk/scrolling';
import { CommonModule } from '@angular/common';
import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  Injector,
  Input,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
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
  type ProjectTicketBoardRow,
  type ProjectTicketPriority,
  type ProjectTicketResponse,
  type ProjectTicketStatus,
  type ProjectTimeEntryResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcBoardLaneComponent,
  FpcBreadcrumbItemComponent,
  FpcBreadcrumbsComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcLaneHeaderComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTypeaheadSelectComponent,
} from '@forepath/shared/frontend/ui-components';
import { Actions, ofType } from '@ngrx/effects';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  of,
  pairwise,
  switchMap,
  take,
} from 'rxjs';

import {
  BILLING_MODAL_TRANSITION_MS,
  hideBillingModal,
  restoreUnderlyingBillingModal,
  showBillingModal,
  swapToOverlayBillingModal,
  watchBillingMutationModalClose,
  type BillingModalSwapState,
} from '../billing-modal';
import {
  getProjectTimeEntryBillingStatusIconClass,
  getProjectTimeEntryBillingStatusLabel,
  getProjectTimeEntryBillingStatusTextClass,
  getUnavailableLabel,
  isProjectTimeEntryBilled,
} from '../billing-status-labels';
import {
  projectTicketActivityActionBadgeClass,
  projectTicketActivityActionLabel,
} from '../project-ticket-activity-labels';
import { ProjectMilestoneSelectComponent } from '../project-milestone-select/project-milestone-select.component';
import { ProjectTicketEditorComponent } from '../project-ticket-editor/project-ticket-editor.component';
import { projectTicketLaneStatusLabel } from '../project-ticket-lane-status-label';

const ALL_TICKET_STATUSES: ProjectTicketStatus[] = ['draft', 'todo', 'in_progress', 'prototype', 'done', 'closed'];

const PRIORITY_OPTIONS: ProjectTicketPriority[] = ['low', 'medium', 'high', 'critical'];

/** Fixed row height for CDK virtual scroll (title + meta chips + list-group padding). */
const PROJECT_BOARD_VIRTUAL_ITEM_SIZE_PX = 88;

interface ProjectTicketDetailSubtaskRow {
  ticket: ProjectTicketResponse;
  depth: number;
}

function isEditableDomTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;

  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }

  return target.isContentEditable;
}

@Component({
  selector: 'framework-project-board',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ScrollingModule,
    ProjectMilestoneSelectComponent,
    ProjectTicketEditorComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcBoardLaneComponent,
    FpcBreadcrumbItemComponent,
    FpcBreadcrumbsComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcLaneHeaderComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTypeaheadSelectComponent,
  ],
  templateUrl: './project-board.component.html',
  styleUrls: ['./project-board.component.scss'],
})
export class ProjectBoardComponent implements OnInit {
  readonly pageTitle = $localize`:@@featureProjectBoard-title:Board`;
  readonly globalSearchTitle = $localize`:@@featureProjectBoard-globalSearchOpenTitle:Search tickets (Ctrl+F)`;
  readonly globalSearchAriaLabel = $localize`:@@featureProjectBoard-globalSearchOpenAria:Search tickets`;
  readonly commentInputAriaLabel = $localize`:@@featureProjectBoard-commentPlaceholder:Add a comment…`;
  readonly laneSearchPlaceholder = $localize`:@@featureProjectBoard-searchLanePlaceholder:Search tickets`;
  readonly laneSearchAriaLabel = $localize`:@@featureProjectBoard-searchLaneLabel:Search tickets`;
  readonly addTitle = $localize`:@@featureProjectBoard-add:Add`;

  @Input({ required: true }) projectId!: string;
  @Input() isAdmin = false;

  private readonly globalSearchInput = viewChild<ElementRef<HTMLElement>>('globalSearchInput');
  private readonly detailTitleInputRef = viewChild<ElementRef<HTMLInputElement>>('detailTitleInput');

  readonly detailModalOpen = signal(false);
  readonly createModalOpen = signal(false);
  readonly createTimeModalOpen = signal(false);
  readonly deleteTicketConfirmModalOpen = signal(false);
  readonly globalSearchModalOpen = signal(false);
  private readonly ticketsFacade = inject(ProjectTicketsFacade);
  private readonly ticketsService = inject(ProjectTicketsService);
  private readonly milestonesFacade = inject(ProjectMilestonesFacade);
  private readonly timeEntriesFacade = inject(ProjectTimeEntriesFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly actions$ = inject(Actions);

  readonly laneVirtualItemSize = PROJECT_BOARD_VIRTUAL_ITEM_SIZE_PX;
  readonly lanes = BOARD_LANE_STATUSES;
  readonly statusOptions = ALL_TICKET_STATUSES;
  readonly priorityOptions = PRIORITY_OPTIONS;
  readonly selectedLane = signal<BoardLaneStatus>('todo');
  readonly activityOccurredAtFormat = 'MMM d, y · h:mm a';

  /** Per-swimlane list filter (same substring behavior as Agenstra tickets board). */
  readonly laneSearchQueries = signal({
    draft: '',
    todo: '',
    in_progress: '',
    prototype: '',
    done: '',
  } satisfies Record<BoardLaneStatus, string>);

  readonly createParentId = signal<string | null>(null);
  readonly descriptionDraft = signal('');
  readonly commentBody = signal('');
  readonly detailTitleEditing = signal(false);
  readonly detailTitleDraft = signal('');

  readonly draggedTicket = signal<ProjectTicketResponse | null>(null);
  readonly dragOverLane = signal<BoardLaneStatus | null>(null);
  readonly globalSearchQuery = signal('');
  readonly globalSearchQuery$ = toObservable(this.globalSearchQuery);
  readonly globalSearchHits = signal<ProjectTicketResponse[]>([]);
  readonly globalSearchLoading = signal(false);
  readonly globalSearchSuggestionsOpen = signal(false);
  readonly ticketPendingDelete = signal<{ id: string; title: string } | null>(null);

  private lastDetailIdForDraft: string | null = null;
  private detailTitleEditSyncDetailId: string | null = null;
  private readonly detailModalSwap: BillingModalSwapState = { suspended: false };
  /** Bumps on each {@link openTicketDetailFlow} so stale load completions cannot reopen the modal. */
  private ticketDetailOpenGeneration = 0;
  /** Skip opening detail right after a drag ended (browser may emit click). */
  private suppressCardClickUntil = 0;

  isTicketDraggable(ticket: ProjectTicketResponse): boolean {
    return this.isAdmin && !ticket.locked;
  }

  readonly ticketsBoardRowsByStatus$ = this.ticketsFacade.boardRowsByStatus$;
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

    this.globalSearchQuery$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => {
          const trimmed = query.trim();

          if (!trimmed) {
            this.globalSearchLoading.set(false);

            return of([] as ProjectTicketResponse[]);
          }

          this.globalSearchLoading.set(true);

          return this.ticketsService.list({ projectId: this.projectId, search: trimmed, limit: 50 }).pipe(
            map((tickets) => [...tickets].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))),
            catchError(() => of([] as ProjectTicketResponse[])),
            finalize(() => this.globalSearchLoading.set(false)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((hits) => this.globalSearchHits.set(hits));

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

  setLaneSearchQuery(lane: BoardLaneStatus, value: string): void {
    this.laneSearchQueries.update((queries) => ({ ...queries, [lane]: value }));
  }

  filteredLaneRows(lane: BoardLaneStatus, rows: ProjectTicketBoardRow[] | undefined): ProjectTicketBoardRow[] {
    const list = rows ?? [];
    const query = (this.laneSearchQueries()[lane] ?? '').trim();

    if (!query) {
      return list;
    }

    const needle = query.toLowerCase();

    return list.filter((row) => JSON.stringify(row.ticket).toLowerCase().includes(needle));
  }

  trackLaneRowByTicketId(_index: number, row: ProjectTicketBoardRow): string {
    return row.ticket.id;
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
    switch (priority) {
      case 'low':
        return $localize`:@@featureProjectBoard-priorityLow:Low`;
      case 'medium':
        return $localize`:@@featureProjectBoard-priorityMedium:Medium`;
      case 'high':
        return $localize`:@@featureProjectBoard-priorityHigh:High`;
      case 'critical':
        return $localize`:@@featureProjectBoard-priorityCritical:Critical`;
      default:
        return priority;
    }
  }

  activityActionLabel(actionType: string): string {
    return projectTicketActivityActionLabel(actionType);
  }

  activityActionBadgeClass(actionType: string): string {
    return projectTicketActivityActionBadgeClass(actionType);
  }

  ticketPriorityBadgeClass(priority: ProjectTicketPriority): string {
    switch (priority) {
      case 'low':
        return 'project-board__chip--priority-low';
      case 'medium':
        return 'project-board__chip--priority-medium';
      case 'high':
        return 'project-board__chip--priority-high';
      case 'critical':
        return 'project-board__chip--priority-critical';
      default:
        return 'project-board__chip--neutral';
    }
  }

  ticketStatusBadgeClass(status: ProjectTicketStatus): string {
    switch (status) {
      case 'draft':
        return 'project-board__chip--status-draft';
      case 'todo':
        return 'project-board__chip--status-todo';
      case 'in_progress':
        return 'project-board__chip--status-in-progress';
      case 'prototype':
        return 'project-board__chip--status-prototype';
      case 'done':
        return 'project-board__chip--status-done';
      case 'closed':
        return 'project-board__chip--status-closed';
      default:
        return 'project-board__chip--neutral';
    }
  }

  onTicketCardClick(ticket: ProjectTicketResponse): void {
    if (typeof performance !== 'undefined' && performance.now() < this.suppressCardClickUntil) {
      return;
    }

    this.openTicketDetailFlow(ticket.id);
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydownForGlobalSearch(event: KeyboardEvent): void {
    if (!event.ctrlKey || (event.key !== 'f' && event.key !== 'F')) {
      return;
    }

    if (!this.projectId) {
      return;
    }

    const target = event.target;
    const searchHost = this.globalSearchInput()?.nativeElement;

    if (isEditableDomTarget(target)) {
      if (this.globalSearchModalOpen() && searchHost && target instanceof Node && searchHost.contains(target)) {
        event.preventDefault();
        this.focusGlobalSearchInput();
      }

      return;
    }

    event.preventDefault();
    this.openGlobalSearchModal();
  }

  openGlobalSearchModal(): void {
    this.globalSearchQuery.set('');
    this.globalSearchHits.set([]);
    this.globalSearchLoading.set(false);
    this.globalSearchSuggestionsOpen.set(false);
    setTimeout(() => {
      if (this.globalSearchModalOpen()) {
        this.focusGlobalSearchInput({ preventScroll: true });

        return;
      }

      showBillingModal(this.globalSearchModalOpen);
      afterNextRender(() => this.focusGlobalSearchInput({ preventScroll: true }), { injector: this.injector });
    }, 0);
  }

  onCloseGlobalSearchModal(): void {
    this.globalSearchModalOpen.set(false);
    this.globalSearchQuery.set('');
    this.globalSearchHits.set([]);
    this.globalSearchLoading.set(false);
    this.globalSearchSuggestionsOpen.set(false);
  }

  onGlobalSearchQueryChange(value: string): void {
    this.globalSearchQuery.set(value);
    const term = value.trim();

    if (!term) {
      this.globalSearchHits.set([]);
      this.globalSearchLoading.set(false);
      this.globalSearchSuggestionsOpen.set(false);

      return;
    }

    this.globalSearchHits.set([]);
    this.globalSearchLoading.set(true);
    this.globalSearchSuggestionsOpen.set(true);
  }

  onGlobalSearchSuggestionsOpenChange(open: boolean): void {
    if (!open) {
      this.globalSearchSuggestionsOpen.set(false);

      return;
    }

    this.globalSearchSuggestionsOpen.set(this.globalSearchQuery().trim().length > 0);
  }

  onGlobalSearchResultClick(ticket: ProjectTicketResponse, event?: MouseEvent): void {
    event?.preventDefault();
    this.onCloseGlobalSearchModal();
    this.openTicketDetailFlow(ticket.id);
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

  timeEntryShowsDurationInMeta(entry: ProjectTimeEntryResponse): boolean {
    return !!entry.description?.trim();
  }

  timeEntryBillingStatusLabel(entry: ProjectTimeEntryResponse): string {
    return getProjectTimeEntryBillingStatusLabel(isProjectTimeEntryBilled(entry));
  }

  timeEntryBillingStatusTextClass(entry: ProjectTimeEntryResponse): string {
    return getProjectTimeEntryBillingStatusTextClass(isProjectTimeEntryBilled(entry));
  }

  timeEntryBillingStatusIconClass(entry: ProjectTimeEntryResponse): string {
    return getProjectTimeEntryBillingStatusIconClass(isProjectTimeEntryBilled(entry));
  }

  formatMinutes(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;

    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  formatTimeEntryClockRange(startedAt: string, endedAt: string): string {
    const start = new Date(startedAt);
    const end = new Date(endedAt);
    const sameDay =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();
    const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

    if (sameDay) {
      return `${start.toLocaleTimeString([], timeOptions)} – ${end.toLocaleTimeString([], timeOptions)}`;
    }

    return `${start.toLocaleString()} – ${end.toLocaleString()}`;
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

  submitComment(): void {
    const ticketId = this.detail()?.id;
    const body = this.commentBody().trim();

    if (!ticketId || !body || this.detail()?.locked) return;

    this.ticketsFacade.addComment(this.projectId, ticketId, body);
    this.commentBody.set('');
  }

  onLaneDrop(event: DragEvent, laneStatus: BoardLaneStatus): void {
    event.preventDefault();

    const dragged = this.draggedTicket();

    this.dragOverLane.set(null);

    if (!dragged) {
      return;
    }

    if (!(this.lanes as readonly string[]).includes(laneStatus)) {
      this.draggedTicket.set(null);

      return;
    }

    if (dragged.status === laneStatus) {
      this.draggedTicket.set(null);

      return;
    }

    this.ticketsFacade.update(this.projectId, dragged.id, { status: laneStatus });
    this.draggedTicket.set(null);
  }

  isLaneDragHighlight(status: BoardLaneStatus): boolean {
    const dragged = this.draggedTicket();

    return this.dragOverLane() === status && dragged !== null && dragged.status !== status;
  }

  onLaneDragOver(event: DragEvent, laneStatus: BoardLaneStatus): void {
    event.preventDefault();

    const dragged = this.draggedTicket();

    if (!dragged || dragged.status === laneStatus) {
      return;
    }

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    this.dragOverLane.set(laneStatus);
  }

  onCardDragOver(event: DragEvent): void {
    event.preventDefault();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onLaneDragEnter(event: DragEvent, laneStatus: BoardLaneStatus): void {
    event.preventDefault();

    const dragged = this.draggedTicket();

    if (!dragged || dragged.status === laneStatus) {
      return;
    }

    this.dragOverLane.set(laneStatus);
  }

  onLaneDragLeave(event: DragEvent, laneStatus: BoardLaneStatus): void {
    event.preventDefault();

    const related = event.relatedTarget as HTMLElement | null;

    if (related && event.currentTarget instanceof HTMLElement && event.currentTarget.contains(related)) {
      return;
    }

    if (this.dragOverLane() === laneStatus) {
      this.dragOverLane.set(null);
    }
  }

  onTicketDragStart(event: DragEvent, ticket: ProjectTicketResponse): void {
    if (!event.dataTransfer) {
      return;
    }

    if (!this.isAdmin || ticket.locked) {
      event.preventDefault();

      return;
    }

    this.draggedTicket.set(ticket);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', ticket.id);

    if (event.currentTarget instanceof HTMLElement) {
      const card = event.currentTarget.querySelector('.project-board__card-content');

      if (card) {
        const dragImage = card.cloneNode(true) as HTMLElement;

        dragImage.style.position = 'absolute';
        dragImage.style.top = '-1000px';
        dragImage.style.opacity = '0.8';
        dragImage.style.backgroundColor = 'var(--bs-body-bg)';
        dragImage.style.padding = '4px 8px';
        dragImage.style.border = '1px solid var(--bs-border-color)';
        dragImage.style.borderRadius = '4px';
        dragImage.style.maxWidth = '240px';
        document.body.appendChild(dragImage);
        event.dataTransfer.setDragImage(dragImage, 0, 0);
        setTimeout(() => {
          if (document.body.contains(dragImage)) {
            document.body.removeChild(dragImage);
          }
        }, 0);
      }
    }
  }

  onTicketDragEnd(): void {
    this.draggedTicket.set(null);
    this.dragOverLane.set(null);
    this.suppressCardClickUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 200;
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

  private focusGlobalSearchInput(options?: FocusOptions): void {
    this.globalSearchInput()?.nativeElement?.querySelector<HTMLInputElement>('input')?.focus(options);
  }
}
