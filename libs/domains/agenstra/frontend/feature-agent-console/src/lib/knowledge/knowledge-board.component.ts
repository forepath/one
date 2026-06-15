import { CommonModule } from '@angular/common';
import {
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
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ClientsFacade,
  KnowledgeFacade,
  KnowledgeBoardSocketFacade,
  TicketsFacade,
  type ClientResponseDto,
  type KnowledgeNodeDto,
  type KnowledgeNodeType,
  type KnowledgePageActivityDto,
  type KnowledgeRelationDto,
  type TicketResponseDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { EMPTY, distinctUntilChanged, switchMap } from 'rxjs';

import { KnowledgeEditorComponent } from './knowledge-editor/knowledge-editor.component';
import { KnowledgeTreeComponent } from './knowledge-tree/knowledge-tree.component';

@Component({
  selector: 'framework-knowledge-board',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, KnowledgeTreeComponent, KnowledgeEditorComponent],
  templateUrl: './knowledge-board.component.html',
  styleUrls: ['./knowledge-board.component.scss'],
})
export class KnowledgeBoardComponent implements OnDestroy {
  private readonly RELATION_TARGET_KIND_KNOWLEDGE = 'knowledge';
  private readonly RELATION_TARGET_KIND_TICKET = 'ticket';
  @ViewChild(KnowledgeTreeComponent, { static: false })
  private knowledgeTreeComponent?: KnowledgeTreeComponent;
  @ViewChild('workspaceSwitchModal', { static: false })
  private workspaceSwitchModal?: ElementRef<HTMLDivElement>;
  @ViewChild('knowledgeTreeSidebar', { static: false })
  private knowledgeTreeSidebar?: ElementRef<HTMLDivElement>;
  @ViewChild('globalSearchModal', { static: false })
  private globalSearchModal?: ElementRef<HTMLDivElement>;
  @ViewChild('globalSearchInput', { static: false })
  private globalSearchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('selectedNodeTitleInput', { static: false })
  private selectedNodeTitleInput?: ElementRef<HTMLInputElement>;
  @ViewChild('relationsModal', { static: false })
  private relationsModal?: ElementRef<HTMLDivElement>;
  @ViewChild('relationsSearchInput', { static: false })
  private relationsSearchInput?: ElementRef<HTMLInputElement>;

  private readonly clientsFacade = inject(ClientsFacade);
  private readonly knowledgeFacade = inject(KnowledgeFacade);
  private readonly knowledgeBoardSocketFacade = inject(KnowledgeBoardSocketFacade);
  private readonly ticketsFacade = inject(TicketsFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);
  private workspaceSwitchModalInstance: { show: () => void; hide: () => void } | null = null;
  private openedWorkspaceModalForMissingClient = false;
  private readonly SIDEBAR_MIN_WIDTH = 150;
  private readonly SIDEBAR_MAX_WIDTH = 600;
  readonly sidebarWidth = signal<number>(300);
  private isResizing = false;
  private readonly boundOnResizeMove = this.onResizeMove.bind(this);
  private readonly boundOnResizeEnd = this.onResizeEnd.bind(this);

  readonly activeClientId = toSignal(this.clientsFacade.activeClientId$, { initialValue: null });
  readonly clients = toSignal(this.clientsFacade.clients$, { initialValue: [] });
  readonly tree = toSignal(this.knowledgeFacade.tree$, { initialValue: [] });
  readonly selectedNode = toSignal(this.knowledgeFacade.selectedNode$, { initialValue: null });
  readonly tickets = toSignal(this.ticketsFacade.tickets$, { initialValue: [] as TicketResponseDto[] });
  readonly loading = toSignal(this.knowledgeFacade.loading$, { initialValue: false });
  readonly relations = toSignal(this.knowledgeFacade.relations$, { initialValue: [] });
  readonly relationsLoading = toSignal(this.knowledgeFacade.relationsLoading$, { initialValue: false });
  readonly activity = toSignal(this.knowledgeFacade.activity$, { initialValue: [] as KnowledgePageActivityDto[] });
  readonly activityLoading = toSignal(this.knowledgeFacade.activityLoading$, { initialValue: false });
  readonly error = toSignal(this.knowledgeFacade.error$, { initialValue: null });

  readonly editContent = signal('');
  readonly selectedNodeTitleDraft = signal('');
  readonly selectedNodeTitleEditing = signal(false);
  private readonly pendingSelectedNodeTitleRename = signal<{ nodeId: string; sentTitle: string } | null>(null);
  private titleEditSyncNodeId: string | null = null;
  private skipSelectionClearForOpenNodeCleanup = false;
  readonly workspaceSwitchSearch = signal('');
  readonly globalSearchQuery = signal('');
  readonly relationsSearchQuery = signal('');
  readonly relationSuggestionsOpen = signal(false);
  readonly relationSearchError = signal<string | null>(null);
  readonly selectedRelationTargets = signal<
    Array<{ kind: 'knowledge'; nodeId: string } | { kind: 'ticket'; ticketLongSha: string }>
  >([]);
  readonly pendingOpenNodeId = signal<string | null>(null);

  readonly effectiveWorkspace = computed(() => {
    const id = this.activeClientId();
    const clients = this.clients();

    return id ? (clients.find((c) => c.id === id) ?? null) : null;
  });

  readonly globalSearchHits = computed(() => {
    const query = this.globalSearchQuery().trim().toLowerCase();
    const hits: Array<{ node: KnowledgeNodeDto; path: string[] }> = [];
    const walk = (nodes: KnowledgeNodeDto[], path: string[]) => {
      for (const node of nodes) {
        const nextPath = [...path, node.title];

        if (!query || node.title.toLowerCase().includes(query) || node.shas.short.toLowerCase().includes(query)) {
          hits.push({ node, path: nextPath });
        }

        walk(node.children ?? [], nextPath);
      }
    };

    walk(this.tree(), []);

    return hits;
  });

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
      setTimeout(() => this.selectedNodeTitleInput?.nativeElement?.focus(), 0);
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

    effect(() => {
      const activeClientId = this.activeClientId();

      if (!activeClientId && this.clients().length > 0 && !this.openedWorkspaceModalForMissingClient) {
        this.openedWorkspaceModalForMissingClient = true;
        queueMicrotask(() => this.openWorkspaceSwitchModal());
      }

      if (activeClientId) {
        this.openedWorkspaceModalForMissingClient = false;
      }
    });
  }

  openWorkspaceSwitchModal(): void {
    this.workspaceSwitchSearch.set('');
    const el = this.workspaceSwitchModal?.nativeElement;

    if (!el) return;

    if (!this.workspaceSwitchModalInstance) {
      const modalCtor = (
        window as unknown as { bootstrap?: { Modal?: new (e: Element) => { show: () => void; hide: () => void } } }
      ).bootstrap?.Modal;

      if (!modalCtor) return;

      this.workspaceSwitchModalInstance = new modalCtor(el);
    }

    this.workspaceSwitchModalInstance.show();
  }

  onCloseWorkspaceSwitchModal(): void {
    this.workspaceSwitchModalInstance?.hide();
  }

  openGlobalSearchModal(): void {
    this.globalSearchQuery.set('');
    setTimeout(() => {
      const shell = this.globalSearchModal?.nativeElement;

      if (shell?.classList.contains('show')) {
        this.globalSearchInput?.nativeElement?.focus({ preventScroll: true });

        return;
      }

      this.showGlobalSearchModalEl();
    }, 0);
  }

  onCloseGlobalSearchModal(): void {
    this.hideGlobalSearchModalEl();
    this.globalSearchQuery.set('');
  }

  onGlobalSearchResultClick(hit: { node: KnowledgeNodeDto; path: string[] }): void {
    this.hideGlobalSearchModalEl();
    this.globalSearchQuery.set('');
    this.onSelectNode(hit.node);
  }

  globalSearchPathDisplay(hit: { node: KnowledgeNodeDto; path: string[] }): string {
    if (hit.path.length <= 1) return '';

    return hit.path.slice(0, -1).join(' › ');
  }

  filteredClientsForWorkspaceSwitch(clients: ClientResponseDto[]): ClientResponseDto[] {
    const q = this.workspaceSwitchSearch().trim().toLowerCase();

    if (!q) return clients;

    return clients.filter((c) => (c.name ?? '').toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  }

  onSelectWorkspaceForKnowledge(client: ClientResponseDto): void {
    this.clientsFacade.setActiveClient(client.id);
    this.knowledgeFacade.loadTree(client.id);
    this.knowledgeFacade.selectNode(null);
    void this.router.navigate(['/knowledge', client.id]);
    this.onCloseWorkspaceSwitchModal();
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

  onDuplicateNode(nodeId: string): void {
    this.knowledgeFacade.duplicateNode(nodeId);
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

  onDeleteNode(event: { id: string; releaseExternalSyncMarker?: boolean }): void {
    this.knowledgeFacade.deleteNode(event.id, event.releaseExternalSyncMarker);
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
    setTimeout(() => this.selectedNodeTitleInput?.nativeElement?.focus(), 0);
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

  openRelationsModal(): void {
    this.relationsSearchQuery.set('');
    this.relationSearchError.set(null);
    this.relationSuggestionsOpen.set(false);
    this.selectedRelationTargets.set([]);
    setTimeout(() => this.showRelationsModalEl(), 0);
  }

  onCloseRelationsModal(): void {
    this.hideRelationsModalEl();
    this.relationsSearchQuery.set('');
    this.relationSearchError.set(null);
    this.relationSuggestionsOpen.set(false);
    this.selectedRelationTargets.set([]);
  }

  onRelationInputChange(value: string): void {
    this.relationsSearchQuery.set(value);
    this.relationSearchError.set(null);
    this.relationSuggestionsOpen.set(value.trim().length > 0);
  }

  onRelationInputFocus(): void {
    if (this.relationsSearchQuery().trim().length > 0 && this.relationCandidates().length > 0) {
      this.relationSuggestionsOpen.set(true);
    }
  }

  onRelationInputBlur(): void {
    setTimeout(() => this.relationSuggestionsOpen.set(false), 180);
  }

  onPickRelationCandidate(
    candidate: { kind: 'knowledge'; node: KnowledgeNodeDto } | { kind: 'ticket'; ticket: TicketResponseDto },
    event?: Event,
  ): void {
    event?.preventDefault();
    this.addRelationCandidate(candidate);
    this.relationsSearchQuery.set('');
    this.relationSearchError.set(null);
    this.relationSuggestionsOpen.set(false);
  }

  onAddRelationBySearch(): void {
    const query = this.relationsSearchQuery().trim().toLowerCase();

    if (!query) {
      this.relationSearchError.set('Enter a ticket, page, or folder SHA.');

      return;
    }

    const candidate = this.relationCandidates().find((item) => {
      if (item.kind === this.RELATION_TARGET_KIND_KNOWLEDGE) {
        const shortSha = item.node.shas.short.toLowerCase();
        const longSha = item.node.shas.long.toLowerCase();

        return shortSha === query || longSha === query || item.node.title.toLowerCase() === query;
      }

      const shortSha = item.ticket.shas.short.toLowerCase();
      const longSha = item.ticket.shas.long.toLowerCase();
      const title = (item.ticket.title ?? '').toLowerCase();

      return shortSha === query || longSha === query || title === query;
    });

    if (!candidate) {
      this.relationSearchError.set('No matching ticket, page, or folder found.');

      return;
    }

    this.addRelationCandidate(candidate);
    this.relationsSearchQuery.set('');
    this.relationSearchError.set(null);
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

  activityActionLabel(actionType: string): string {
    switch (actionType) {
      case 'CREATED':
        return 'Created';
      case 'FIELD_UPDATED':
        return 'Details updated';
      case 'CONTENT_UPDATED':
        return 'Content updated';
      case 'PARENT_CHANGED':
        return 'Parent changed';
      case 'SORT_ORDER_CHANGED':
        return 'Order changed';
      case 'DUPLICATED':
        return 'Duplicated';
      case 'RELATION_ADDED':
        return 'Relation added';
      case 'RELATION_REMOVED':
        return 'Relation removed';
      default:
        return 'Unknown activity';
    }
  }

  activityActionBadgeClass(actionType: string): string {
    switch (actionType) {
      case 'CREATED':
      case 'DUPLICATED':
        return 'knowledge-board__chip--activity-created';
      case 'CONTENT_UPDATED':
      case 'FIELD_UPDATED':
        return 'knowledge-board__chip--activity-muted';
      case 'PARENT_CHANGED':
      case 'SORT_ORDER_CHANGED':
        return 'knowledge-board__chip--activity-status';
      case 'RELATION_ADDED':
        return 'knowledge-board__chip--activity-comment';
      case 'RELATION_REMOVED':
        return 'knowledge-board__chip--activity-deleted';
      default:
        return 'knowledge-board__chip--activity-muted';
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
      return `${nodeId.slice(0, 7)} · Unavailable knowledge`;
    }

    const type = node.nodeType === 'folder' ? 'Folder' : 'Page';

    return `${node.shas.short} · ${type}: ${node.title}`;
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
        return `${target.ticketLongSha.slice(0, 7)} · Ticket: Unavailable ticket`;
      }

      return `${ticket.shas.short} · Ticket: ${ticket.title ?? ''}`;
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

  private showGlobalSearchModalEl(): void {
    const el = this.globalSearchModal?.nativeElement;

    if (!el) return;

    const win = window as unknown as {
      bootstrap?: {
        Modal?: { getOrCreateInstance: (e: Element) => { show(): void }; new (e: Element): { show(): void } };
      };
    };
    const Modal = win.bootstrap?.Modal;

    if (!Modal) return;

    const focusSearchInput = (): void => {
      this.globalSearchInput?.nativeElement?.focus({ preventScroll: true });
    };

    el.addEventListener('shown.bs.modal', focusSearchInput, { once: true });
    const inst = Modal.getOrCreateInstance ? Modal.getOrCreateInstance(el) : new Modal(el);

    inst.show();
  }

  private hideGlobalSearchModalEl(): void {
    const el = this.globalSearchModal?.nativeElement;

    if (!el) return;

    const win = window as unknown as {
      bootstrap?: { Modal?: { getInstance: (e: Element) => { hide(): void } | null } };
    };

    win.bootstrap?.Modal?.getInstance(el)?.hide();
  }

  private showRelationsModalEl(): void {
    const el = this.relationsModal?.nativeElement;

    if (!el) return;

    const win = window as unknown as {
      bootstrap?: {
        Modal?: { getOrCreateInstance: (e: Element) => { show(): void }; new (e: Element): { show(): void } };
      };
    };
    const Modal = win.bootstrap?.Modal;

    if (!Modal) return;

    const focusSearchInput = (): void => {
      this.relationsSearchInput?.nativeElement?.focus({ preventScroll: true });
    };

    el.addEventListener('shown.bs.modal', focusSearchInput, { once: true });
    const inst = Modal.getOrCreateInstance ? Modal.getOrCreateInstance(el) : new Modal(el);

    inst.show();
  }

  private hideRelationsModalEl(): void {
    const el = this.relationsModal?.nativeElement;

    if (!el) return;

    const win = window as unknown as {
      bootstrap?: { Modal?: { getInstance: (e: Element) => { hide(): void } | null } };
    };

    win.bootstrap?.Modal?.getInstance(el)?.hide();
  }
}
