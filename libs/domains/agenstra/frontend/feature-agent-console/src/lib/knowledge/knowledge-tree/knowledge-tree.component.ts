import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { type KnowledgeNodeDto, type KnowledgeNodeType } from '@forepath/agenstra/frontend/data-access-agent-console';

@Component({
  selector: 'framework-knowledge-tree',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './knowledge-tree.component.html',
  styleUrls: ['./knowledge-tree.component.scss'],
})
export class KnowledgeTreeComponent implements OnChanges {
  @Input() nodes: KnowledgeNodeDto[] = [];
  @Input() selectedNodeId: string | null = null;
  @Input() loading = false;
  @Input() workspaceId: string | null = null;

  @Output() selectNode = new EventEmitter<KnowledgeNodeDto>();
  @Output() createNode = new EventEmitter<{ parentId: string | null; nodeType: KnowledgeNodeType; title: string }>();
  @Output() duplicateNode = new EventEmitter<string>();
  @Output() deleteNode = new EventEmitter<{ id: string; releaseExternalSyncMarker?: boolean }>();
  @Output() refreshTree = new EventEmitter<void>();
  @Output() renameNode = new EventEmitter<{ id: string; title: string }>();
  @Output() moveNode = new EventEmitter<{ id: string; parentId: string | null }>();

  readonly creatingAt = signal<{ parentId: string | null; nodeType: KnowledgeNodeType } | null>(null);
  readonly newNodeTitle = signal('');

  readonly expandedNodeIds = signal<Set<string>>(new Set());
  readonly contextMenuNodeId = signal<string | null>(null);
  readonly contextMenuPosition = signal<{ x: number; y: number } | null>(null);
  readonly renameTargetNodeId = signal<string | null>(null);
  readonly renameDraft = signal('');
  readonly moveTargetNodeId = signal<string | null>(null);
  readonly moveTargetParentId = signal<string | null>(null);
  readonly deleteTargetNodeId = signal<string | null>(null);
  readonly releaseExternalSyncMarkerOnDelete = signal(false);
  readonly hasLoadedWorkspaceTree = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['workspaceId']) {
      this.hasLoadedWorkspaceTree.set(false);
    }

    if (!this.loading && this.workspaceId) {
      this.hasLoadedWorkspaceTree.set(true);
    }
  }

  shouldShowInitialLoadingSpinner(): boolean {
    return this.loading && !this.hasLoadedWorkspaceTree();
  }

  onSelectNode(node: KnowledgeNodeDto): void {
    this.selectNode.emit(node);

    if (node.nodeType === 'folder') {
      this.toggleExpand(node.id);
    }
  }

  onToggleExpand(nodeId: string, event?: Event): void {
    event?.stopPropagation();
    this.toggleExpand(nodeId);
  }

  private toggleExpand(nodeId: string): void {
    this.expandedNodeIds.update((prev) => {
      const next = new Set(prev);

      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }

      return next;
    });
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

  onDuplicate(node: KnowledgeNodeDto, event: Event): void {
    event.stopPropagation();
    this.duplicateNode.emit(node.id);
  }

  onDelete(node: KnowledgeNodeDto, event: Event): void {
    event.stopPropagation();
    this.releaseExternalSyncMarkerOnDelete.set(false);
    this.deleteTargetNodeId.set(node.id);
  }

  onContextMenu(event: MouseEvent, node: KnowledgeNodeDto): void {
    event.preventDefault();
    event.stopPropagation();
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

  onContextRefresh(): void {
    this.refreshTree.emit();
    this.closeContextMenu();
  }

  onContextRename(): void {
    const node = this.contextMenuNode();

    if (!node) return;

    this.renameTargetNodeId.set(node.id);
    this.renameDraft.set(node.title);
    this.closeContextMenu();
  }

  onCancelRename(): void {
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
    const node = this.contextMenuNode();

    if (!node) return;

    this.moveTargetNodeId.set(node.id);
    this.moveTargetParentId.set(node.parentId ?? null);
    this.closeContextMenu();
  }

  onCancelMove(): void {
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
    const node = this.contextMenuNode();

    if (!node) return;

    this.releaseExternalSyncMarkerOnDelete.set(false);
    this.deleteTargetNodeId.set(node.id);
    this.closeContextMenu();
  }

  onCancelDelete(): void {
    this.deleteTargetNodeId.set(null);
    this.releaseExternalSyncMarkerOnDelete.set(false);
  }

  onConfirmDelete(): void {
    const id = this.deleteTargetNodeId();

    if (!id) return;

    const releaseExternalSyncMarker = this.releaseExternalSyncMarkerOnDelete();

    this.deleteNode.emit({ id, ...(releaseExternalSyncMarker ? { releaseExternalSyncMarker: true } : {}) });
    this.onCancelDelete();
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

  private findNodeById(nodes: KnowledgeNodeDto[], id: string): KnowledgeNodeDto | null {
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
