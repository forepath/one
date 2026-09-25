import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  KnowledgeFacade,
  type KnowledgeNodeDto,
  type KnowledgeNodeType,
  type KnowledgeUploadOnConflict,
  type UploadKnowledgeTextDto,
  type UploadKnowledgeTextFileDto,
  uploadKnowledgeTextFilesFailure,
  uploadKnowledgeTextFilesSuccess,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { Actions, ofType } from '@ngrx/effects';
import { filter, firstValueFrom, take } from 'rxjs';

import { KnowledgeTreeClipboardService } from './knowledge-tree-clipboard.service';
import {
  buildKnowledgeClipboardEntries,
  getKnowledgeClipboardModeForId,
  resolveKnowledgePasteTargetParentId,
} from './knowledge-tree-clipboard.util';
import {
  applyKnowledgeTreeSelectionGesture,
  flattenVisibleKnowledgeNodes,
  getTopmostSelectedIds,
  pruneSelectionAfterCollapse,
  type KnowledgeTreeSelectableNode,
  type KnowledgeTreeSelectionGesture,
} from './knowledge-tree-selection.util';

interface PendingKnowledgeUpload {
  parentId: string | null;
  title: string;
  tempId: string;
}

const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.md', '.mmd', '.txt']);

@Component({
  selector: 'framework-knowledge-tree',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcSpinnerComponent,
  ],
  templateUrl: './knowledge-tree.component.html',
  styleUrls: ['./knowledge-tree.component.scss'],
  providers: [KnowledgeTreeClipboardService],
  host: {
    tabindex: '0',
    '(keydown)': 'onTreeKeydown($event)',
    '(paste)': 'onTreePaste($event)',
  },
})
export class KnowledgeTreeComponent implements OnChanges {
  private readonly hostElement = inject(ElementRef<HTMLElement>);
  private readonly knowledgeFacade = inject(KnowledgeFacade);
  private readonly actions$ = inject(Actions);
  readonly clipboardService = inject(KnowledgeTreeClipboardService);

  @ViewChild('uploadFileInput')
  private uploadFileInput?: ElementRef<HTMLInputElement>;

  constructor() {
    this.clipboardService.setCollisionHelpers({
      resolveNameCollision: (title) => this.promptNameCollision(title),
      listSiblings: (parentId) =>
        this.getSiblingNodes(parentId).map((node) => ({
          id: node.id,
          title: node.title,
          nodeType: node.nodeType,
        })),
      getNodeContent: (id) => this.findNodeById(this.nodes, id)?.content,
    });
  }

  @Input() nodes: KnowledgeNodeDto[] = [];
  @Input() selectedNodeId: string | null = null;
  @Input() loading = false;
  @Input() workspaceId: string | null = null;
  @Input() mutatingIds: ReadonlySet<string> | Set<string> = new Set();

  @Output() selectNode = new EventEmitter<KnowledgeNodeDto>();
  @Output() createNode = new EventEmitter<{ parentId: string | null; nodeType: KnowledgeNodeType; title: string }>();
  @Output() refreshTree = new EventEmitter<void>();
  @Output() renameNode = new EventEmitter<{ id: string; title: string }>();
  @Output() moveNode = new EventEmitter<{ id: string; parentId: string | null }>();

  readonly selectedIds = signal<Set<string>>(new Set());
  readonly selectionAnchorId = signal<string | null>(null);
  readonly creatingAt = signal<{ parentId: string | null; nodeType: KnowledgeNodeType } | null>(null);
  readonly newNodeTitle = signal('');

  readonly expandedNodeIds = signal<Set<string>>(new Set());
  readonly contextMenuNodeId = signal<string | null>(null);
  readonly contextMenuPosition = signal<{ x: number; y: number } | null>(null);
  readonly renameModalOpen = signal(false);
  readonly renameTargetNodeId = signal<string | null>(null);
  readonly renameDraft = signal('');
  readonly moveModalOpen = signal(false);
  readonly moveTargetNodeId = signal<string | null>(null);
  readonly moveTargetParentId = signal<string | null>(null);
  readonly deleteModalOpen = signal(false);
  readonly itemsToDelete = signal<KnowledgeNodeDto[]>([]);
  readonly releaseExternalSyncMarkerOnDelete = signal(false);
  readonly hasLoadedWorkspaceTree = signal(false);
  readonly batchError = signal<string | null>(null);
  readonly pendingUploads = signal<PendingKnowledgeUpload[]>([]);
  readonly uploadTargetParentId = signal<string | null>(null);
  readonly dragOverParentId = signal<string | null | undefined>(undefined);
  readonly nameCollisionOpen = signal(false);
  readonly nameCollisionName = signal('');
  private nameCollisionResolver: ((choice: 'replace' | 'keepBoth') => void) | null = null;
  private pendingUploadSeq = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['workspaceId']) {
      this.hasLoadedWorkspaceTree.set(false);
      this.clearTreeSelection();
      this.clipboardService.clearClipboard();
      this.pendingUploads.set([]);
      this.batchError.set(null);
      this.dragOverParentId.set(undefined);
    }

    if (!this.loading && this.workspaceId) {
      this.hasLoadedWorkspaceTree.set(true);
    }
  }

  shouldShowInitialLoadingSpinner(): boolean {
    return this.loading && !this.hasLoadedWorkspaceTree();
  }

  isNodeSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  isNodeOpen(id: string): boolean {
    const node = this.findNodeById(this.nodes, id);

    return this.selectedNodeId === id && node?.nodeType === 'page';
  }

  isNodeClipboardCopy(id: string): boolean {
    return getKnowledgeClipboardModeForId(this.clipboardService.clipboard(), id) === 'copy';
  }

  isNodeClipboardCut(id: string): boolean {
    return getKnowledgeClipboardModeForId(this.clipboardService.clipboard(), id) === 'cut';
  }

  isNodeBusy(id: string): boolean {
    return this.mutatingIds.has(id);
  }

  onNodeClick(node: KnowledgeNodeDto, event: MouseEvent): void {
    event.stopPropagation();
    this.focusTreeHost();

    const gesture = this.resolveSelectionGesture(event);
    const selectable = this.toSelectableNode(node);
    const visibleNodes = this.buildVisibleSelectableNodes();
    const result = applyKnowledgeTreeSelectionGesture({
      gesture,
      node: selectable,
      visibleNodes,
      previousSelected: this.selectedIds(),
      selectionAnchorId: this.selectionAnchorId(),
    });

    this.selectedIds.set(result.selectedIds);
    this.selectionAnchorId.set(result.selectionAnchorId);

    if (gesture === 'plain') {
      if (node.nodeType === 'page') {
        this.selectNode.emit(node);
      } else {
        this.toggleExpand(node.id);
      }
    }
  }

  onToggleExpand(nodeId: string, event?: Event): void {
    event?.stopPropagation();
    this.toggleExpand(nodeId);
  }

  private toggleExpand(nodeId: string): void {
    const wasExpanded = this.expandedNodeIds().has(nodeId);

    this.expandedNodeIds.update((prev) => {
      const next = new Set(prev);

      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }

      return next;
    });

    if (wasExpanded) {
      this.selectedIds.update((selected) =>
        pruneSelectionAfterCollapse(selected, nodeId, (id) => this.resolveParentId(id)),
      );
    }
  }

  isExpanded(node: KnowledgeNodeDto): boolean {
    return this.expandedNodeIds().has(node.id);
  }

  expandPathToNode(nodeId: string, includeTargetIfFolder = false): void {
    const path = this.findPathToNode(this.nodes, nodeId);

    if (!path.length) {
      return;
    }

    this.expandedNodeIds.update((prev) => {
      const next = new Set(prev);

      for (let i = 0; i < path.length - 1; i++) {
        next.add(path[i].id);
      }

      const target = path[path.length - 1];

      if (includeTargetIfFolder && target.nodeType === 'folder') {
        next.add(target.id);
      }

      return next;
    });
  }

  openCreate(parentId: string | null, nodeType: KnowledgeNodeType, event?: Event): void {
    event?.stopPropagation();
    this.creatingAt.set({ parentId, nodeType });
    this.newNodeTitle.set('');
  }

  cancelCreate(event?: Event): void {
    event?.stopPropagation();
    this.creatingAt.set(null);
    this.newNodeTitle.set('');
  }

  confirmCreate(event?: Event): void {
    event?.stopPropagation();
    const creating = this.creatingAt();
    const title = this.newNodeTitle().trim();

    if (!creating || !title) return;

    const parentId = creating.parentId;

    if (parentId) {
      this.expandedNodeIds.update((prev) => new Set(prev).add(parentId));
    }

    this.createNode.emit({ parentId: creating.parentId, nodeType: creating.nodeType, title });
    this.creatingAt.set(null);
    this.newNodeTitle.set('');
  }

  onDelete(node: KnowledgeNodeDto, event: Event): void {
    event.stopPropagation();
    this.releaseExternalSyncMarkerOnDelete.set(false);
    this.itemsToDelete.set([node]);
    this.deleteModalOpen.set(true);
  }

  onContextMenu(event: MouseEvent, node: KnowledgeNodeDto): void {
    event.preventDefault();
    event.stopPropagation();
    this.focusTreeHost();

    if (!this.selectedIds().has(node.id)) {
      this.selectedIds.set(new Set([node.id]));
      this.selectionAnchorId.set(node.id);
    }

    this.contextMenuNodeId.set(node.id);
    this.contextMenuPosition.set({ x: event.clientX, y: event.clientY });
  }

  closeContextMenu(): void {
    this.contextMenuNodeId.set(null);
    this.contextMenuPosition.set(null);
  }

  contextMenuNode(): KnowledgeNodeDto | null {
    const id = this.contextMenuNodeId();

    if (!id) return null;

    return this.findNodeById(this.nodes, id);
  }

  onTreeKeydown(event: KeyboardEvent): void {
    if (this.shouldIgnoreTreeHotkey(event)) {
      return;
    }

    const key = event.key;
    const mod = event.ctrlKey || event.metaKey;

    if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      this.deleteSelectionFromHotkey();

      return;
    }

    if (key === 'F2') {
      event.preventDefault();
      this.renameSelectionFromHotkey();

      return;
    }

    if (mod && key.toLowerCase() === 'c') {
      event.preventDefault();
      this.copySelectionToClipboard();

      return;
    }

    if (mod && key.toLowerCase() === 'x') {
      event.preventDefault();
      this.cutSelectionToClipboard();

      return;
    }

    // Ctrl/Cmd+V is handled in onTreePaste so OS file uploads (clipboardData) work.
  }

  /**
   * Paste into the tree: internal clipboard takes precedence; otherwise OS clipboard
   * text files upload into the paste target folder.
   */
  onTreePaste(event: ClipboardEvent): void {
    if (this.shouldIgnorePasteTarget(event.target)) {
      return;
    }

    if (this.clipboardService.clipboard()) {
      event.preventDefault();
      event.stopPropagation();
      this.pasteClipboardIntoTarget();

      return;
    }

    const files = this.getClipboardFiles(event);

    if (files.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      void this.uploadFilesToParent(files, this.resolveUploadTargetParentId());
    }
  }

  promptNameCollision(name: string): Promise<'replace' | 'keepBoth'> {
    return new Promise((resolve) => {
      this.nameCollisionName.set(name);
      this.nameCollisionResolver = resolve;
      this.nameCollisionOpen.set(true);
    });
  }

  onNameCollisionReplace(): void {
    this.nameCollisionOpen.set(false);
    this.nameCollisionResolver?.('replace');
    this.nameCollisionResolver = null;
  }

  onNameCollisionKeepBoth(): void {
    this.nameCollisionOpen.set(false);
    this.nameCollisionResolver?.('keepBoth');
    this.nameCollisionResolver = null;
  }

  getNameCollisionTitle(): string {
    const name = this.nameCollisionName();

    return $localize`:@@featureKnowledgeTree-nameCollisionTitle:A page named ${name}:name: already exists`;
  }

  onUploadFile(parentId?: string | null, event?: Event): void {
    event?.stopPropagation();
    this.uploadTargetParentId.set(parentId === undefined ? this.resolveHeaderUploadParentId() : parentId);
    this.uploadFileInput?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;

    if (!files || files.length === 0) {
      input.value = '';

      return;
    }

    void this.uploadFilesToParent(Array.from(files), this.uploadTargetParentId());
    input.value = '';
  }

  pendingUploadsFor(parentId: string | null): PendingKnowledgeUpload[] {
    return this.pendingUploads().filter((upload) => upload.parentId === parentId);
  }

  hasPendingUploads(parentId: string | null): boolean {
    return this.pendingUploads().some((upload) => upload.parentId === parentId);
  }

  onDragOverRoot(event: DragEvent): void {
    if (!this.isExternalFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.dragOverParentId.set(null);
  }

  onDragLeaveRoot(event: DragEvent): void {
    if (!this.isExternalFileDrag(event)) {
      return;
    }

    const related = event.relatedTarget as Node | null;
    const current = event.currentTarget as Node | null;

    if (related && current?.contains(related)) {
      return;
    }

    if (this.dragOverParentId() === null) {
      this.dragOverParentId.set(undefined);
    }
  }

  onDropRoot(event: DragEvent): void {
    if (!this.isExternalFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.dragOverParentId.set(undefined);

    const files = this.getDroppedFiles(event);

    if (files.length > 0) {
      void this.uploadFilesToParent(files, null);
    }
  }

  onDragOverFolder(event: DragEvent, folderId: string): void {
    if (!this.isExternalFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.dragOverParentId.set(folderId);
  }

  onDragLeaveFolder(event: DragEvent, folderId: string): void {
    if (!this.isExternalFileDrag(event)) {
      return;
    }

    const related = event.relatedTarget as Node | null;
    const current = event.currentTarget as Node | null;

    if (related && current?.contains(related)) {
      return;
    }

    if (this.dragOverParentId() === folderId) {
      this.dragOverParentId.set(undefined);
    }
  }

  onDropFolder(event: DragEvent, folderId: string): void {
    if (!this.isExternalFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.dragOverParentId.set(undefined);

    const files = this.getDroppedFiles(event);

    if (files.length > 0) {
      void this.uploadFilesToParent(files, folderId);
    }
  }

  onTreeBackgroundClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;

    if (target?.closest('.tree-node, .create-item-input, .context-menu, button, a, input, textarea, select')) {
      return;
    }

    this.focusTreeHost();
    this.clearTreeSelection();
  }

  clearTreeSelection(): void {
    if (this.selectedIds().size === 0 && this.selectionAnchorId() === null) {
      return;
    }

    this.selectedIds.set(new Set());
    this.selectionAnchorId.set(null);
  }

  focusTreeHost(): void {
    const el = this.hostElement.nativeElement;

    if (document.activeElement !== el) {
      el.focus({ preventScroll: true });
    }
  }

  onContextRefresh(): void {
    this.refreshTree.emit();
    this.closeContextMenu();
  }

  onContextRename(): void {
    const targets = this.resolveActionTargets(this.contextMenuNodeId());

    if (targets.length !== 1) {
      this.closeContextMenu();

      return;
    }

    const node = targets[0];

    this.renameTargetNodeId.set(node.id);
    this.renameDraft.set(node.title);
    this.renameModalOpen.set(true);
    this.closeContextMenu();
  }

  onCancelRename(): void {
    this.renameModalOpen.set(false);
    this.renameTargetNodeId.set(null);
    this.renameDraft.set('');
  }

  onConfirmRename(): void {
    const id = this.renameTargetNodeId();
    const title = this.renameDraft().trim();

    if (!id || !title) return;

    this.renameNode.emit({ id, title });
    this.onCancelRename();
  }

  onContextMove(): void {
    const targets = this.resolveActionTargets(this.contextMenuNodeId());

    if (targets.length !== 1) {
      this.closeContextMenu();

      return;
    }

    const node = targets[0];

    this.moveTargetNodeId.set(node.id);
    this.moveTargetParentId.set(node.parentId ?? null);
    this.moveModalOpen.set(true);
    this.closeContextMenu();
  }

  onCancelMove(): void {
    this.moveModalOpen.set(false);
    this.moveTargetNodeId.set(null);
    this.moveTargetParentId.set(null);
  }

  onConfirmMove(): void {
    const id = this.moveTargetNodeId();

    if (!id) return;

    this.moveNode.emit({ id, parentId: this.moveTargetParentId() });
    this.onCancelMove();
  }

  onContextDelete(): void {
    const targets = this.resolveActionTargets(this.contextMenuNodeId());

    if (targets.length === 0) {
      this.closeContextMenu();

      return;
    }

    this.releaseExternalSyncMarkerOnDelete.set(false);
    this.itemsToDelete.set(targets);
    this.deleteModalOpen.set(true);
    this.closeContextMenu();
  }

  onCopySelection(): void {
    this.copySelectionToClipboard();
    this.closeContextMenu();
  }

  onCutSelection(): void {
    this.cutSelectionToClipboard();
    this.closeContextMenu();
  }

  onPasteSelection(): void {
    this.pasteClipboardIntoTarget();
    this.closeContextMenu();
  }

  onCancelDelete(): void {
    this.deleteModalOpen.set(false);
    this.itemsToDelete.set([]);
    this.releaseExternalSyncMarkerOnDelete.set(false);
  }

  onConfirmDelete(): void {
    const items = this.itemsToDelete();

    if (items.length === 0) {
      return;
    }

    const roots = getTopmostSelectedIds(
      items.map((item) => item.id),
      (id) => this.resolveParentId(id),
    );
    const releaseExternalSyncMarker = this.releaseExternalSyncMarkerOnDelete();

    this.deleteModalOpen.set(false);
    this.itemsToDelete.set([]);
    this.releaseExternalSyncMarkerOnDelete.set(false);

    this.clipboardService.enqueueDelete(roots, { releaseExternalSyncMarker }, (deleted) => {
      this.selectedIds.update((selected) => {
        const next = new Set(selected);

        for (const id of deleted) {
          next.delete(id);
        }

        return next;
      });

      const error = this.clipboardService.lastError();

      if (error) {
        this.batchError.set(error);
      }
    });
  }

  getDeleteModalTitle(): string {
    const items = this.itemsToDelete();

    if (items.length === 0) {
      return '';
    }

    if (items.length > 1) {
      return $localize`:@@featureKnowledgeTree-deleteMultipleTitle:Delete Items`;
    }

    return $localize`:@@featureKnowledgeTree-deleteModalTitle:Delete item`;
  }

  getDeleteModalMessage(): string {
    const items = this.itemsToDelete();

    if (items.length === 0) {
      return '';
    }

    if (items.length > 1) {
      const count = items.length;

      return $localize`:@@featureKnowledgeTree-deleteMultipleMessage:Are you sure you want to delete ${count}:count: items?`;
    }

    return $localize`:@@featureKnowledgeTree-deleteConfirmText:Are you sure you want to delete this item?`;
  }

  filteredRoots(): KnowledgeNodeDto[] {
    return this.sortNodesForDisplay(this.nodes);
  }

  orderedChildren(node: KnowledgeNodeDto): KnowledgeNodeDto[] {
    return this.sortNodesForDisplay(node.children ?? []);
  }

  private sortNodesForDisplay(nodes: KnowledgeNodeDto[]): KnowledgeNodeDto[] {
    return [...nodes].sort((a, b) => {
      if (a.nodeType !== b.nodeType) {
        return a.nodeType === 'folder' ? -1 : 1;
      }

      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });
  }

  private resolveSelectionGesture(event: MouseEvent): KnowledgeTreeSelectionGesture {
    if (event.shiftKey) {
      return 'shift';
    }

    if (event.ctrlKey || event.metaKey) {
      return 'ctrl';
    }

    return 'plain';
  }

  private shouldIgnoreTreeHotkey(event: KeyboardEvent): boolean {
    return this.shouldIgnorePasteTarget(event.target);
  }

  private shouldIgnorePasteTarget(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) {
      return true;
    }

    const tag = target.tagName;

    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
      return true;
    }

    if (this.deleteModalOpen() || this.renameModalOpen() || this.moveModalOpen() || this.nameCollisionOpen()) {
      return true;
    }

    if (this.creatingAt()) {
      return true;
    }

    return false;
  }

  private buildVisibleSelectableNodes(): KnowledgeTreeSelectableNode[] {
    return flattenVisibleKnowledgeNodes(this.filteredRoots().map((node) => this.toSelectableNode(node)));
  }

  private toSelectableNode(node: KnowledgeNodeDto): KnowledgeTreeSelectableNode {
    const expanded = node.nodeType === 'folder' && this.expandedNodeIds().has(node.id);

    return {
      id: node.id,
      nodeType: node.nodeType,
      parentId: node.parentId ?? null,
      expanded,
      children: expanded ? this.orderedChildren(node).map((child) => this.toSelectableNode(child)) : undefined,
    };
  }

  private resolveParentId(id: string): string | null | undefined {
    return this.findNodeById(this.nodes, id)?.parentId ?? null;
  }

  private resolveNodeType(id: string): 'folder' | 'page' | null {
    return this.findNodeById(this.nodes, id)?.nodeType ?? null;
  }

  private getSelectionRoots(): KnowledgeNodeDto[] {
    const roots = getTopmostSelectedIds(this.selectedIds(), (id) => this.resolveParentId(id));
    const items: KnowledgeNodeDto[] = [];

    for (const id of roots) {
      const node = this.findNodeById(this.nodes, id);

      if (node) {
        items.push(node);
      }
    }

    return items;
  }

  private resolveActionTargets(contextId: string | null): KnowledgeNodeDto[] {
    if (!contextId) {
      return [];
    }

    const selected = this.selectedIds();

    if (selected.size > 1 && selected.has(contextId)) {
      return this.getSelectionRoots();
    }

    const node = this.findNodeById(this.nodes, contextId);

    return node ? [node] : [];
  }

  private copySelectionToClipboard(): void {
    if (this.selectedIds().size === 0) {
      return;
    }

    const entries = buildKnowledgeClipboardEntries(
      this.selectedIds(),
      (id) => {
        const node = this.findNodeById(this.nodes, id);

        if (!node) {
          return null;
        }

        return {
          id: node.id,
          nodeType: node.nodeType,
          parentId: node.parentId ?? null,
          title: node.title,
        };
      },
      (id) => this.resolveParentId(id),
    );

    if (entries.length === 0) {
      return;
    }

    this.clipboardService.setClipboard('copy', entries);
  }

  private cutSelectionToClipboard(): void {
    if (this.selectedIds().size === 0) {
      return;
    }

    const entries = buildKnowledgeClipboardEntries(
      this.selectedIds(),
      (id) => {
        const node = this.findNodeById(this.nodes, id);

        if (!node) {
          return null;
        }

        return {
          id: node.id,
          nodeType: node.nodeType,
          parentId: node.parentId ?? null,
          title: node.title,
        };
      },
      (id) => this.resolveParentId(id),
    );

    if (entries.length === 0) {
      return;
    }

    this.clipboardService.setClipboard('cut', entries);
  }

  private pasteClipboardIntoTarget(): void {
    if (!this.clipboardService.clipboard()) {
      return;
    }

    const focusId =
      this.selectedIds().size === 0 ? null : (this.selectionAnchorId() ?? [...this.selectedIds()][0] ?? null);
    const targetParentId = resolveKnowledgePasteTargetParentId(
      focusId,
      (id) => this.resolveNodeType(id),
      (id) => this.resolveParentId(id),
    );

    if (targetParentId) {
      this.expandPathToNode(targetParentId, true);
    }

    this.clipboardService.enqueuePaste(
      targetParentId,
      (id) => this.resolveParentId(id),
      () => {
        const error = this.clipboardService.lastError();

        if (error) {
          this.batchError.set(error);
        }
      },
    );
  }

  private resolveHeaderUploadParentId(): string | null {
    if (this.selectedIds().size !== 1) {
      return null;
    }

    const id = [...this.selectedIds()][0];
    const node = this.findNodeById(this.nodes, id);

    return node?.nodeType === 'folder' ? id : null;
  }

  private resolveUploadTargetParentId(): string | null {
    const focusId =
      this.selectedIds().size === 0 ? null : (this.selectionAnchorId() ?? [...this.selectedIds()][0] ?? null);

    return resolveKnowledgePasteTargetParentId(
      focusId,
      (id) => this.resolveNodeType(id),
      (id) => this.resolveParentId(id),
    );
  }

  private getClipboardFiles(event: ClipboardEvent): File[] {
    const data = event.clipboardData;

    if (!data?.files?.length) {
      return [];
    }

    return Array.from(data.files).filter((file) => file.size >= 0 && file.name);
  }

  private isExternalFileDrag(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;

    if (!types) {
      return false;
    }

    return Array.from(types).includes('Files');
  }

  private getDroppedFiles(event: DragEvent): File[] {
    const dataTransfer = event.dataTransfer;

    if (!dataTransfer) {
      return [];
    }

    const files: File[] = [];

    if (dataTransfer.items?.length) {
      for (let index = 0; index < dataTransfer.items.length; index++) {
        const item = dataTransfer.items[index];

        if (item.kind !== 'file') {
          continue;
        }

        const entry = item.webkitGetAsEntry?.();

        if (entry && !entry.isFile) {
          continue;
        }

        const file = item.getAsFile();

        if (file) {
          files.push(file);
        }
      }

      return files;
    }

    return Array.from(dataTransfer.files ?? []);
  }

  private isAllowedUploadFilename(filename: string): boolean {
    const lower = filename.trim().toLowerCase();
    const dot = lower.lastIndexOf('.');

    if (dot < 0) {
      return false;
    }

    return ALLOWED_UPLOAD_EXTENSIONS.has(lower.slice(dot));
  }

  private titleFromUploadFilename(filename: string): string {
    const trimmed = filename.trim();
    const lower = trimmed.toLowerCase();
    const dot = lower.lastIndexOf('.');

    if (dot < 0 || !ALLOWED_UPLOAD_EXTENSIONS.has(lower.slice(dot))) {
      return trimmed;
    }

    return trimmed.slice(0, dot).trim() || trimmed;
  }

  private getSiblingNodes(parentId: string | null): KnowledgeNodeDto[] {
    if (parentId === null) {
      return this.nodes;
    }

    return this.findNodeById(this.nodes, parentId)?.children ?? [];
  }

  private async uploadFilesToParent(files: File[], parentId: string | null): Promise<void> {
    if (!this.workspaceId || files.length === 0) {
      return;
    }

    const allowed: File[] = [];
    const rejectedNames: string[] = [];

    for (const file of files) {
      if (this.isAllowedUploadFilename(file.name)) {
        allowed.push(file);
      } else {
        rejectedNames.push(file.name);
      }
    }

    if (rejectedNames.length > 0) {
      this.batchError.set(
        $localize`:@@featureKnowledgeTree-uploadUnsupported:Unsupported file type (only .md, .mmd, and .txt allowed): ${rejectedNames.join(', ')}:names:`,
      );
    }

    if (allowed.length === 0) {
      return;
    }

    this.batchError.set(null);

    if (parentId) {
      this.expandPathToNode(parentId, true);
    }

    const pendingEntries: PendingKnowledgeUpload[] = allowed.map((file) => {
      this.pendingUploadSeq += 1;

      return {
        parentId,
        title: this.titleFromUploadFilename(file.name),
        tempId: `upload-${this.pendingUploadSeq}-${file.name}`,
      };
    });

    this.pendingUploads.update((current) => [...current, ...pendingEntries]);

    try {
      const payloads: Array<UploadKnowledgeTextFileDto & { title: string }> = [];

      for (const file of allowed) {
        const content = await this.readFileAsText(file);

        payloads.push({
          filename: file.name,
          content,
          title: this.titleFromUploadFilename(file.name),
        });
      }

      const siblings = this.getSiblingNodes(parentId);
      const siblingByTitle = new Map(siblings.map((node) => [node.title.toLowerCase(), node]));
      const claimedThisBatch = new Set<string>();
      const noneGroup: UploadKnowledgeTextFileDto[] = [];
      const replaceGroup: UploadKnowledgeTextFileDto[] = [];
      const numberGroup: UploadKnowledgeTextFileDto[] = [];

      for (const payload of payloads) {
        const titleKey = payload.title.toLowerCase();
        const existing = siblingByTitle.get(titleKey);
        const fileDto: UploadKnowledgeTextFileDto = {
          filename: payload.filename,
          content: payload.content,
        };

        if (claimedThisBatch.has(titleKey) || existing?.nodeType === 'folder') {
          numberGroup.push(fileDto);
        } else if (existing?.nodeType === 'page') {
          const choice = await this.promptNameCollision(payload.title);

          if (choice === 'replace') {
            replaceGroup.push(fileDto);
          } else {
            numberGroup.push(fileDto);
          }
        } else {
          noneGroup.push(fileDto);
        }

        claimedThisBatch.add(titleKey);
      }

      const rejectedMessages: string[] = [];
      const groups: Array<{ files: UploadKnowledgeTextFileDto[]; onConflict?: KnowledgeUploadOnConflict }> = [];

      if (noneGroup.length > 0) {
        groups.push({ files: noneGroup });
      }

      if (replaceGroup.length > 0) {
        groups.push({ files: replaceGroup, onConflict: 'replace' });
      }

      if (numberGroup.length > 0) {
        groups.push({ files: numberGroup, onConflict: 'number' });
      }

      for (const group of groups) {
        const dto: UploadKnowledgeTextDto = {
          clientId: parentId ? undefined : this.workspaceId,
          parentId,
          ...(group.onConflict ? { onConflict: group.onConflict } : {}),
          files: group.files,
        };
        const outcome = await this.awaitUploadTextFiles(dto);

        if (outcome.ok === false) {
          this.batchError.set(outcome.error);

          return;
        }

        for (const rejected of outcome.result.rejected) {
          rejectedMessages.push(`${rejected.filename}: ${rejected.reason}`);
        }
      }

      if (rejectedMessages.length > 0) {
        this.batchError.set(rejectedMessages.join('\n'));
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.batchError.set(message);
    } finally {
      const tempIds = new Set(pendingEntries.map((entry) => entry.tempId));

      this.pendingUploads.update((current) => current.filter((pending) => !tempIds.has(pending.tempId)));
    }
  }

  private awaitUploadTextFiles(
    dto: UploadKnowledgeTextDto,
  ): Promise<
    { ok: true; result: { rejected: Array<{ filename: string; reason: string }> } } | { ok: false; error: string }
  > {
    this.knowledgeFacade.uploadTextFiles(dto);

    return firstValueFrom(
      this.actions$.pipe(
        ofType(uploadKnowledgeTextFilesSuccess, uploadKnowledgeTextFilesFailure),
        filter((action) => action.dto === dto),
        take(1),
      ),
    ).then((action) => {
      if (action.type === uploadKnowledgeTextFilesSuccess.type) {
        return { ok: true as const, result: action.result };
      }

      return { ok: false as const, error: action.error };
    });
  }

  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
      reader.readAsText(file);
    });
  }

  private deleteSelectionFromHotkey(): void {
    const items = this.getSelectionRoots();

    if (items.length === 0) {
      return;
    }

    this.releaseExternalSyncMarkerOnDelete.set(false);
    this.itemsToDelete.set(items);
    this.deleteModalOpen.set(true);
  }

  private renameSelectionFromHotkey(): void {
    const items = this.getSelectionRoots();

    if (items.length !== 1) {
      return;
    }

    const node = items[0];

    this.renameTargetNodeId.set(node.id);
    this.renameDraft.set(node.title);
    this.renameModalOpen.set(true);
  }

  findNodeById(nodes: KnowledgeNodeDto[], id: string): KnowledgeNodeDto | null {
    for (const node of nodes) {
      if (node.id === id) return node;

      const childMatch = this.findNodeById(node.children ?? [], id);

      if (childMatch) return childMatch;
    }

    return null;
  }

  private findPathToNode(
    nodes: KnowledgeNodeDto[],
    id: string,
    currentPath: KnowledgeNodeDto[] = [],
  ): KnowledgeNodeDto[] {
    for (const node of nodes) {
      const nextPath = [...currentPath, node];

      if (node.id === id) {
        return nextPath;
      }

      const childPath = this.findPathToNode(node.children ?? [], id, nextPath);

      if (childPath.length) {
        return childPath;
      }
    }

    return [];
  }

  moveParentOptions(): Array<{ id: string | null; label: string }> {
    const movingId = this.moveTargetNodeId();
    const folders = this.collectFolders(this.nodes);
    const options: Array<{ id: string | null; label: string }> = [{ id: null, label: 'Root' }];

    for (const folder of folders) {
      if (!movingId || folder.id === movingId || this.nodeIsDescendantOf(folder.id, movingId)) {
        continue;
      }

      options.push({ id: folder.id, label: folder.title });
    }

    return options;
  }

  private collectFolders(nodes: KnowledgeNodeDto[]): KnowledgeNodeDto[] {
    const out: KnowledgeNodeDto[] = [];
    const walk = (list: KnowledgeNodeDto[]) => {
      for (const node of list) {
        if (node.nodeType === 'folder') {
          out.push(node);
        }

        walk(node.children ?? []);
      }
    };

    walk(nodes);

    return this.sortNodesForDisplay(out);
  }

  private nodeIsDescendantOf(nodeId: string, ancestorId: string): boolean {
    const ancestorNode = this.findNodeById(this.nodes, ancestorId);

    if (!ancestorNode) {
      return false;
    }

    return this.containsNodeId(ancestorNode.children ?? [], nodeId);
  }

  private containsNodeId(nodes: KnowledgeNodeDto[], nodeId: string): boolean {
    for (const node of nodes) {
      if (node.id === nodeId || this.containsNodeId(node.children ?? [], nodeId)) {
        return true;
      }
    }

    return false;
  }
}
