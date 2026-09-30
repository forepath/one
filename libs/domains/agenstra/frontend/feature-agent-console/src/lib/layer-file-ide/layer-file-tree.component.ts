import { CommonModule, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  OpencodeLayerFilesService,
  type OpencodeLayerFileDto,
  type OpencodeLayerFileEntryKind,
  type OpencodeLayerFileListDto,
  type OpencodeLayerFileListEntryDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcFormControlComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { Observable, lastValueFrom, of } from 'rxjs';
import { catchError, map, take } from 'rxjs/operators';

import { fileIconClassForName } from '../file-editor/file-icon.util';
import {
  buildClipboardEntries,
  getClipboardModeForPath,
  resolveCutDestinationPath,
  resolvePasteDestinationPath,
  resolvePasteTargetDirectory,
  type FileTreeClipboardState,
} from '../file-editor/file-tree/file-tree-clipboard.util';
import {
  applyFileTreeSelectionGesture,
  flattenVisibleTreeNodes,
  getParentPath,
  getPathBasename,
  getTopmostSelectedPaths,
  joinFileTreePath,
  pruneSelectionAfterCollapse,
  type FileTreeSelectableNode,
  type FileTreeSelectionGesture,
} from '../file-editor/file-tree/file-tree-selection.util';

export interface LayerTreeNode extends FileTreeSelectableNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: LayerTreeNode[];
  expanded?: boolean;
  loading?: boolean;
}

/**
 * Expandable layer-VFS tree (no NgRx). Mirrors file-tree selection / clipboard UX
 * against {@link OpencodeLayerFilesService}.
 */
@Component({
  selector: 'framework-layer-file-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    NgTemplateOutlet,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcFormControlComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './layer-file-tree.component.html',
  styleUrl: './layer-file-tree.component.scss',
})
export class LayerFileTreeComponent implements OnInit {
  private readonly layerFiles = inject(OpencodeLayerFilesService);

  readonly scope = input.required<'global' | 'workspace'>();
  readonly clientId = input<string | null>(null);
  /** Virtual listing root (`.` for whole layer VFS). */
  readonly treeRoot = input<string>('.');
  /** File currently open in the editor (open wash). */
  readonly openPath = input<string | null>(null);
  /** Expand these directories after the initial root load. */
  readonly initialExpandPaths = input<string[]>([]);

  readonly fileSelect = output<string>();
  readonly selectionChange = output<string[]>();
  readonly treeError = output<string | null>();
  /** Fired when a selected open file is deleted or cut away. */
  readonly openPathRemoved = output<string>();

  readonly loading = signal(true);
  readonly treeNodes = signal<LayerTreeNode[]>([]);
  readonly selectedPaths = signal<Set<string>>(new Set());
  readonly selectionAnchorPath = signal<string | null>(null);
  readonly clipboard = signal<FileTreeClipboardState | null>(null);
  readonly creatingItem = signal<{ parentPath: string; type: 'file' | 'directory' } | null>(null);
  readonly newItemName = signal('');
  readonly contextMenuPath = signal<string | null>(null);
  readonly contextMenuPosition = signal<{ x: number; y: number } | null>(null);
  readonly deleteModalOpen = signal(false);
  readonly pendingDeletePaths = signal<string[]>([]);
  readonly busy = signal(false);

  readonly contextMenuNode = computed(() => {
    const path = this.contextMenuPath();

    return path ? this.findNode(path) : null;
  });

  constructor() {
    effect(() => {
      this.selectionChange.emit([...this.selectedPaths()]);
    });
  }

  ngOnInit(): void {
    void this.bootstrap();
  }

  fileIcon(name: string): string {
    return fileIconClassForName(name);
  }

  levelArray(level: number): number[] {
    return Array.from({ length: level }, (_, i) => i);
  }

  isPathSelected(path: string): boolean {
    return this.selectedPaths().has(path);
  }

  isPathOpen(path: string): boolean {
    return this.openPath() === path;
  }

  clipboardModeFor(path: string): 'copy' | 'cut' | null {
    return getClipboardModeForPath(this.clipboard(), path);
  }

  createPlaceholder(): string {
    return this.creatingItem()?.type === 'directory' ? 'Directory name' : 'File name';
  }

  contextCreateParent(): string {
    const path = this.contextMenuPath();
    const node = path ? this.findNode(path) : null;

    if (!path || path === this.treeRoot()) {
      return this.treeRoot();
    }

    if (node?.type === 'directory') {
      return path;
    }

    return getParentPath(path);
  }

  onTreeBackgroundClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;

    if (target?.closest('.tree-node') || target?.closest('.create-item-input')) {
      return;
    }

    this.selectedPaths.set(new Set());
    this.selectionAnchorPath.set(null);
  }

  onNodeClick(node: LayerTreeNode, event: MouseEvent): void {
    event.stopPropagation();
    this.closeContextMenu();

    const gesture: FileTreeSelectionGesture = event.shiftKey
      ? 'shift'
      : event.ctrlKey || event.metaKey
        ? 'ctrl'
        : 'plain';
    const visible = flattenVisibleTreeNodes(this.treeNodes()) as LayerTreeNode[];
    const result = applyFileTreeSelectionGesture({
      gesture,
      node,
      visibleNodes: visible,
      previousSelected: this.selectedPaths(),
      selectionAnchorPath: this.selectionAnchorPath(),
    });

    this.selectedPaths.set(result.selectedPaths);
    this.selectionAnchorPath.set(result.selectionAnchorPath);

    if (gesture !== 'plain') {
      return;
    }

    if (node.type === 'directory') {
      void this.toggleDirectory(node);

      return;
    }

    this.fileSelect.emit(node.path);
  }

  onContextMenu(event: MouseEvent, node: LayerTreeNode): void {
    event.preventDefault();
    event.stopPropagation();

    if (!this.selectedPaths().has(node.path)) {
      this.selectedPaths.set(new Set([node.path]));
      this.selectionAnchorPath.set(node.path);
    }

    this.contextMenuPath.set(node.path);
    this.contextMenuPosition.set({ x: event.clientX, y: event.clientY });
  }

  closeContextMenu(): void {
    this.contextMenuPath.set(null);
    this.contextMenuPosition.set(null);
  }

  onTreeKeydown(event: KeyboardEvent): void {
    const meta = event.ctrlKey || event.metaKey;

    if (meta && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      this.copySelection();

      return;
    }

    if (meta && event.key.toLowerCase() === 'x') {
      event.preventDefault();
      this.cutSelection();

      return;
    }

    if (meta && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      void this.pasteSelection();

      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selectedPaths().size === 0) {
        return;
      }

      event.preventDefault();
      this.requestDelete();
    }
  }

  startCreate(type: 'file' | 'directory', parentPath: string): void {
    this.closeContextMenu();
    const parent = parentPath || this.treeRoot();

    if (parent !== this.treeRoot()) {
      const node = this.findNode(parent);

      if (node && !node.expanded) {
        void this.expandDirectory(node);
      }
    }

    this.creatingItem.set({ parentPath: parent, type });
    this.newItemName.set('');
  }

  cancelCreate(): void {
    this.creatingItem.set(null);
    this.newItemName.set('');
  }

  confirmCreate(): void {
    const creating = this.creatingItem();
    const name = this.newItemName().trim();

    if (!creating || !name || name.includes('/') || name.includes('\\') || name === '..') {
      return;
    }

    const path = this.joinPath(creating.parentPath, name);
    this.busy.set(true);
    this.treeError.emit(null);
    this.createEntry(path, creating.type)
      .pipe(take(1))
      .subscribe({
        next: async (dto) => {
          this.cancelCreate();
          await this.refreshFolder(creating.parentPath);

          if (dto.entryKind === 'file') {
            this.selectedPaths.set(new Set([dto.path]));
            this.fileSelect.emit(dto.path);
          }

          this.busy.set(false);
        },
        error: (err: { message?: string }) => {
          this.treeError.emit(err.message ?? $localize`:@@featureAgentConfig-layerFileSaveFailed:Failed to save file`);
          this.busy.set(false);
        },
      });
  }

  requestDelete(path?: string): void {
    const paths = path
      ? getTopmostSelectedPaths(this.selectedPaths().has(path) ? this.selectedPaths() : new Set([path]))
      : getTopmostSelectedPaths(this.selectedPaths());

    if (paths.length === 0) {
      return;
    }

    this.pendingDeletePaths.set(paths);
    this.deleteModalOpen.set(true);
  }

  confirmDelete(): void {
    const paths = [...this.pendingDeletePaths()];
    this.deleteModalOpen.set(false);
    this.pendingDeletePaths.set([]);

    if (paths.length === 0) {
      return;
    }

    this.busy.set(true);
    this.treeError.emit(null);

    void (async () => {
      try {
        for (const path of paths) {
          await lastValueFrom(this.deleteEntry(path).pipe(catchError(() => of(null))));
        }

        const open = this.openPath();

        if (open && paths.some((p) => open === p || open.startsWith(`${p}/`))) {
          this.openPathRemoved.emit(open);
        }

        this.selectedPaths.set(new Set());
        await this.refreshAffectedParents(paths);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        this.treeError.emit(message);
      } finally {
        this.busy.set(false);
      }
    })();
  }

  copySelection(): void {
    const entries = buildClipboardEntries(this.selectedPaths(), (path) => this.findNode(path)?.type ?? null);

    if (entries.length === 0) {
      return;
    }

    this.clipboard.set({ mode: 'copy', entries });
  }

  cutSelection(): void {
    const entries = buildClipboardEntries(this.selectedPaths(), (path) => this.findNode(path)?.type ?? null);

    if (entries.length === 0) {
      return;
    }

    this.clipboard.set({ mode: 'cut', entries });
  }

  async pasteSelection(): Promise<void> {
    const clip = this.clipboard();

    if (!clip || this.busy()) {
      return;
    }

    const focus = [...this.selectedPaths()].at(-1) ?? this.selectionAnchorPath() ?? this.openPath() ?? this.treeRoot();
    const target = resolvePasteTargetDirectory(focus, (path) => this.findNode(path)?.type ?? null);

    if (target !== this.treeRoot()) {
      const node = this.findNode(target);

      if (node && !node.expanded) {
        await this.expandDirectory(node);
      }
    }

    const siblings = await this.listChildren(target);
    const existingNames = siblings.map((entry) => entry.name);

    this.busy.set(true);
    this.treeError.emit(null);

    try {
      for (const entry of clip.entries) {
        if (clip.mode === 'cut' && (target === entry.path || target.startsWith(`${entry.path}/`))) {
          continue;
        }

        const destination =
          clip.mode === 'cut'
            ? resolveCutDestinationPath(entry, target, existingNames)
            : resolvePasteDestinationPath(entry, target, existingNames);

        existingNames.push(getPathBasename(destination));
        await this.copyPathRecursive(entry.path, entry.type, destination);

        if (clip.mode === 'cut') {
          await lastValueFrom(this.deleteEntry(entry.path).pipe(catchError(() => of(null))));
        }
      }

      if (clip.mode === 'cut') {
        this.clipboard.set(null);
      }

      await this.refreshFolder(target);
      await this.refreshAffectedParents(clip.entries.map((entry) => entry.path));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.treeError.emit(message);
    } finally {
      this.busy.set(false);
    }
  }

  refreshRoot(): void {
    void this.loadRoot();
  }

  async refreshFolder(path: string): Promise<void> {
    if (path === this.treeRoot() || path === '.') {
      await this.loadRoot();

      return;
    }

    const node = this.findNode(path);

    if (!node || node.type !== 'directory') {
      await this.loadRoot();

      return;
    }

    node.loading = true;
    this.treeNodes.update((nodes) => [...nodes]);

    try {
      const children = await this.listChildren(path);
      node.children = children.map((entry) => this.toNode(entry));
      node.expanded = true;
      node.loading = false;
      this.treeNodes.update((nodes) => [...nodes]);
    } catch (error: unknown) {
      node.loading = false;
      this.treeNodes.update((nodes) => [...nodes]);
      const message = error instanceof Error ? error.message : String(error);

      this.treeError.emit(message);
    }
  }

  private async bootstrap(): Promise<void> {
    await this.loadRoot();

    for (const path of this.initialExpandPaths()) {
      const node = this.findNode(path);

      if (node?.type === 'directory') {
        await this.expandDirectory(node);
      }
    }
  }

  private async loadRoot(): Promise<void> {
    this.loading.set(true);
    this.treeError.emit(null);

    try {
      const children = await this.listChildren(this.treeRoot());
      this.treeNodes.set(children.map((entry) => this.toNode(entry)));
    } catch (error: unknown) {
      this.treeNodes.set([]);
      const message = error instanceof Error ? error.message : String(error);

      this.treeError.emit(message);
    } finally {
      this.loading.set(false);
    }
  }

  private async toggleDirectory(node: LayerTreeNode): Promise<void> {
    if (node.expanded) {
      node.expanded = false;
      node.children = undefined;
      this.selectedPaths.update((selected) => pruneSelectionAfterCollapse(selected, node.path));
      this.treeNodes.update((nodes) => [...nodes]);

      return;
    }

    await this.expandDirectory(node);
  }

  private async expandDirectory(node: LayerTreeNode): Promise<void> {
    if (node.type !== 'directory') {
      return;
    }

    node.loading = true;
    node.expanded = true;
    this.treeNodes.update((nodes) => [...nodes]);

    try {
      const children = await this.listChildren(node.path);
      node.children = children.map((entry) => this.toNode(entry));
    } catch (error: unknown) {
      node.expanded = false;
      const message = error instanceof Error ? error.message : String(error);

      this.treeError.emit(message);
    } finally {
      node.loading = false;
      this.treeNodes.update((nodes) => [...nodes]);
    }
  }

  private async copyPathRecursive(
    sourcePath: string,
    type: 'file' | 'directory',
    destinationPath: string,
  ): Promise<void> {
    if (type === 'directory') {
      await lastValueFrom(this.createEntry(destinationPath, 'directory'));
      const children = await this.listChildren(sourcePath);

      for (const child of children) {
        const childDest = this.joinPath(destinationPath, child.name);
        await this.copyPathRecursive(child.path, child.entryKind, childDest);
      }

      return;
    }

    const dto = await lastValueFrom(
      this.getFile(sourcePath).pipe(catchError((): Observable<OpencodeLayerFileDto | null> => of(null))),
    );

    try {
      await lastValueFrom(this.createEntry(destinationPath, 'file', dto?.content ?? ''));
    } catch {
      await lastValueFrom(this.putFile(destinationPath, dto?.content ?? ''));
    }
  }

  private async refreshAffectedParents(paths: string[]): Promise<void> {
    const parents = new Set<string>();

    for (const path of paths) {
      const parent = getParentPath(path);
      parents.add(parent === '.' ? this.treeRoot() : parent);
    }

    for (const parent of parents) {
      await this.refreshFolder(parent);
    }
  }

  private toNode(entry: OpencodeLayerFileListEntryDto): LayerTreeNode {
    return {
      name: entry.name,
      path: entry.path,
      type: entry.entryKind,
      expanded: false,
    };
  }

  private findNode(path: string, nodes: LayerTreeNode[] = this.treeNodes()): LayerTreeNode | null {
    for (const node of nodes) {
      if (node.path === path) {
        return node;
      }

      if (node.children?.length) {
        const found = this.findNode(path, node.children);

        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  private joinPath(parent: string, name: string): string {
    if (!parent || parent === '.' || parent === './') {
      return name;
    }

    if (parent === '/') {
      return `/${name}`;
    }

    return joinFileTreePath(parent, name);
  }

  private listChildren(path: string): Promise<OpencodeLayerFileListEntryDto[]> {
    return lastValueFrom(
      this.listDir(path).pipe(
        map((listed) => listed.entries),
        catchError(() => of([] as OpencodeLayerFileListEntryDto[])),
        take(1),
      ),
    );
  }

  private listDir(path: string): Observable<OpencodeLayerFileListDto> {
    if (this.scope() === 'global') {
      return this.layerFiles.listGlobal(path);
    }

    const clientId = this.clientId();

    return clientId ? this.layerFiles.listWorkspace(clientId, path) : of({ path, entries: [] });
  }

  private getFile(path: string): Observable<OpencodeLayerFileDto | null> {
    if (this.scope() === 'global') {
      return this.layerFiles.getGlobal(path);
    }

    const clientId = this.clientId();

    return clientId ? this.layerFiles.getWorkspace(clientId, path) : of(null);
  }

  private putFile(path: string, content: string): Observable<OpencodeLayerFileDto> {
    if (this.scope() === 'global') {
      return this.layerFiles.putGlobal(path, content);
    }

    const clientId = this.clientId();

    if (!clientId) {
      return of({} as OpencodeLayerFileDto);
    }

    return this.layerFiles.putWorkspace(clientId, path, content);
  }

  private createEntry(
    path: string,
    entryKind: OpencodeLayerFileEntryKind,
    content = '',
  ): Observable<OpencodeLayerFileDto> {
    if (this.scope() === 'global') {
      return this.layerFiles.createGlobal(path, entryKind, content);
    }

    const clientId = this.clientId();

    if (!clientId) {
      return of({} as OpencodeLayerFileDto);
    }

    return this.layerFiles.createWorkspace(clientId, path, entryKind, content);
  }

  private deleteEntry(path: string): Observable<{ ok: true }> {
    if (this.scope() === 'global') {
      return this.layerFiles.deleteGlobal(path);
    }

    const clientId = this.clientId();

    if (!clientId) {
      return of({ ok: true as const });
    }

    return this.layerFiles.deleteWorkspace(clientId, path);
  }
}
