import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ClientsFacade,
  KnowledgeFacade,
  KnowledgeBoardSocketFacade,
  KnowledgeService,
  TicketsFacade,
  type ClientResponseDto,
  type AttachmentResponseDto,
  type KnowledgeNodeDto,
  type KnowledgeNodeType,
  type KnowledgePageActivityDto,
  type KnowledgeRelationDto,
  type TicketResponseDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcDatePipe,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormTextDirective,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSectionColumnComponent,
  FpcSectionRowComponent,
  FpcTableCellDirective,
  FpcTypeaheadSelectComponent,
  type FpcBadgeTone,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import {
  EMPTY,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  of,
  skip,
  switchMap,
} from 'rxjs';

import { resolveNamedDisplayLabel } from '../display-name.util';
import { KnowledgeEditorComponent } from './knowledge-editor/knowledge-editor.component';
import { KnowledgeTreeComponent } from './knowledge-tree/knowledge-tree.component';
import { AttachmentChipsComponent } from '../shared/attachment-chips.component';
import { WorkspaceChipComponent } from '../shared/workspace-chip.component';
import { WorkspaceSwitchTableComponent } from '../shared/workspace-switch-table.component';

@Component({
  selector: 'framework-knowledge-board',
  standalone: true,
  imports: [
    FpcDatePipe,
    FpcDataTableComponent,
    FpcFormTextDirective,
    FpcTableCellDirective,
    FpcSectionRowComponent,
    FpcSectionColumnComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    KnowledgeTreeComponent,
    KnowledgeEditorComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcModalComponent,
    AttachmentChipsComponent,
    WorkspaceChipComponent,
    WorkspaceSwitchTableComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcTypeaheadSelectComponent,
  ],
  templateUrl: './knowledge-board.component.html',
  styleUrls: ['./knowledge-board.component.scss'],
})
export class KnowledgeBoardComponent implements AfterViewInit, OnDestroy {
  readonly pageTitle = $localize`:@@featureKnowledgeBoard-title:Knowledge`;
  readonly switchWorkspaceTitle = $localize`:@@featureKnowledgeBoard-switchWorkspaceTitle:Switch workspace`;

  private readonly RELATION_TARGET_KIND_KNOWLEDGE = 'knowledge';
  private readonly RELATION_TARGET_KIND_TICKET = 'ticket';
  @ViewChild(KnowledgeTreeComponent, { static: false })
  private knowledgeTreeComponent?: KnowledgeTreeComponent;
  @ViewChild('knowledgeTreeSidebar', { static: false, read: ElementRef })
  private knowledgeTreeSidebar?: ElementRef<HTMLDivElement>;
  @ViewChild('selectedNodeTitleInput', { static: false })
  private selectedNodeTitleInput?: ElementRef<HTMLElement>;
  @ViewChild('relationsSearchInput', { static: false })
  private relationsSearchInput?: ElementRef<HTMLElement>;

  private readonly clientsFacade = inject(ClientsFacade);
  private readonly knowledgeFacade = inject(KnowledgeFacade);
  private readonly knowledgeService = inject(KnowledgeService);
  private readonly knowledgeBoardSocketFacade = inject(KnowledgeBoardSocketFacade);
  private readonly ticketsFacade = inject(TicketsFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);
  readonly workspaceSwitchModalOpen = signal(false);
  readonly relationsModalOpen = signal(false);

  private readonly SIDEBAR_MIN_WIDTH = 150;
  private readonly SIDEBAR_MAX_WIDTH = 600;
  readonly sidebarWidth = signal<number>(300);
  private isResizing = false;
  private readonly boundOnResizeMove = this.onResizeMove.bind(this);
  private readonly boundOnResizeEnd = this.onResizeEnd.bind(this);

  readonly activeClientId = toSignal(this.clientsFacade.activeClientId$, { initialValue: null });
  /** Workspace for this board: URL `:clientId` wins so deep links load before store catches up. */
  readonly effectiveClientId$ = combineLatest([this.route.paramMap, this.clientsFacade.activeClientId$]).pipe(
    map(([params, active]) => {
      const fromRoute = params.get('clientId')?.trim();

      return (fromRoute || active || null) as string | null;
    }),
    distinctUntilChanged(),
  );
  readonly effectiveClientId = toSignal(this.effectiveClientId$, { initialValue: null });
  readonly clients = toSignal(this.clientsFacade.clients$, { initialValue: [] });
  readonly tree = toSignal(this.knowledgeFacade.tree$, { initialValue: [] });
  readonly selectedNode = toSignal(this.knowledgeFacade.selectedNode$, { initialValue: null });
  readonly tickets = toSignal(this.ticketsFacade.tickets$, { initialValue: [] as TicketResponseDto[] });
  readonly loading = toSignal(this.knowledgeFacade.loading$, { initialValue: false });
  readonly mutatingIds = toSignal(this.knowledgeFacade.mutatingIds$, {
    initialValue: new Set<string>(),
  });
  readonly relations = toSignal(this.knowledgeFacade.relations$, { initialValue: [] });
  readonly relationsLoading = toSignal(this.knowledgeFacade.relationsLoading$, { initialValue: false });
  readonly activity = toSignal(this.knowledgeFacade.activity$, { initialValue: [] as KnowledgePageActivityDto[] });
  readonly activityLabel = $localize`:@@featureKnowledgeBoard-activityHeading:Activity`;
  /** Activity feed as a nested table like the ticket details: Action (state badge) · Time · Actor. */
  readonly activityColumns: FpcTableColumn<KnowledgePageActivityDto>[] = [
    {
      id: 'action',
      label: $localize`:@@featureKnowledgeBoard-colActivityAction:Action`,
      type: 'state',
      state: (event) => ({
        label: this.activityActionLabel(event.actionType),
        tone: this.activityActionBadgeTone(event.actionType),
      }),
      iconOnly: false,
    },
    {
      id: 'time',
      label: $localize`:@@featureKnowledgeBoard-colActivityTime:Time`,
      value: (event) => event.occurredAt,
      required: true,
      priority: 1,
    },
    {
      id: 'actor',
      label: $localize`:@@featureKnowledgeBoard-colActivityActor:Actor`,
      value: (event) => event.actorEmail ?? event.actorType,
      priority: 1,
    },
  ];
  readonly activityLoading = toSignal(this.knowledgeFacade.activityLoading$, { initialValue: false });
  readonly error = toSignal(this.knowledgeFacade.error$, { initialValue: null });

  readonly editContent = signal('');
  readonly selectedNodeTitleDraft = signal('');
  readonly selectedNodeTitleEditing = signal(false);
  private readonly pendingSelectedNodeTitleRename = signal<{ nodeId: string; sentTitle: string } | null>(null);
  private titleEditSyncNodeId: string | null = null;
  private skipSelectionClearForOpenNodeCleanup = false;
  readonly workspaceSwitchSearch = signal('');
  readonly workspaceSwitchSearch$ = toObservable(this.workspaceSwitchSearch);
  /** Tree toolbar search: the server returns the matches with their ancestor folders. */
  readonly treeSearch = signal('');
  /** Results of the current search (`null` until the first response arrives, and while no search is active). */
  readonly treeSearchResults = signal<KnowledgeNodeDto[] | null>(null);
  readonly treeSearchLoading = signal(false);
  readonly treeSearching = computed(() => !!this.treeSearch().trim() && this.treeSearchResults() !== null);
  readonly treeNodes = computed(() => (this.treeSearching() ? (this.treeSearchResults() ?? []) : this.tree()));
  readonly relationsSearchQuery = signal('');
  readonly relationSuggestionsOpen = signal(false);
  readonly selectedRelationTargets = signal<
    Array<{ kind: 'knowledge'; nodeId: string } | { kind: 'ticket'; ticketLongSha: string }>
  >([]);
  readonly pendingOpenNodeId = signal<string | null>(null);

  readonly effectiveWorkspace = computed(() => {
    const id = this.effectiveClientId();
    const clients = this.clients();

    return id ? (clients.find((c) => c.id === id) ?? null) : null;
  });

  workspaceDisplayName(name: string | null | undefined): string {
    return resolveNamedDisplayLabel(name);
  }

  relationKnowledgeTitle(title: string | null | undefined): string {
    return resolveNamedDisplayLabel(title);
  }

  readonly relationCandidates = computed(() => {
    const selected = this.selectedNode();
    const clientId = this.activeClientId();
    const query = this.relationsSearchQuery().trim().toLowerCase();

    if (!selected || selected.nodeType !== 'page' || !clientId || !query.length) {
      return [];
    }

    const existingTargetNodeIds = new Set(
      this.relations()
        .map((relation) => relation.targetNodeId ?? null)
        .filter((targetId): targetId is string => targetId !== null),
    );
    const existingTicketShas = new Set(
      this.relations()
        .map((relation) => relation.targetTicketLongSha ?? null)
        .filter((sha): sha is string => sha !== null),
    );
    const candidates: Array<
      { kind: 'knowledge'; node: KnowledgeNodeDto } | { kind: 'ticket'; ticket: TicketResponseDto }
    > = [];
    const walk = (nodes: KnowledgeNodeDto[]) => {
      for (const node of nodes) {
        if (node.id !== selected.id && (node.nodeType === 'page' || node.nodeType === 'folder')) {
          const matchesQuery =
            !query || node.title.toLowerCase().includes(query) || node.shas.short.toLowerCase().includes(query);

          if (matchesQuery && !existingTargetNodeIds.has(node.id)) {
            candidates.push({ kind: this.RELATION_TARGET_KIND_KNOWLEDGE, node });
          }
        }

        walk(node.children ?? []);
      }
    };

    walk(this.tree());

    for (const ticket of this.tickets()) {
      if (ticket.clientId !== clientId || !ticket.shas?.long) {
        continue;
      }

      const shortSha = ticket.shas.short.toLowerCase();
      const longSha = ticket.shas.long.toLowerCase();
      const title = (ticket.title ?? '').toLowerCase();
      const matchesQuery = title.includes(query) || shortSha.includes(query) || longSha.includes(query);

      if (!matchesQuery || existingTicketShas.has(ticket.shas.long)) {
        continue;
      }

      candidates.push({ kind: this.RELATION_TARGET_KIND_TICKET, ticket });
    }

    return candidates;
  });

  constructor() {
    this.clientsFacade.loadClients();

    this.workspaceSwitchSearch$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.clientsFacade.loadClients({ search: search.trim() || undefined });
      });

    // Re-runs on every tree reload too (create / rename / move / realtime), so the results stay current.
    combineLatest([
      toObservable(this.treeSearch).pipe(
        map((query) => query.trim()),
        debounceTime(300),
        distinctUntilChanged(),
      ),
      toObservable(this.tree),
    ])
      .pipe(
        switchMap(([query]) => {
          const clientId = this.activeClientId();

          if (!query || !clientId) {
            this.treeSearchResults.set(null);
            this.treeSearchLoading.set(false);

            return EMPTY;
          }

          this.treeSearchLoading.set(true);

          return this.knowledgeService.getTree(clientId, query).pipe(
            catchError(() => of([] as KnowledgeNodeDto[])),
            finalize(() => this.treeSearchLoading.set(false)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => this.treeSearchResults.set(results));

    this.clientsFacade.activeClientId$
      .pipe(
        distinctUntilChanged(),
        switchMap((clientId) => {
          if (!clientId) {
            this.knowledgeBoardSocketFacade.disconnect();

            return EMPTY;
          }

          return this.knowledgeBoardSocketFacade.ensureConnectedAndSetClient(clientId);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    effect(() => {
      const selected = this.selectedNode();
      const selectedId = selected?.id ?? null;

      if (selected?.nodeType === 'page') {
        this.editContent.set(selected.content ?? '');

        if (this.titleEditSyncNodeId !== selectedId) {
          this.titleEditSyncNodeId = selectedId;
          this.selectedNodeTitleDraft.set(selected.title);
          this.selectedNodeTitleEditing.set(false);
          this.pendingSelectedNodeTitleRename.set(null);
        }
      } else {
        this.titleEditSyncNodeId = null;
        this.selectedNodeTitleDraft.set('');
        this.selectedNodeTitleEditing.set(false);
        this.pendingSelectedNodeTitleRename.set(null);
      }
    });

    effect(() => {
      const loading = this.loading();
      const pending = this.pendingSelectedNodeTitleRename();
      const editing = this.selectedNodeTitleEditing();
      const selected = this.selectedNode();

      if (loading || !pending || !editing) {
        return;
      }

      if (!selected || selected.id !== pending.nodeId || selected.nodeType !== 'page') {
        this.pendingSelectedNodeTitleRename.set(null);

        return;
      }

      if (selected.title.trim() === pending.sentTitle.trim()) {
        this.selectedNodeTitleEditing.set(false);
        this.pendingSelectedNodeTitleRename.set(null);

        return;
      }

      this.pendingSelectedNodeTitleRename.set(null);
      setTimeout(() => this.focusSelectedNodeTitleInput(), 0);
    });

    effect(() => {
      const activeClientId = this.activeClientId();

      if (activeClientId) {
        this.knowledgeFacade.loadTree(activeClientId);
        this.ticketsFacade.loadTickets({ clientId: activeClientId });
      }
    });

    effect(() => {
      const selected = this.selectedNode();
      const activeClientId = this.activeClientId();

      if (selected?.nodeType !== 'page' || !activeClientId) {
        return;
      }

      this.knowledgeFacade.loadRelations(activeClientId, 'page', selected.id);
      this.knowledgeFacade.loadActivity(selected.id);
    });

    effect(() => {
      const targetNodeId = this.pendingOpenNodeId();
      const tree = this.tree();
      const treeComponent = this.knowledgeTreeComponent;

      if (!targetNodeId || !tree.length || !treeComponent) {
        return;
      }

      const target = this.treeNodeById(targetNodeId);

      if (!target) {
        return;
      }

      if (target.nodeType === 'folder') {
        treeComponent.expandPathToNode(target.id, true);
      } else {
        treeComponent.expandPathToNode(target.id, false);
        this.knowledgeFacade.selectNode(target.id);
      }

      this.pendingOpenNodeId.set(null);
      this.skipSelectionClearForOpenNodeCleanup = true;
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { openNodeId: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const routeClientId = params.get('clientId');

      if (routeClientId && routeClientId !== this.activeClientId()) {
        this.clientsFacade.setActiveClient(routeClientId);
        this.knowledgeFacade.loadTree(routeClientId);
      }
    });

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const openNodeId = params.get('openNodeId')?.trim();

      if (openNodeId) {
        this.pendingOpenNodeId.set(openNodeId);

        return;
      }

      if (this.skipSelectionClearForOpenNodeCleanup) {
        this.skipSelectionClearForOpenNodeCleanup = false;

        return;
      }

      // Plain board navigation (no deep-link) should not keep a stale page selection.
      this.pendingOpenNodeId.set(null);
      this.knowledgeFacade.selectNode(null);
    });
  }

  ngAfterViewInit(): void {
    this.effectiveClientId$
      .pipe(
        distinctUntilChanged(),
        filter((id) => !id),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        setTimeout(() => this.openWorkspaceSwitchModal(), 0);
      });
  }

  openWorkspaceSwitchModal(): void {
    this.workspaceSwitchSearch.set('');
    this.clientsFacade.loadClients();
    this.workspaceSwitchModalOpen.set(true);
  }

  onCloseWorkspaceSwitchModal(): void {
    this.workspaceSwitchModalOpen.set(false);
  }

  goToSpaces(event?: Event): void {
    event?.preventDefault();
    this.workspaceSwitchModalOpen.set(false);
    void this.router.navigate(['/clients']);
  }

  onTreeSearchChange(query: string): void {
    this.treeSearch.set(query);

    if (!query.trim()) {
      this.treeSearchResults.set(null);
    }
  }

  onSelectWorkspaceForKnowledge(client: ClientResponseDto): void {
    this.workspaceSwitchModalOpen.set(false);
    this.clientsFacade.setActiveClient(client.id);
    this.knowledgeFacade.loadTree(client.id);
    this.knowledgeFacade.selectNode(null);
    void this.router.navigate(['/knowledge', client.id]);
  }

  onCreateNode(event: { parentId: string | null; nodeType: KnowledgeNodeType; title: string }): void {
    const clientId = this.activeClientId();

    if (!clientId) return;

    this.knowledgeFacade.createNode({
      clientId,
      parentId: event.parentId,
      title: event.title,
      nodeType: event.nodeType,
      content: event.nodeType === 'page' ? '' : undefined,
    });
  }

  onSelectNode(node: KnowledgeNodeDto): void {
    if (node.nodeType === 'folder' && this.selectedNode()?.nodeType === 'page') {
      return;
    }

    this.knowledgeFacade.selectNode(node.id);
  }

  onRefreshTree(): void {
    const clientId = this.activeClientId();

    if (!clientId) return;

    this.knowledgeFacade.loadTree(clientId);
  }

  onRenameNode(event: { id: string; title: string }): void {
    this.knowledgeFacade.updateNode(event.id, { title: event.title });
  }

  onMoveNode(event: { id: string; parentId: string | null }): void {
    this.knowledgeFacade.updateNode(event.id, { parentId: event.parentId });
  }

  onSavePageTitle(): void {
    const selected = this.selectedNode();
    const title = this.selectedNodeTitleDraft().trim();

    if (!selected || selected.nodeType !== 'page') return;

    if (selected.title.trim() === title) {
      this.selectedNodeTitleEditing.set(false);

      return;
    }

    if (!title.length) {
      this.selectedNodeTitleDraft.set(selected.title);
      this.selectedNodeTitleEditing.set(false);

      return;
    }

    this.pendingSelectedNodeTitleRename.set({ nodeId: selected.id, sentTitle: title });
    this.knowledgeFacade.updateNode(selected.id, { title });
  }

  onSelectedNodeTitleClick(): void {
    const selected = this.selectedNode();

    if (selected?.nodeType !== 'page') return;

    this.selectedNodeTitleDraft.set(selected.title);
    this.selectedNodeTitleEditing.set(true);
    setTimeout(() => this.focusSelectedNodeTitleInput(), 0);
  }

  onSelectedNodeTitleCancel(): void {
    const selected = this.selectedNode();

    this.selectedNodeTitleEditing.set(false);
    this.pendingSelectedNodeTitleRename.set(null);

    if (selected?.nodeType === 'page') {
      this.selectedNodeTitleDraft.set(selected.title);
    }
  }

  onSavePage(): void {
    const selected = this.selectedNode();

    if (!selected || selected.nodeType !== 'page') {
      return;
    }

    this.knowledgeFacade.updateNode(selected.id, { content: this.editContent() });
  }

  onPageAttachmentSelected(event: Event, node: KnowledgeNodeDto | null): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);

    if (!node || node.nodeType !== 'page' || files.length === 0) {
      return;
    }

    for (const file of files) {
      this.knowledgeService
        .uploadAttachment(node.id, file)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: () => this.knowledgeFacade.loadTree(node.clientId) });
    }

    input.value = '';
  }

  downloadPageAttachment(attachment: AttachmentResponseDto): void {
    this.knowledgeService
      .downloadAttachment(attachment)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => this.saveBlob(blob, attachment.fileName));
  }

  deletePageAttachment(node: KnowledgeNodeDto | null, attachment: AttachmentResponseDto): void {
    if (!node || node.nodeType !== 'page') {
      return;
    }

    this.knowledgeService
      .deleteAttachment(node.id, attachment.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.knowledgeFacade.removeAttachment(node.id, attachment.id));
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  openRelationsModal(): void {
    this.relationsSearchQuery.set('');
    this.relationSuggestionsOpen.set(false);
    this.selectedRelationTargets.set([]);
    this.relationsModalOpen.set(true);
    setTimeout(() => this.focusRelationsSearchInput({ preventScroll: true }), 0);
  }

  onCloseRelationsModal(): void {
    this.relationsModalOpen.set(false);
    this.relationsSearchQuery.set('');
    this.relationSuggestionsOpen.set(false);
    this.selectedRelationTargets.set([]);
  }

  onRelationInputChange(value: string): void {
    this.relationsSearchQuery.set(value);
    this.relationSuggestionsOpen.set(value.trim().length > 0 && this.relationCandidates().length > 0);
  }

  onRelationSuggestionsOpenChange(open: boolean): void {
    this.relationSuggestionsOpen.set(
      open && this.relationsSearchQuery().trim().length > 0 && this.relationCandidates().length > 0,
    );
  }

  onPickRelationCandidate(
    candidate: { kind: 'knowledge'; node: KnowledgeNodeDto } | { kind: 'ticket'; ticket: TicketResponseDto },
    event?: Event,
  ): void {
    event?.preventDefault();
    this.addRelationCandidate(candidate);
    this.relationsSearchQuery.set('');
    this.relationSuggestionsOpen.set(false);
  }

  onAddSelectedRelations(): void {
    const selected = this.selectedNode();
    const clientId = this.activeClientId();
    const targets = this.selectedRelationTargets();

    if (!selected || !clientId || !targets.length) {
      return;
    }

    for (const target of targets) {
      if (target.kind === this.RELATION_TARGET_KIND_TICKET) {
        this.knowledgeFacade.createRelation({
          clientId,
          sourceType: 'page',
          sourceId: selected.id,
          targetType: 'ticket',
          targetTicketSha: target.ticketLongSha,
        });

        continue;
      }

      const targetNode = this.treeNodeById(target.nodeId);

      if (!targetNode) {
        continue;
      }

      this.knowledgeFacade.createRelation({
        clientId,
        sourceType: 'page',
        sourceId: selected.id,
        targetType: targetNode.nodeType,
        targetNodeId: targetNode.id,
      });
    }

    this.onCloseRelationsModal();
  }

  onRemoveRelation(relation: KnowledgeRelationDto): void {
    this.knowledgeFacade.deleteRelation(relation.id);
  }

  /** Every backend `KnowledgeActionType` has a label; the fallback only covers types added later. */
  activityActionLabel(actionType: string): string {
    switch (actionType) {
      case 'CREATED':
        return $localize`:@@featureKnowledgeBoard-activityCreated:Created`;
      case 'FIELD_UPDATED':
        return $localize`:@@featureKnowledgeBoard-activityFieldUpdated:Details updated`;
      case 'CONTENT_UPDATED':
        return $localize`:@@featureKnowledgeBoard-activityContentUpdated:Content updated`;
      case 'PARENT_CHANGED':
        return $localize`:@@featureKnowledgeBoard-activityParentChanged:Parent changed`;
      case 'SORT_ORDER_CHANGED':
        return $localize`:@@featureKnowledgeBoard-activitySortOrderChanged:Order changed`;
      case 'DELETED':
        return $localize`:@@featureKnowledgeBoard-activityDeleted:Deleted`;
      case 'DUPLICATED':
        return $localize`:@@featureKnowledgeBoard-activityDuplicated:Duplicated`;
      case 'RELATION_ADDED':
        return $localize`:@@featureKnowledgeBoard-activityRelationAdded:Relation added`;
      case 'RELATION_REMOVED':
        return $localize`:@@featureKnowledgeBoard-activityRelationRemoved:Relation removed`;
      case 'ATTACHMENT_ADDED':
        return $localize`:@@featureKnowledgeBoard-activityAttachmentAdded:Attachment added`;
      case 'ATTACHMENT_REMOVED':
        return $localize`:@@featureKnowledgeBoard-activityAttachmentRemoved:Attachment removed`;
      default:
        return $localize`:@@featureKnowledgeBoard-activityUnknown:Unknown activity`;
    }
  }

  activityActionBadgeTone(actionType: string): FpcBadgeTone {
    switch (actionType) {
      case 'CREATED':
      case 'DUPLICATED':
        return 'success';
      case 'CONTENT_UPDATED':
      case 'FIELD_UPDATED':
        return 'neutral';
      case 'PARENT_CHANGED':
      case 'SORT_ORDER_CHANGED':
        return 'primary';
      case 'RELATION_ADDED':
      case 'ATTACHMENT_ADDED':
        return 'info';
      case 'RELATION_REMOVED':
      case 'ATTACHMENT_REMOVED':
      case 'DELETED':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  onRelationClick(relation: KnowledgeRelationDto): void {
    if (relation.targetType === 'ticket') {
      const clientId = this.activeClientId();
      const longSha = relation.targetTicketLongSha ?? null;

      if (!clientId || !longSha) {
        return;
      }

      const ticket = this.ticketByLongSha(longSha);

      if (!ticket) {
        return;
      }

      this.clientsFacade.setActiveClient(clientId);
      void this.router.navigate(['/tickets', clientId], {
        queryParams: { openTicketId: ticket.id },
      });

      return;
    }

    const targetNodeId = relation.targetNodeId;

    if (!targetNodeId) {
      return;
    }

    const target = this.treeNodeById(targetNodeId);

    if (!target) {
      return;
    }

    if (target.nodeType === 'folder') {
      this.knowledgeTreeComponent?.expandPathToNode(target.id, true);

      return;
    }

    this.knowledgeTreeComponent?.expandPathToNode(target.id, false);
    this.knowledgeFacade.selectNode(target.id);
  }

  relationNodeById(targetNodeId?: string | null): KnowledgeNodeDto | null {
    if (!targetNodeId) {
      return null;
    }

    const find = (nodes: KnowledgeNodeDto[]): KnowledgeNodeDto | null => {
      for (const node of nodes) {
        if (node.id === targetNodeId) {
          return node;
        }

        const child = find(node.children ?? []);

        if (child) {
          return child;
        }
      }

      return null;
    };

    return find(this.tree());
  }

  relationCandidateDisplay(nodeId: string): string {
    const node = this.treeNodeById(nodeId);

    if (!node) {
      return `Unavailable knowledge (${nodeId.slice(0, 7)})`;
    }

    const type = node.nodeType === 'folder' ? 'Folder' : 'Page';

    return `${type}: ${node.title} (${node.shas.short})`;
  }

  relationTargetTrackId(
    target: { kind: 'knowledge'; nodeId: string } | { kind: 'ticket'; ticketLongSha: string },
  ): string {
    return target.kind === this.RELATION_TARGET_KIND_KNOWLEDGE
      ? `knowledge:${target.nodeId}`
      : `ticket:${target.ticketLongSha}`;
  }

  relationCandidateChipDisplay(
    target: { kind: 'knowledge'; nodeId: string } | { kind: 'ticket'; ticketLongSha: string },
  ): string {
    if (target.kind === this.RELATION_TARGET_KIND_TICKET) {
      const ticket = this.ticketByLongSha(target.ticketLongSha);

      if (!ticket) {
        return `Ticket: Unavailable ticket (${target.ticketLongSha.slice(0, 7)})`;
      }

      return `Ticket: ${ticket.title ?? ''} (${ticket.shas.short})`;
    }

    return this.relationCandidateDisplay(target.nodeId);
  }

  onRemovePendingRelation(
    target: { kind: 'knowledge'; nodeId: string } | { kind: 'ticket'; ticketLongSha: string },
  ): void {
    const trackId = this.relationTargetTrackId(target);

    this.selectedRelationTargets.set(
      this.selectedRelationTargets().filter((item) => this.relationTargetTrackId(item) !== trackId),
    );
  }

  relationTicketDisplay(longSha?: string | null): string {
    if (!longSha) {
      return 'Unavailable ticket';
    }

    const ticket = this.ticketByLongSha(longSha);

    if (!ticket) {
      return 'Unavailable ticket';
    }

    return ticket.title ?? 'Untitled ticket';
  }

  relationTicketShortSha(longSha?: string | null): string {
    if (!longSha) {
      return '';
    }

    const ticket = this.ticketByLongSha(longSha);

    if (!ticket?.shas?.short) {
      return longSha.slice(0, 7);
    }

    return ticket.shas.short;
  }

  private addRelationCandidate(
    candidate: { kind: 'knowledge'; node: KnowledgeNodeDto } | { kind: 'ticket'; ticket: TicketResponseDto },
  ): void {
    const current = this.selectedRelationTargets();
    const nextTarget =
      candidate.kind === this.RELATION_TARGET_KIND_KNOWLEDGE
        ? ({ kind: this.RELATION_TARGET_KIND_KNOWLEDGE, nodeId: candidate.node.id } as const)
        : ({ kind: this.RELATION_TARGET_KIND_TICKET, ticketLongSha: candidate.ticket.shas.long } as const);
    const nextTargetId = this.relationTargetTrackId(nextTarget);

    if (!current.some((item) => this.relationTargetTrackId(item) === nextTargetId)) {
      this.selectedRelationTargets.set([...current, nextTarget]);
    }
  }

  private ticketByLongSha(longSha: string): TicketResponseDto | null {
    return this.tickets().find((ticket) => ticket.shas?.long === longSha) ?? null;
  }

  private treeNodeById(nodeId: string): KnowledgeNodeDto | null {
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

    return find(this.tree());
  }

  onResizeStart(event: MouseEvent | TouchEvent): void {
    event.preventDefault();
    this.isResizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    this.ngZone.runOutsideAngular(() => {
      document.addEventListener('mousemove', this.boundOnResizeMove);
      document.addEventListener('mouseup', this.boundOnResizeEnd);
      document.addEventListener('touchmove', this.boundOnResizeMove);
      document.addEventListener('touchend', this.boundOnResizeEnd);
    });
  }

  private onResizeMove(event: MouseEvent | TouchEvent): void {
    if (!this.isResizing) return;

    const sidebarEl = this.knowledgeTreeSidebar?.nativeElement;

    if (!sidebarEl) return;

    const containerRect = sidebarEl.parentElement?.getBoundingClientRect();

    if (!containerRect) return;

    const clientX = event instanceof MouseEvent ? event.clientX : event.touches[0].clientX;
    let newWidth = clientX - containerRect.left;

    newWidth = Math.max(this.SIDEBAR_MIN_WIDTH, Math.min(this.SIDEBAR_MAX_WIDTH, newWidth));
    sidebarEl.style.flexBasis = `${newWidth}px`;
    this.ngZone.run(() => this.sidebarWidth.set(newWidth));
  }

  private onResizeEnd(): void {
    if (!this.isResizing) return;

    this.isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', this.boundOnResizeMove);
    document.removeEventListener('mouseup', this.boundOnResizeEnd);
    document.removeEventListener('touchmove', this.boundOnResizeMove);
    document.removeEventListener('touchend', this.boundOnResizeEnd);
  }

  ngOnDestroy(): void {
    document.removeEventListener('mousemove', this.boundOnResizeMove);
    document.removeEventListener('mouseup', this.boundOnResizeEnd);
    document.removeEventListener('touchmove', this.boundOnResizeMove);
    document.removeEventListener('touchend', this.boundOnResizeEnd);
  }

  private focusSelectedNodeTitleInput(options?: FocusOptions): void {
    this.selectedNodeTitleInput?.nativeElement?.querySelector<HTMLInputElement>('input')?.focus(options);
  }

  private focusRelationsSearchInput(options?: FocusOptions): void {
    this.relationsSearchInput?.nativeElement?.querySelector<HTMLInputElement>('input')?.focus(options);
  }
}
