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
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  BOARD_LANE_STATUSES,
  ProjectMilestonesFacade,
  ProjectTicketsFacade,
  filterTicketsForGlobalSearch,
  type BoardLaneStatus,
  type CreateProjectTicketDto,
  type ProjectMilestoneResponse,
  type ProjectTicketBoardRow,
  type ProjectTicketGlobalSearchHit,
  type ProjectTicketPriority,
  type ProjectTicketResponse,
  type ProjectTicketStatus,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { filter } from 'rxjs';

import { hideBillingModal, showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import {
  projectTicketActivityActionBadgeClass,
  projectTicketActivityActionLabel,
} from '../project-ticket-activity-labels';
import { ProjectMilestoneSelectComponent } from '../project-milestone-select/project-milestone-select.component';
import { ProjectTicketEditorComponent } from '../project-ticket-editor/project-ticket-editor.component';
import { projectTicketLaneStatusLabel } from '../project-ticket-lane-status-label';

const ALL_TICKET_STATUSES: ProjectTicketStatus[] = ['draft', 'todo', 'in_progress', 'prototype', 'done', 'closed'];

const PRIORITY_OPTIONS: ProjectTicketPriority[] = ['low', 'medium', 'high', 'critical'];

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
  imports: [CommonModule, FormsModule, ProjectMilestoneSelectComponent, ProjectTicketEditorComponent],
  templateUrl: './project-board.component.html',
  styleUrls: ['./project-board.component.scss'],
})
export class ProjectBoardComponent implements OnInit {
  @Input({ required: true }) projectId!: string;
  @Input() isAdmin = false;

  @ViewChild('detailModal', { static: false }) private detailModal!: ElementRef<HTMLDivElement>;
  @ViewChild('createModal', { static: false }) private createModal!: ElementRef<HTMLDivElement>;
  @ViewChild('globalSearchModal', { static: false }) private globalSearchModal?: ElementRef<HTMLDivElement>;
  @ViewChild('globalSearchInput', { static: false }) private globalSearchInput?: ElementRef<HTMLInputElement>;

  private readonly detailTitleInputRef = viewChild<ElementRef<HTMLInputElement>>('detailTitleInput');
  private readonly ticketsFacade = inject(ProjectTicketsFacade);
  private readonly milestonesFacade = inject(ProjectMilestonesFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

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

  readonly ticketsList = toSignal(this.ticketsFacade.tickets$, { initialValue: [] as ProjectTicketResponse[] });
  readonly globalSearchHits = computed(() =>
    filterTicketsForGlobalSearch(this.ticketsList(), this.globalSearchQuery(), this.projectId),
  );

  private lastDetailIdForDraft: string | null = null;
  private detailTitleEditSyncDetailId: string | null = null;
  private detailSuspendedForCreateSubtask = false;
  /** Skip opening detail right after a drag ended (browser may emit click). */
  private suppressCardClickUntil = 0;

  isTicketDraggable(ticket: ProjectTicketResponse): boolean {
    return this.isAdmin && !ticket.locked;
  }

  hasTicketDescription(content: string | null | undefined): boolean {
    if (!content?.trim()) {
      return false;
    }

    const text = content
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text.length > 0;
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

  readonly detail = toSignal(this.detail$, { initialValue: null as ProjectTicketResponse | null });
  readonly saving = toSignal(this.saving$, { initialValue: false });
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

    this.ticketsFacade.selectedTicketId$
      .pipe(
        filter((id): id is string => !!id),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => showBillingModal(this.detailModal));

    watchBillingMutationModalClose({
      loading$: this.saving$,
      error$: this.error$,
      modal: () => this.createModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.createParentId.set(null);
        this.resetCreateForm();
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

  laneLabel(status: string): string {
    return projectTicketLaneStatusLabel(status);
  }

  milestoneLabel(milestoneId: string | null | undefined): string {
    if (!milestoneId) {
      return $localize`:@@featureProjectBoard-milestoneNone:None`;
    }

    return this.milestones().find((m) => m.id === milestoneId)?.name ?? milestoneId;
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

    this.ticketsFacade.openDetail(ticket.id);
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
    const modalEl = this.globalSearchModal?.nativeElement;

    if (isEditableDomTarget(target)) {
      if (modalEl && target instanceof Node && modalEl.contains(target)) {
        event.preventDefault();
        this.globalSearchInput?.nativeElement?.focus();
      }

      return;
    }

    event.preventDefault();
    this.openGlobalSearchModal();
  }

  openGlobalSearchModal(): void {
    this.globalSearchQuery.set('');
    setTimeout(() => {
      const shell = this.globalSearchModal?.nativeElement;

      if (shell?.classList.contains('show')) {
        this.globalSearchInput?.nativeElement?.focus({ preventScroll: true });

        return;
      }

      this.showGlobalSearchModal();
    }, 0);
  }

  onCloseGlobalSearchModal(): void {
    if (this.globalSearchModal) {
      hideBillingModal(this.globalSearchModal);
    }

    this.globalSearchQuery.set('');
  }

  onGlobalSearchResultClick(hit: ProjectTicketGlobalSearchHit): void {
    this.onCloseGlobalSearchModal();
    this.ticketsFacade.openDetail(hit.ticket.id);
  }

  globalSearchPathDisplay(hit: ProjectTicketGlobalSearchHit): string {
    const titles = hit.pathTitles;

    if (titles.length <= 1) {
      return '';
    }

    return titles.slice(0, -1).join(' › ');
  }

  onBreadcrumbNavigate(ticketId: string): void {
    this.ticketsFacade.openDetail(ticketId);
  }

  openSubtaskDetail(ticketId: string): void {
    this.ticketsFacade.openDetail(ticketId);
  }

  closeDetail(): void {
    this.detailSuspendedForCreateSubtask = false;
    hideBillingModal(this.detailModal);
    this.detailTitleEditing.set(false);
    this.ticketsFacade.closeDetail();
    this.commentBody.set('');
  }

  showCreateTicketModal(): void {
    if (!this.isAdmin) return;

    this.createParentId.set(null);
    this.resetCreateForm();
    showBillingModal(this.createModal);
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

    const createEl = this.createModal?.nativeElement;

    if (createEl?.classList.contains('show')) {
      return;
    }

    if (this.detailSuspendedForCreateSubtask) {
      return;
    }

    const detailEl = this.detailModal?.nativeElement;

    if (!detailEl?.classList.contains('show')) {
      queueMicrotask(() => showBillingModal(this.createModal));

      return;
    }

    this.detailSuspendedForCreateSubtask = true;

    const onDetailHidden = (): void => {
      queueMicrotask(() => {
        if (!this.createModal?.nativeElement) {
          this.detailSuspendedForCreateSubtask = false;
          showBillingModal(this.detailModal);

          return;
        }

        showBillingModal(this.createModal);
        this.registerReopenDetailAfterCreateModal();
      });
    };

    detailEl.addEventListener('hidden.bs.modal', onDetailHidden, { once: true });
    hideBillingModal(this.detailModal);
  }

  closeCreateModal(): void {
    hideBillingModal(this.createModal);
    this.createParentId.set(null);
    this.resetCreateForm();
  }

  /** After create modal hides, restore ticket detail if it was swapped out for subtask creation. */
  private registerReopenDetailAfterCreateModal(): void {
    const el = this.createModal?.nativeElement;

    if (!el) {
      return;
    }

    const onCreateHidden = (): void => {
      if (!this.detailSuspendedForCreateSubtask) {
        return;
      }

      this.detailSuspendedForCreateSubtask = false;
      queueMicrotask(() => showBillingModal(this.detailModal));
    };

    el.addEventListener('hidden.bs.modal', onCreateHidden, { once: true });
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

  onDetailTitleClick(ticket: ProjectTicketResponse): void {
    if (!this.isAdmin || ticket.locked) return;

    this.detailTitleDraft.set(ticket.title);
    this.detailTitleEditing.set(true);
    afterNextRender(
      () => {
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

    if (!ticketId || !body) return;

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

  private showGlobalSearchModal(): void {
    const modal = this.globalSearchModal;

    if (!modal) {
      return;
    }

    const focusSearchInput = (): void => {
      this.globalSearchInput?.nativeElement?.focus({ preventScroll: true });
    };

    modal.nativeElement.addEventListener('shown.bs.modal', focusSearchInput, { once: true });
    showBillingModal(modal);
  }
}
