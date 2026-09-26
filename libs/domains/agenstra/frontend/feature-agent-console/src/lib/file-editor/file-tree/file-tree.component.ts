import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  FilesFacade,
  FilesService,
  VcsFacade,
  createFileOrDirectoryFailure,
  createFileOrDirectorySuccess,
  mimeToAgentFileType,
  writeFileFailure,
  writeFileSuccess,
  type FileManagerContext,
  type FileNodeDto,
  type ListDirectoryParams,
  type WriteFileDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { combineLatest, filter, firstValueFrom, map, Observable, of, Subscription, switchMap, take } from 'rxjs';

import { fileIconClassForName } from '../file-icon.util';
import { FileTreeClipboardService } from './file-tree-clipboard.service';
import {
  buildClipboardEntries,
  getClipboardModeForPath,
  remapPathAfterMove,
  resolvePasteTargetDirectory,
} from './file-tree-clipboard.util';
import {
  applyFileTreeSelectionGesture,
  flattenVisibleTreeNodes,
  getTopmostSelectedPaths,
  pruneSelectionAfterCollapse,
  suggestCopyBasename,
  type FileTreeSelectionGesture,
} from './file-tree-selection.util';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
  children?: TreeNode[];
  expanded?: boolean;
  loading?: boolean;
}

/** Minimal File System Access API entry shape for OS drag-and-drop (Chrome / Safari). */
interface DroppedFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file: (callback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
  createReader: () => DroppedFileSystemDirectoryReader;
}

interface DroppedFileSystemDirectoryReader {
  readEntries: (
    successCallback: (entries: DroppedFileSystemEntry[]) => void,
    errorCallback?: (error: DOMException) => void,
  ) => void;
}

interface CollectedUploadFile {
  relativePath: string;
  file: File;
}

/** Placeholder row shown in the tree while a file/folder upload is in flight. */
interface PendingUpload {
  id: string;
  path: string;
  name: string;
  parentPath: string;
  type: 'file' | 'directory';
  /** Upload progress 0–100 when available. */
  progress?: number;
}

@Component({
  selector: 'framework-file-tree',
  imports: [
    CommonModule,
    FormsModule,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcSpinnerComponent,
  ],
  templateUrl: './file-tree.component.html',
  styleUrls: ['./file-tree.component.scss'],
  standalone: true,
  providers: [FileTreeClipboardService],
  host: {
    tabindex: '0',
    '(keydown)': 'onTreeKeydown($event)',
    '(paste)': 'onTreePaste($event)',
  },
})
export class FileTreeComponent implements OnInit {
  private readonly filesFacade = inject(FilesFacade);
  private readonly filesService = inject(FilesService);
  private readonly vcsFacade = inject(VcsFacade);
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);
  private readonly destroyRef = inject(DestroyRef);
  readonly clipboardService = inject(FileTreeClipboardService);
  private readonly hostElement = inject(ElementRef<HTMLElement>);

  readonly deleteFileModalOpen = signal(false);
  readonly renameFileModalOpen = signal(false);
  readonly moveFileModalOpen = signal(false);
  readonly nameCollisionOpen = signal(false);
  readonly nameCollisionName = signal('');
  private nameCollisionResolver: ((choice: 'replace' | 'keepBoth') => void) | null = null;
  readonly selectedPaths = signal<Set<string>>(new Set());
  readonly selectionAnchorPath = signal<string | null>(null);
  readonly batchError = signal<string | null>(null);
  readonly pendingUploads = signal<PendingUpload[]>([]);
  /** Paths currently writing/deleting/moving — spinner on the matching tree row. */
  readonly busyPaths = signal<ReadonlySet<string>>(new Set());
  private previousExpandedPaths = new Set<string>();
  private pendingUploadSeq = 0;

  @ViewChild('rootFileInput', { static: false })
  private rootFileInput!: ElementRef<HTMLInputElement>;

  @ViewChild('folderFileInput', { static: false })
  private folderFileInput!: ElementRef<HTMLInputElement>;

  // Inputs
  clientId = input.required<string>();
  agentId = input.required<string>();
  expandedPaths = input<Set<string>>(new Set());
  selectedPath = input<string | null>(null);
  gitManagerVisible = input<boolean>(false);
  /** Files API root: workspace (`app`) or provider agent config (`config`). */
  fileManagerContext = input<FileManagerContext>('app');

  // Outputs
  fileSelect = output<string>();
  fileCreate = output<{ path: string; type: 'file' | 'directory'; name: string }>();
  fileDelete = output<string>();
  directoryExpand = output<string>();
  directoryCollapse = output<string>();
  /** Emits whenever multi-selection changes (for parent cleanup hooks). */
  selectionChange = output<string[]>();

  // Internal state
  treeNodes = signal<TreeNode[]>([]);
  treeCache = signal<Map<string, FileNodeDto[]>>(new Map());
  /** Must be created in an injection context — do not call toObservable inside switchMap. */
  private readonly treeCache$ = toObservable(this.treeCache);
  contextMenuPath = signal<string | null>(null);
  contextMenuPosition = signal<{ x: number; y: number } | null>(null);
  creatingItem = signal<{ path: string; type: 'file' | 'directory' } | null>(null);
  newItemName = signal<string>('');
  itemsToDelete = signal<Array<{ path: string; type: 'file' | 'directory' }>>([]);
  itemToRename = signal<{ path: string; type: 'file' | 'directory'; name: string } | null>(null);
  itemToMove = signal<{ path: string; type: 'file' | 'directory'; name: string } | null>(null);
  renameNewName = signal<string>('');
  moveDestinationPath = signal<string>('');
  uploadTargetPath = signal<string>('.');
  // Drag and drop state
  draggedItem = signal<{ path: string; type: 'file' | 'directory'; name: string } | null>(null);
  dragOverPath = signal<string | null>(null);
  private hoverTimeout: ReturnType<typeof setTimeout> | null = null;
  private expandedDirectorySubscriptions = new Map<string, Subscription>();

  private listParams(path: string): ListDirectoryParams {
    const c = this.fileManagerContext();

    return c === 'app' ? { path } : { path, context: c };
  }

  private listDirectoryRel(path: string): void {
    this.filesFacade.listDirectory(this.clientId(), this.agentId(), this.listParams(path));
  }

  // Computed observables for directory listings - convert computed signals to observables
  private readonly rootDirectorySignal = computed(() => {
    const clientId = this.clientId();
    const agentId = this.agentId();
    const context = this.fileManagerContext();

    if (!clientId || !agentId) {
      return null;
    }

    return { clientId, agentId, context };
  });

  readonly rootDirectory$: Observable<FileNodeDto[] | null> = toObservable(this.rootDirectorySignal).pipe(
    switchMap((config) => {
      if (!config) {
        return of(null);
      }

      return this.filesFacade.getDirectoryListing$(config.clientId, config.agentId, '.', config.context);
    }),
  );

  private readonly rootLoadingSignal = computed(() => {
    const clientId = this.clientId();
    const agentId = this.agentId();
    const context = this.fileManagerContext();

    if (!clientId || !agentId) {
      return false;
    }

    return { clientId, agentId, context };
  });

  readonly rootLoading$: Observable<boolean> = toObservable(this.rootLoadingSignal).pipe(
    switchMap((config) => {
      if (!config || typeof config === 'boolean') {
        return of(false);
      }

      // Only show loading if we don't have cached data (silent refresh).
      // Use local treeCache — store listings are invalidated on create/delete/move.
      return combineLatest([
        this.filesFacade.isListingDirectory$(config.clientId, config.agentId, '.', config.context),
        this.treeCache$,
      ]).pipe(map(([isLoading, cache]) => isLoading && !cache.has('.')));
    }),
  );

  readonly activeMutationPaths$: Observable<ReadonlySet<string>> = toObservable(this.rootDirectorySignal).pipe(
    switchMap((config) => {
      if (!config) {
        return of(new Set<string>());
      }

      return this.filesFacade.getActiveMutationPaths$(config.clientId, config.agentId, config.context);
    }),
  );

  // Helper to get directory listing observable
  getDirectoryListing$(path: string): Observable<FileNodeDto[] | null> {
    return this.filesFacade.getDirectoryListing$(this.clientId(), this.agentId(), path, this.fileManagerContext());
  }

  // Helper to get directory loading observable
  getDirectoryLoading$(path: string): Observable<boolean> {
    return this.filesFacade.isListingDirectory$(this.clientId(), this.agentId(), path, this.fileManagerContext());
  }

  constructor() {
    // Cleanup hover timeout on component destruction
    this.destroyRef.onDestroy(() => {
      this.clearHoverTimeout();
    });

    // Load root directory on init
    effect(() => {
      const clientId = this.clientId();
      const agentId = this.agentId();

      if (clientId && agentId) {
        this.filesFacade.listDirectory(clientId, agentId, this.listParams('.'));

        if (this.fileManagerContext() === 'app') {
          this.vcsFacade.loadStatus(clientId, agentId);
        }
      }
    });

    // Subscribe to all expanded directory listings to rebuild tree when they change
    effect(() => {
      const clientId = this.clientId();
      const agentId = this.agentId();
      const expanded = this.expandedPaths();

      if (!clientId || !agentId) {
        // Clean up all subscriptions if client/agent is not available
        this.expandedDirectorySubscriptions.forEach((subscription) => subscription.unsubscribe());
        this.expandedDirectorySubscriptions.clear();

        return;
      }

      // Get current expanded paths (excluding root)
      const expandedPathsArray = Array.from(expanded).filter((path) => path !== '.');
      const currentPaths = new Set(expandedPathsArray);

      // Unsubscribe from directories that are no longer expanded
      for (const [path, subscription] of this.expandedDirectorySubscriptions.entries()) {
        if (!currentPaths.has(path)) {
          subscription.unsubscribe();
          this.expandedDirectorySubscriptions.delete(path);
        }
      }

      // Subscribe to newly expanded directories
      for (const path of expandedPathsArray) {
        if (!this.expandedDirectorySubscriptions.has(path)) {
          // Subscribe to directory listing changes
          const subscription = this.getDirectoryListing$(path)
            .pipe(
              filter((listing) => listing !== null),
              takeUntilDestroyed(this.destroyRef),
            )
            .subscribe((listing) => {
              if (listing) {
                this.updateTreeCache(path, listing);
                this.rebuildTree();
              }
            });

          this.expandedDirectorySubscriptions.set(path, subscription);
        }
      }

      // Rebuild tree whenever expanded paths change (for both expand and collapse)
      this.rebuildTree();
    });

    // Prune selection when folders collapse so invisible descendants are not retained
    effect(() => {
      const expanded = this.expandedPaths();

      for (const path of this.previousExpandedPaths) {
        if (!expanded.has(path)) {
          this.selectedPaths.update((selected) => pruneSelectionAfterCollapse(selected, path));
        }
      }

      this.previousExpandedPaths = new Set(expanded);
      this.emitSelectionChange();
    });

    this.activeMutationPaths$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((paths) => {
      this.busyPaths.set(paths);
    });
  }

  ngOnInit(): void {
    this.clipboardService.setNameCollisionResolver((baseName) => this.promptNameCollision(baseName));

    // Subscribe to root directory observable with proper cleanup
    this.rootDirectory$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((nodes) => {
      if (nodes) {
        this.updateTreeCache('.', nodes);
        this.rebuildTree();
      }
    });
  }

  promptNameCollision(baseName: string): Promise<'replace' | 'keepBoth'> {
    return new Promise((resolve) => {
      this.nameCollisionName.set(baseName);
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

  isPathSelected(path: string): boolean {
    return this.selectedPaths().has(path);
  }

  isPathOpen(path: string): boolean {
    return this.selectedPath() === path;
  }

  /** Soft row highlight: path is staged on the virtual clipboard for copy. */
  isPathClipboardCopy(path: string): boolean {
    return getClipboardModeForPath(this.clipboardService.clipboard(), path) === 'copy';
  }

  /** Soft row highlight: path is staged on the virtual clipboard for cut/move. */
  isPathClipboardCut(path: string): boolean {
    return getClipboardModeForPath(this.clipboardService.clipboard(), path) === 'cut';
  }

  onFileClick(node: TreeNode, event: MouseEvent): void {
    event.stopPropagation();
    this.focusTreeHost();

    const gesture = this.resolveSelectionGesture(event);
    const visibleNodes = flattenVisibleTreeNodes(this.treeNodes());
    const result = applyFileTreeSelectionGesture({
      gesture,
      node,
      visibleNodes,
      previousSelected: this.selectedPaths(),
      selectionAnchorPath: this.selectionAnchorPath(),
    });

    this.selectedPaths.set(result.selectedPaths);
    this.selectionAnchorPath.set(result.selectionAnchorPath);
    this.emitSelectionChange();

    if (gesture === 'plain') {
      if (node.type === 'file') {
        this.fileSelect.emit(node.path);
      } else {
        this.onDirectoryToggle(node);
      }
    }
  }

  onDirectoryToggle(node: TreeNode): void {
    if (node.type !== 'directory') {
      return;
    }

    const isExpanded = this.expandedPaths().has(node.path);

    if (isExpanded) {
      // Collapse
      this.selectedPaths.update((selected) => pruneSelectionAfterCollapse(selected, node.path));
      this.emitSelectionChange();
      this.directoryCollapse.emit(node.path);
    } else {
      // Expand - load directory if not cached
      const hasCachedData = this.treeCache().has(node.path);

      if (!hasCachedData) {
        // Only show loading if we don't have cached data (silent refresh)
        node.loading = true;
        this.listDirectoryRel(node.path);
        // Subscribe to directory listing
        this.getDirectoryListing$(node.path)
          .pipe(
            filter((listing) => listing !== null),
            take(1),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe((listing) => {
            if (listing) {
              this.updateTreeCache(node.path, listing);
              node.loading = false;
              this.rebuildTree();
            }
          });
      } else {
        // We have cached data, but still reload to get fresh data (silent)
        this.listDirectoryRel(node.path);
      }

      this.directoryExpand.emit(node.path);
    }
  }

  onContextMenu(event: MouseEvent, node: TreeNode): void {
    event.preventDefault();
    event.stopPropagation();
    this.focusTreeHost();

    if (!this.selectedPaths().has(node.path)) {
      this.selectedPaths.set(new Set([node.path]));
      this.selectionAnchorPath.set(node.path);
      this.emitSelectionChange();
    }

    this.contextMenuPath.set(node.path);
    this.contextMenuPosition.set({ x: event.clientX, y: event.clientY });
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
   * Paste into the tree: OS clipboard files upload into the paste target folder
   * when present; otherwise apply the internal copy/cut clipboard.
   * In-tree Ctrl+C/X replaces the OS clipboard so stale File items cannot win over a newer selection.
   */
  onTreePaste(event: ClipboardEvent): void {
    if (this.shouldIgnorePasteTarget(event.target)) {
      return;
    }

    const files = this.getClipboardFiles(event);

    if (files.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      // A fresh OS file copy supersedes the virtual clipboard.
      this.clipboardService.clearClipboard();
      this.uploadFilesToPath(files, this.resolvePasteTargetPath());

      return;
    }

    if (this.clipboardService.clipboard()) {
      event.preventDefault();
      event.stopPropagation();
      this.pasteClipboardIntoTarget();
    }
  }

  private resolveSelectionGesture(event: MouseEvent): FileTreeSelectionGesture {
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

    if (this.deleteFileModalOpen() || this.renameFileModalOpen() || this.moveFileModalOpen()) {
      return true;
    }

    if (this.creatingItem()) {
      return true;
    }

    return false;
  }

  private getClipboardFiles(event: ClipboardEvent): File[] {
    const data = event.clipboardData;

    if (!data) {
      return [];
    }

    if (data.files?.length) {
      return Array.from(data.files);
    }

    const files: File[] = [];

    if (data.items) {
      for (let index = 0; index < data.items.length; index++) {
        const item = data.items[index];

        if (item.kind !== 'file') {
          continue;
        }

        const file = item.getAsFile();

        if (file) {
          files.push(file);
        }
      }
    }

    return files;
  }

  private resolvePasteTargetPath(): string {
    const focusPath =
      this.selectedPaths().size === 0 ? null : (this.selectionAnchorPath() ?? [...this.selectedPaths()][0] ?? null);

    return resolvePasteTargetDirectory(focusPath, (path) => this.findNodeByPath(path)?.type ?? null);
  }

  focusTreeHost(): void {
    const el = this.hostElement.nativeElement;

    if (document.activeElement !== el) {
      el.focus({ preventScroll: true });
    }
  }

  /**
   * Click on empty tree chrome (not a row): clear selection so the workspace root
   * is the implicit paste target; selection-required actions stay disabled.
   */
  onTreeBackgroundClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;

    if (target?.closest('.tree-node, .create-item-input, .context-menu, button, a, input, textarea, select')) {
      return;
    }

    this.focusTreeHost();
    this.clearTreeSelection();
  }

  clearTreeSelection(): void {
    if (this.selectedPaths().size === 0 && this.selectionAnchorPath() === null) {
      return;
    }

    this.selectedPaths.set(new Set());
    this.selectionAnchorPath.set(null);
    this.emitSelectionChange();
  }

  private emitSelectionChange(): void {
    this.selectionChange.emit([...this.selectedPaths()]);
  }

  private getSelectionRoots(): Array<{ path: string; type: 'file' | 'directory' }> {
    const roots = getTopmostSelectedPaths(this.selectedPaths());
    const items: Array<{ path: string; type: 'file' | 'directory' }> = [];

    for (const path of roots) {
      const node = this.findNodeByPath(path);

      if (node) {
        items.push({ path: node.path, type: node.type });
      }
    }

    return items;
  }

  private resolveActionTargets(path: string): Array<{ path: string; type: 'file' | 'directory' }> {
    const selected = this.selectedPaths();

    if (selected.size > 1 && selected.has(path)) {
      return this.getSelectionRoots();
    }

    const node = this.findNodeByPath(path);

    return node ? [{ path: node.path, type: node.type }] : [];
  }

  private batchContext() {
    return {
      clientId: this.clientId(),
      agentId: this.agentId(),
      context: this.fileManagerContext(),
    };
  }

  private copySelectionToClipboard(): void {
    if (this.selectedPaths().size === 0) {
      return;
    }

    const entries = buildClipboardEntries(this.selectedPaths(), (path) => this.findNodeByPath(path)?.type ?? null);

    if (entries.length === 0) {
      return;
    }

    this.clipboardService.setClipboard('copy', entries);
    void this.syncOsClipboardAfterInternalCopy(entries.map((entry) => entry.path));
  }

  private cutSelectionToClipboard(): void {
    if (this.selectedPaths().size === 0) {
      return;
    }

    const entries = buildClipboardEntries(this.selectedPaths(), (path) => this.findNodeByPath(path)?.type ?? null);

    if (entries.length === 0) {
      return;
    }

    this.clipboardService.setClipboard('cut', entries);
    void this.syncOsClipboardAfterInternalCopy(entries.map((entry) => entry.path));
  }

  /**
   * Replace the OS clipboard with path text so leftover File items from a prior
   * desktop copy do not take priority on the next Ctrl+V in the tree.
   */
  private async syncOsClipboardAfterInternalCopy(paths: string[]): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(paths.join('\n'));
    } catch {
      // Permissions / insecure context — paste may still prefer stale OS files.
    }
  }

  private pasteClipboardIntoTarget(): void {
    if (!this.clipboardService.clipboard()) {
      return;
    }

    const target = this.resolvePasteTargetPath();

    // Same as upload: expand the paste target so the first pasted item is visible.
    this.ensureUploadParentVisible(target);

    this.clipboardService.enqueuePaste(this.batchContext(), target, (result) => {
      this.listDirectoryRel(target === '.' ? '.' : target);

      for (const destination of result.destinations) {
        this.expandPathToDestination(destination);
      }

      if (result.mode === 'cut' && result.moves.length > 0) {
        this.remapSelectionAfterMoves(result.moves);
      }

      const error = this.clipboardService.lastError();

      if (error) {
        this.batchError.set(error);
      }
    });
  }

  private remapSelectionAfterMoves(moves: Array<{ source: string; destination: string }>): void {
    const selected = this.selectedPaths();

    if (selected.size === 0) {
      return;
    }

    const next = new Set<string>();

    for (const path of selected) {
      let remapped = path;

      for (const move of moves) {
        remapped = remapPathAfterMove(remapped, move.source, move.destination);
      }

      next.add(remapped);
    }

    this.selectedPaths.set(next);

    const anchor = this.selectionAnchorPath();

    if (anchor) {
      let remappedAnchor = anchor;

      for (const move of moves) {
        remappedAnchor = remapPathAfterMove(remappedAnchor, move.source, move.destination);
      }

      this.selectionAnchorPath.set(remappedAnchor);
    }

    this.emitSelectionChange();
  }

  private deleteSelectionFromHotkey(): void {
    const items = this.getSelectionRoots();

    if (items.length === 0) {
      return;
    }

    this.itemsToDelete.set(items);
    this.deleteFileModalOpen.set(true);
  }

  private renameSelectionFromHotkey(): void {
    const items = this.getSelectionRoots();

    if (items.length !== 1) {
      return;
    }

    this.onRenameItem(items[0].path);
  }

  onCopyFileLink(path: string): void {
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (!clientId || !agentId) {
      return;
    }

    // Build the URL
    const baseUrl = window.location.origin;
    const editorPath = `/clients/${clientId}/agents/${agentId}/editor`;
    const queryParams = new URLSearchParams();

    queryParams.set('standalone', 'true');
    queryParams.set('file', encodeURIComponent(path));
    const url = `${baseUrl}${editorPath}?${queryParams.toString()}`;

    // Copy to clipboard
    navigator.clipboard
      .writeText(url)
      .then(() => {
        console.log('File link copied to clipboard:', url);
      })
      .catch((err) => {
        console.error('Failed to copy file link to clipboard:', err);
        // Fallback: try using the older clipboard API
        this.fallbackCopyToClipboard(url);
      });

    this.onCloseContextMenu();
  }

  /**
   * Fallback method to copy text to clipboard for older browsers
   */
  private fallbackCopyToClipboard(text: string): void {
    const textArea = document.createElement('textarea');

    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand('copy');

      if (successful) {
        console.log('File link copied to clipboard (fallback):', text);
      } else {
        console.error('Fallback copy command failed');
      }
    } catch (err) {
      console.error('Fallback copy to clipboard failed:', err);
    } finally {
      document.body.removeChild(textArea);
    }
  }

  onOpenInNewWindow(path: string): void {
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (!clientId || !agentId) {
      return;
    }

    // Build the URL
    const baseUrl = window.location.origin;
    const editorPath = `/clients/${clientId}/agents/${agentId}/editor`;
    const queryParams = new URLSearchParams();

    queryParams.set('standalone', 'true');
    queryParams.set('file', encodeURIComponent(path));
    const url = `${baseUrl}${editorPath}?${queryParams.toString()}`;
    // Open new window with minimal controls and maximize if possible
    // Note: Modern browsers have restrictions on window features, but we try to minimize what's possible
    // Use screen dimensions to maximize the window
    const screenWidth = window.screen.availWidth || window.screen.width;
    const screenHeight = window.screen.availHeight || window.screen.height;
    const windowFeatures = [
      'menubar=no',
      'toolbar=no',
      'location=no', // Attempts to hide address bar (may be ignored by browsers)
      'status=no',
      'resizable=yes',
      'scrollbars=yes',
      `width=${screenWidth}`,
      `height=${screenHeight}`,
      `left=0`,
      `top=0`,
    ].join(',');
    const newWindow = window.open(url, '_blank', windowFeatures);

    // Try to maximize after window opens (may be blocked by browser security)
    if (newWindow) {
      // Use setTimeout to ensure window is fully loaded before attempting to maximize
      setTimeout(() => {
        try {
          newWindow.moveTo(0, 0);
          newWindow.resizeTo(screenWidth, screenHeight);

          // Try to maximize if the browser supports it
          if (newWindow.screen && 'availWidth' in newWindow.screen) {
            const availWidth = (newWindow.screen as Screen & { availWidth?: number }).availWidth;
            const availHeight = (newWindow.screen as Screen & { availHeight?: number }).availHeight;

            if (availWidth && availHeight) {
              newWindow.resizeTo(availWidth, availHeight);
            }
          }
        } catch (e) {
          // Browser may block window manipulation for security reasons
          console.warn('Could not maximize window:', e);
        }
      }, 100);
    }

    this.onCloseContextMenu();
  }

  onDragStart(event: DragEvent, node: TreeNode): void {
    if (!event.dataTransfer) {
      return;
    }

    this.draggedItem.set({ path: node.path, type: node.type, name: node.name });
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', node.path);

    // Set drag image to show what's being dragged
    if (event.currentTarget instanceof HTMLElement) {
      const treeNodeContent = event.currentTarget.querySelector('.tree-node-content');

      if (treeNodeContent) {
        const dragImage = treeNodeContent.cloneNode(true) as HTMLElement;

        dragImage.style.position = 'absolute';
        dragImage.style.top = '-1000px';
        dragImage.style.opacity = '0.8';
        dragImage.style.backgroundColor = 'var(--bs-body-bg)';
        dragImage.style.padding = '4px 8px';
        dragImage.style.border = '1px solid var(--bs-border-color)';
        dragImage.style.borderRadius = '4px';
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

  onDragEnd(): void {
    this.draggedItem.set(null);
    this.dragOverPath.set(null);
    this.clearHoverTimeout();
  }

  onDragOver(event: DragEvent, node: TreeNode): void {
    if (this.isExternalFileDrag(event)) {
      if (node.type !== 'directory') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }

      if (this.dragOverPath() === '.') {
        this.dragOverPath.set(null);
      }

      this.dragOverPath.set(node.path);

      if (!node.expanded) {
        this.startHoverTimeout(node.path);
      } else {
        this.clearHoverTimeout();
      }

      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const dragged = this.draggedItem();

    if (!dragged) {
      return;
    }

    // Only allow dropping on directories
    if (node.type !== 'directory') {
      return;
    }

    // Prevent dropping on self or parent
    if (!this.canDropOn(dragged.path, node.path)) {
      return;
    }

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    // Clear root drag-over state if we're over a child node
    if (this.dragOverPath() === '.') {
      this.dragOverPath.set(null);
    }

    // Set drag over path for visual feedback
    this.dragOverPath.set(node.path);

    // If folder is closed, start hover timeout to expand it
    if (!node.expanded) {
      this.startHoverTimeout(node.path);
    } else {
      this.clearHoverTimeout();
    }
  }

  onDragEnter(event: DragEvent, node: TreeNode): void {
    if (this.isExternalFileDrag(event)) {
      if (node.type !== 'directory') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (this.dragOverPath() === '.') {
        this.dragOverPath.set(null);
      }

      this.dragOverPath.set(node.path);

      if (!node.expanded) {
        this.startHoverTimeout(node.path);
      }

      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const dragged = this.draggedItem();

    if (!dragged) {
      return;
    }

    // Only allow dropping on directories
    if (node.type !== 'directory') {
      return;
    }

    // Prevent dropping on self or parent
    if (!this.canDropOn(dragged.path, node.path)) {
      return;
    }

    // Clear root drag-over state if we're entering a child node
    if (this.dragOverPath() === '.') {
      this.dragOverPath.set(null);
    }

    this.dragOverPath.set(node.path);

    // If folder is closed, start hover timeout to expand it
    if (!node.expanded) {
      this.startHoverTimeout(node.path);
    }
  }

  onDragLeave(event: DragEvent, node: TreeNode): void {
    event.preventDefault();
    event.stopPropagation();

    // Only clear if we're actually leaving the node (not just moving to a child)
    const relatedTarget = event.relatedTarget as HTMLElement | null;

    if (relatedTarget && event.currentTarget instanceof HTMLElement) {
      if (event.currentTarget.contains(relatedTarget)) {
        return; // Still within the node or its children
      }
    }

    // Clear drag over state if leaving this specific node
    if (this.dragOverPath() === node.path) {
      this.dragOverPath.set(null);
      this.clearHoverTimeout();
    }
  }

  onDrop(event: DragEvent, node: TreeNode): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.isExternalFileDrag(event)) {
      if (node.type !== 'directory') {
        return;
      }

      this.dragOverPath.set(null);
      this.clearHoverTimeout();
      void this.uploadDroppedItems(event, node.path);

      return;
    }

    const dragged = this.draggedItem();

    if (!dragged) {
      return;
    }

    // Only allow dropping on directories
    if (node.type !== 'directory') {
      return;
    }

    // Prevent dropping on self or parent
    if (!this.canDropOn(dragged.path, node.path)) {
      return;
    }

    // Clear drag state
    this.dragOverPath.set(null);
    this.clearHoverTimeout();

    // Build destination path
    const destinationPath = node.path === '.' ? dragged.name : `${node.path}/${dragged.name}`;

    // Don't move if source and destination are the same
    if (dragged.path === destinationPath) {
      this.draggedItem.set(null);

      return;
    }

    // Use move functionality
    this.filesFacade.moveFileOrDirectory(
      this.clientId(),
      this.agentId(),
      dragged.path,
      {
        destination: destinationPath,
      },
      this.fileManagerContext(),
    );

    this.draggedItem.set(null);

    // Refresh source parent directory
    const sourceParentPath = this.getParentPath(dragged.path);

    setTimeout(() => {
      this.listDirectoryRel(sourceParentPath);
    }, 100);

    // Refresh destination directory
    setTimeout(() => {
      this.listDirectoryRel(node.path);
    }, 200);

    // Expand target path in the tree
    this.expandPathToDestination(destinationPath);
  }

  onDragOverRoot(event: DragEvent): void {
    if (this.isExternalFileDrag(event)) {
      event.preventDefault();
      event.stopPropagation();

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }

      this.dragOverPath.set('.');

      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const dragged = this.draggedItem();

    if (!dragged) {
      return;
    }

    // Prevent dropping root items on root (they're already there)
    const sourceParentPath = this.getParentPath(dragged.path);

    if (sourceParentPath === '.') {
      return;
    }

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    // Set drag over path for visual feedback
    this.dragOverPath.set('.');
  }

  onDragEnterRoot(event: DragEvent): void {
    if (this.isExternalFileDrag(event)) {
      event.preventDefault();
      event.stopPropagation();
      this.dragOverPath.set('.');

      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const dragged = this.draggedItem();

    if (!dragged) {
      return;
    }

    // Prevent dropping root items on root (they're already there)
    const sourceParentPath = this.getParentPath(dragged.path);

    if (sourceParentPath === '.') {
      return;
    }

    this.dragOverPath.set('.');
  }

  onDragLeaveRoot(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();

    // Only clear if we're actually leaving the root container
    const relatedTarget = event.relatedTarget as HTMLElement | null;

    if (relatedTarget && event.currentTarget instanceof HTMLElement) {
      if (event.currentTarget.contains(relatedTarget)) {
        return; // Still within the root container
      }
    }

    // Clear drag over state if leaving root
    if (this.dragOverPath() === '.') {
      this.dragOverPath.set(null);
    }
  }

  onDropRoot(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.isExternalFileDrag(event)) {
      this.dragOverPath.set(null);
      this.clearHoverTimeout();
      void this.uploadDroppedItems(event, '.');

      return;
    }

    const dragged = this.draggedItem();

    if (!dragged) {
      return;
    }

    // Prevent dropping root items on root (they're already there)
    const sourceParentPath = this.getParentPath(dragged.path);

    if (sourceParentPath === '.') {
      this.draggedItem.set(null);
      this.dragOverPath.set(null);

      return;
    }

    // Clear drag state
    this.dragOverPath.set(null);
    this.clearHoverTimeout();

    // Build destination path (root is '.', so destination is just the name)
    const destinationPath = dragged.name;

    // Don't move if source and destination are the same
    if (dragged.path === destinationPath) {
      this.draggedItem.set(null);

      return;
    }

    // Use move functionality
    this.filesFacade.moveFileOrDirectory(
      this.clientId(),
      this.agentId(),
      dragged.path,
      {
        destination: destinationPath,
      },
      this.fileManagerContext(),
    );

    this.draggedItem.set(null);

    // Refresh source parent directory
    setTimeout(() => {
      this.listDirectoryRel(sourceParentPath);
    }, 100);

    // Refresh root directory
    setTimeout(() => {
      this.listDirectoryRel('.');
    }, 200);
  }

  /**
   * Check if an item can be dropped on a target path
   */
  private canDropOn(sourcePath: string, targetPath: string): boolean {
    // Can't drop on self
    if (sourcePath === targetPath) {
      return false;
    }

    // Can't drop a directory into itself or its children
    if (targetPath.startsWith(sourcePath + '/')) {
      return false;
    }

    return true;
  }

  /**
   * Start hover timeout to expand a folder after 1 second
   */
  private startHoverTimeout(path: string): void {
    this.clearHoverTimeout();
    this.hoverTimeout = setTimeout(() => {
      if (!this.expandedPaths().has(path)) {
        this.directoryExpand.emit(path);
        // Load directory if not cached
        const hasCachedData = this.treeCache().has(path);

        if (!hasCachedData) {
          this.listDirectoryRel(path);
        }
      }

      this.hoverTimeout = null;
    }, 1000); // 1 second delay
  }

  /**
   * Clear hover timeout
   */
  private clearHoverTimeout(): void {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }
  }

  onCloseContextMenu(): void {
    this.contextMenuPath.set(null);
    this.contextMenuPosition.set(null);
  }

  onCreateItem(type: 'file' | 'directory', parentPath?: string): void {
    const path = parentPath || '.';

    this.creatingItem.set({ path, type });
    this.newItemName.set('');
  }

  onConfirmCreate(): void {
    const creating = this.creatingItem();

    if (!creating || !this.newItemName().trim()) {
      return;
    }

    const name = this.newItemName().trim();

    this.fileCreate.emit({
      path: creating.path,
      type: creating.type,
      name,
    });

    // Wait a bit for the file/directory to be created, then refresh the parent directory listing
    setTimeout(() => {
      this.listDirectoryRel(creating.path);
    }, 100);

    this.creatingItem.set(null);
    this.newItemName.set('');
  }

  onCancelCreate(): void {
    this.creatingItem.set(null);
    this.newItemName.set('');
  }

  onDeleteItem(path: string): void {
    const targets = this.resolveActionTargets(path);

    if (targets.length === 0) {
      return;
    }

    this.itemsToDelete.set(targets);
    this.deleteFileModalOpen.set(true);
    this.onCloseContextMenu();
  }

  onRenameItem(path: string): void {
    const targets = this.resolveActionTargets(path);

    if (targets.length !== 1) {
      this.onCloseContextMenu();

      return;
    }

    const node = this.findNodeByPath(targets[0].path);

    if (node) {
      this.itemToRename.set({ path: node.path, type: node.type, name: node.name });
      this.renameNewName.set(node.name);
      this.renameFileModalOpen.set(true);
      this.onCloseContextMenu();
    }
  }

  onMoveItem(path: string): void {
    const targets = this.resolveActionTargets(path);

    // Move modal remains single-item; multi uses cut/paste
    if (targets.length !== 1) {
      this.onCloseContextMenu();

      return;
    }

    const node = this.findNodeByPath(targets[0].path);

    if (node) {
      this.itemToMove.set({ path: node.path, type: node.type, name: node.name });
      // Set initial destination to parent directory
      const parentPath = this.getParentPath(node.path);

      this.moveDestinationPath.set(parentPath);
      this.moveFileModalOpen.set(true);
      this.onCloseContextMenu();
    }
  }

  onCopySelection(): void {
    this.copySelectionToClipboard();
    this.onCloseContextMenu();
  }

  onCutSelection(): void {
    this.cutSelectionToClipboard();
    this.onCloseContextMenu();
  }

  onPasteSelection(): void {
    this.pasteClipboardIntoTarget();
    this.onCloseContextMenu();
  }

  confirmDeleteItem(): void {
    const items = this.itemsToDelete();

    if (items.length === 0) {
      return;
    }

    const roots = getTopmostSelectedPaths(items.map((item) => item.path));
    const pathsToDelete = roots;

    this.deleteFileModalOpen.set(false);
    this.itemsToDelete.set([]);

    this.clipboardService.enqueueDelete(this.batchContext(), pathsToDelete, (deleted) => {
      for (const path of deleted) {
        this.fileDelete.emit(path);
        this.removeFromCache(path);
        this.selectedPaths.update((selected) => {
          const next = new Set(selected);

          next.delete(path);

          for (const selectedPath of selected) {
            if (selectedPath === path || selectedPath.startsWith(`${path}/`)) {
              next.delete(selectedPath);
            }
          }

          return next;
        });
      }

      this.emitSelectionChange();

      const parents = new Set(deleted.map((path) => this.getParentPath(path)));

      for (const parent of parents) {
        this.listDirectoryRel(parent);
      }

      const error = this.clipboardService.lastError();

      if (error) {
        this.batchError.set(error);
      }
    });
  }

  confirmRenameItem(): void {
    const item = this.itemToRename();
    const newName = this.renameNewName().trim();

    if (!item || !newName || newName === item.name) {
      return;
    }

    // Get parent path
    const parentPath = this.getParentPath(item.path);
    // Build destination path: parentPath/newName
    const destinationPath = parentPath === '.' ? newName : `${parentPath}/${newName}`;

    // Use move functionality to rename
    this.filesFacade.moveFileOrDirectory(
      this.clientId(),
      this.agentId(),
      item.path,
      {
        destination: destinationPath,
      },
      this.fileManagerContext(),
    );

    this.renameFileModalOpen.set(false);
    this.itemToRename.set(null);
    this.renameNewName.set('');

    // Refresh the parent directory listing to update the tree
    setTimeout(() => {
      this.listDirectoryRel(parentPath);
    }, 100);
  }

  confirmMoveItem(): void {
    const item = this.itemToMove();
    const destinationPath = this.moveDestinationPath().trim();

    if (!item || !destinationPath) {
      return;
    }

    // Build full destination path
    const fullDestinationPath = destinationPath === '.' ? item.name : `${destinationPath}/${item.name}`;

    // Don't move if source and destination are the same
    if (item.path === fullDestinationPath) {
      this.moveFileModalOpen.set(false);
      this.itemToMove.set(null);
      this.moveDestinationPath.set('');

      return;
    }

    // Use move functionality
    this.filesFacade.moveFileOrDirectory(
      this.clientId(),
      this.agentId(),
      item.path,
      {
        destination: fullDestinationPath,
      },
      this.fileManagerContext(),
    );

    this.moveFileModalOpen.set(false);
    this.itemToMove.set(null);
    this.moveDestinationPath.set('');

    // Refresh source parent directory
    const sourceParentPath = this.getParentPath(item.path);

    setTimeout(() => {
      this.listDirectoryRel(sourceParentPath);
    }, 100);

    // Refresh destination directory and expand target path in the tree
    const destinationParentPath = this.getParentPath(fullDestinationPath);

    setTimeout(() => {
      this.listDirectoryRel(destinationParentPath);
    }, 200);

    // Expand target path in the tree
    this.expandPathToDestination(fullDestinationPath);
  }

  cancelRenameItem(): void {
    this.renameFileModalOpen.set(false);
    this.itemToRename.set(null);
    this.renameNewName.set('');
  }

  cancelMoveItem(): void {
    this.moveFileModalOpen.set(false);
    this.itemToMove.set(null);
    this.moveDestinationPath.set('');
  }

  /**
   * Expands all parent directories leading to the destination path
   */
  private expandPathToDestination(destinationPath: string): void {
    // Build array of all parent paths that need to be expanded
    const pathsToExpand: string[] = [];
    let currentPath = destinationPath;

    // Extract all parent directory paths
    while (currentPath && currentPath !== '.') {
      const parentPath = this.getParentPath(currentPath);

      if (parentPath !== '.' && !pathsToExpand.includes(parentPath)) {
        pathsToExpand.unshift(parentPath); // Add to beginning to expand from root to target
      }

      currentPath = parentPath;
    }

    // Expand each path with a small delay to ensure proper loading
    pathsToExpand.forEach((path, index) => {
      setTimeout(() => {
        if (!this.expandedPaths().has(path)) {
          this.directoryExpand.emit(path);
          // Load directory if not cached
          const hasCachedData = this.treeCache().has(path);

          if (!hasCachedData) {
            this.listDirectoryRel(path);
          }
        }
      }, index * 100); // 100ms delay between each expansion
    });
  }

  private getParentPath(path: string): string {
    if (path === '.' || !path.includes('/')) {
      return '.';
    }

    const lastSlashIndex = path.lastIndexOf('/');

    if (lastSlashIndex === -1) {
      return '.';
    }

    return path.substring(0, lastSlashIndex) || '.';
  }

  private removeFromCache(path: string): void {
    const cache = new Map(this.treeCache());
    // Remove the deleted item from its parent directory's cache
    const parentPath = this.getParentPath(path);
    const parentListing = cache.get(parentPath);

    if (parentListing) {
      const updatedListing = parentListing.filter((node) => node.path !== path);

      cache.set(parentPath, updatedListing);
    }

    // Remove the item's own cache entry
    cache.delete(path);

    // If it's a directory, recursively remove all child directory cache entries
    // Child paths will be like "parent/child" or "parent/child/grandchild"
    if (path !== '.') {
      const pathPrefix = `${path}/`;
      const keysToDelete: string[] = [];

      for (const cacheKey of cache.keys()) {
        // Remove all cache entries that start with the deleted path (its children)
        if (cacheKey.startsWith(pathPrefix)) {
          keysToDelete.push(cacheKey);
        }
      }

      keysToDelete.forEach((key) => cache.delete(key));
    }

    // Update cache and rebuild tree immediately to reflect the removal
    this.treeCache.set(cache);
    this.rebuildTree();
  }

  /**
   * Parse git repository URL to extract owner/repo
   */
  parseGitRepository(gitUrl: string | null | undefined): string | null {
    if (!gitUrl) {
      return null;
    }

    try {
      if (gitUrl.startsWith('http://') || gitUrl.startsWith('https://')) {
        const urlObj = new URL(gitUrl);
        const pathParts = urlObj.pathname.split('/').filter((part) => part.length > 0);

        if (pathParts.length >= 2) {
          const owner = pathParts[0];
          const repo = pathParts[1].replace(/\.git$/, '');

          return `${owner}/${repo}`;
        }
      }

      if (gitUrl.startsWith('git@')) {
        const match = gitUrl.match(/git@[^:]+:(.+?)(?:\.git)?$/);

        if (match && match[1]) {
          return match[1];
        }
      }

      const match = gitUrl.match(/(?:[/:])([^/]+)\/([^/]+?)(?:\.git)?$/);

      if (match && match[1] && match[2]) {
        return `${match[1]}/${match[2]}`;
      }

      return null;
    } catch {
      return null;
    }
  }

  findNodeByPath(path: string): TreeNode | null {
    const findInNodes = (nodes: TreeNode[]): TreeNode | null => {
      for (const node of nodes) {
        if (node.path === path) {
          return node;
        }

        if (node.children) {
          const found = findInNodes(node.children);

          if (found) {
            return found;
          }
        }
      }

      return null;
    };

    return findInNodes(this.treeNodes());
  }

  private updateTreeCache(path: string, nodes: FileNodeDto[]): void {
    const cache = new Map(this.treeCache());

    cache.set(path, nodes);
    this.treeCache.set(cache);
  }

  private rebuildTree(): void {
    const rootNodes = this.treeCache().get('.') || [];
    const expanded = this.expandedPaths();
    const tree = this.buildTree(rootNodes, '.', expanded);

    this.treeNodes.set(tree);
  }

  private buildTree(nodes: FileNodeDto[], basePath: string, expandedPaths: Set<string>): TreeNode[] {
    const tree: TreeNode[] = [];

    for (const node of nodes) {
      const isExpanded = expandedPaths.has(node.path);
      const children: TreeNode[] = [];

      // If directory is expanded, load its children
      if (node.type === 'directory' && isExpanded) {
        const childNodes = this.treeCache().get(node.path) || [];

        children.push(...this.buildTree(childNodes, node.path, expandedPaths));
      }

      tree.push({
        name: node.name,
        path: node.path,
        type: node.type,
        size: node.size,
        modifiedAt: node.modifiedAt,
        children: children.length > 0 ? children : undefined,
        expanded: isExpanded,
      });
    }

    // Sort: directories first, then files, both alphabetically
    tree.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });

    return tree;
  }

  getIcon(node: TreeNode): string {
    if (node.type === 'directory') {
      return node.expanded ? 'bi-folder2-open' : 'bi-folder';
    }

    return this.getPendingUploadIcon(node.name);
  }

  getPendingUploadIcon(fileName: string): string {
    return fileIconClassForName(fileName);
  }

  pendingUploadsFor(parentPath: string): PendingUpload[] {
    return this.pendingUploads().filter((upload) => upload.parentPath === parentPath);
  }

  hasPendingUploads(parentPath: string): boolean {
    return this.pendingUploads().some((upload) => upload.parentPath === parentPath);
  }

  isPathBusy(path: string): boolean {
    return this.busyPaths().has(path);
  }

  getLevelArray(level: number): number[] {
    return Array.from({ length: level }, (_, i) => i);
  }

  getCreateItemPlaceholder(): string {
    const item = this.creatingItem();

    if (!item) return '';

    return item.type === 'file'
      ? $localize`:@@featureFileTree-enterFileName:Enter file name...`
      : $localize`:@@featureFileTree-enterFolderName:Enter folder name...`;
  }

  getDeleteModalTitle(): string {
    const items = this.itemsToDelete();

    if (items.length === 0) return '';

    if (items.length > 1) {
      return $localize`:@@featureFileTree-deleteMultipleTitle:Delete Items`;
    }

    return items[0].type === 'directory'
      ? $localize`:@@featureFileTree-deleteDirectoryTitle:Delete Directory`
      : $localize`:@@featureFileTree-deleteFileTitle:Delete File`;
  }

  getDeleteModalMessage(): string {
    const items = this.itemsToDelete();

    if (items.length === 0) return '';

    if (items.length > 1) {
      const count = items.length;

      return $localize`:@@featureFileTree-deleteMultipleMessage:Are you sure you want to delete ${count}:count: items?`;
    }

    const path = items[0].path;

    return items[0].type === 'directory'
      ? $localize`:@@featureFileTree-deleteDirectoryMessage:Are you sure you want to delete the directory ${path}?:path:`
      : $localize`:@@featureFileTree-deleteFileMessage:Are you sure you want to delete the file ${path}?:path:`;
  }

  getRenameModalMessage(): string {
    const item = this.itemToRename();

    if (!item) return '';

    const path = item.path;

    return item.type === 'directory'
      ? $localize`:@@featureFileTree-renameDirectoryMessage:Enter a new name for the directory ${path}:path:`
      : $localize`:@@featureFileTree-renameFileMessage:Enter a new name for the file ${path}:path:`;
  }

  getRenameModalTitle(): string {
    const item = this.itemToRename();

    if (!item) return '';

    return item.type === 'directory'
      ? $localize`:@@featureFileTree-renameDirectoryTitle:Rename Directory`
      : $localize`:@@featureFileTree-renameFileTitle:Rename File`;
  }

  getMoveModalTitle(): string {
    const item = this.itemToMove();

    if (!item) return '';

    return item.type === 'directory'
      ? $localize`:@@featureFileTree-moveDirectoryTitle:Move Directory`
      : $localize`:@@featureFileTree-moveFileTitle:Move File`;
  }

  getMoveModalMessage(): string {
    const item = this.itemToMove();

    if (!item) return '';

    const path = item.path;

    return item.type === 'directory'
      ? $localize`:@@featureFileTree-moveDirectoryMessage:Move the directory ${path} to::path:`
      : $localize`:@@featureFileTree-moveFileMessage:Move the file ${path} to::path:`;
  }

  getMoveDestinationLabel(): string {
    const item = this.itemToMove();

    if (!item) return '';

    const dest = this.moveDestinationPath();
    const name = item.name;
    const result = dest === '.' ? name : dest + '/' + name;

    return item.type === 'directory'
      ? $localize`:@@featureFileTree-moveDirectoryDestination:The directory will be moved to: ${result}:result:`
      : $localize`:@@featureFileTree-moveFileDestination:The file will be moved to: ${result}:result:`;
  }

  onRefreshRoot(): void {
    // Refresh root and all expanded directories
    const expanded = this.expandedPaths();
    const pathsToRefresh = new Set<string>();

    // Always refresh root
    pathsToRefresh.add('.');

    // Add all expanded directories
    expanded.forEach((path) => {
      if (path !== '.') {
        pathsToRefresh.add(path);
      }
    });

    // Refresh all paths with small delays to prevent cancellation
    const pathsArray = Array.from(pathsToRefresh);

    pathsArray.forEach((path, index) => {
      setTimeout(() => {
        this.listDirectoryRel(path);
      }, index * 50); // 50ms delay between each call
    });
  }

  onRefreshFolder(folderPath: string): void {
    // Refresh the folder and all its expanded subfolders recursively
    const expanded = this.expandedPaths();
    const pathsToRefresh = new Set<string>();

    // Always refresh the folder itself
    pathsToRefresh.add(folderPath);

    // Find all expanded subdirectories under this folder
    const folderPrefix = folderPath === '.' ? '' : `${folderPath}/`;

    expanded.forEach((path) => {
      // Include if it's a subdirectory of the folder
      if (path !== folderPath && (folderPath === '.' || path.startsWith(folderPrefix))) {
        pathsToRefresh.add(path);
      }
    });

    // Refresh all paths with small delays to prevent cancellation
    // Sort paths to refresh parent before children
    const pathsArray = Array.from(pathsToRefresh).sort((a, b) => {
      // Sort by depth (shorter paths first) to refresh parents before children
      const depthA = a === '.' ? 0 : a.split('/').length;
      const depthB = b === '.' ? 0 : b.split('/').length;

      return depthA - depthB;
    });

    pathsArray.forEach((path, index) => {
      setTimeout(() => {
        this.listDirectoryRel(path);
      }, index * 50); // 50ms delay between each call
    });
  }

  onUploadFile(parentPath?: string): void {
    const targetPath = parentPath ?? this.resolveHeaderUploadTarget();

    this.uploadTargetPath.set(targetPath);

    // Use root input for root, folder input for folders
    const fileInput = targetPath === '.' ? this.rootFileInput : this.folderFileInput;

    if (fileInput?.nativeElement) {
      fileInput.nativeElement.click();
    }
  }

  /** Header upload: single selected directory, otherwise workspace root. */
  private resolveHeaderUploadTarget(): string {
    const selected = this.selectedPaths();

    if (selected.size !== 1) {
      return '.';
    }

    const [only] = selected;
    const node = this.findNodeByPath(only);

    return node?.type === 'directory' ? only : '.';
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;

    if (!files || files.length === 0) {
      return;
    }

    const targetPath = this.uploadTargetPath();

    this.uploadFilesToPath(Array.from(files), targetPath);

    // Reset input
    input.value = '';
  }

  /**
   * True when the drag payload comes from the OS file manager (not an in-tree move).
   */
  private isExternalFileDrag(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;

    if (!types) {
      return false;
    }

    return Array.from(types).includes('Files');
  }

  private getDroppedFileSystemEntries(dataTransfer: DataTransfer): DroppedFileSystemEntry[] {
    const entries: DroppedFileSystemEntry[] = [];

    if (!dataTransfer.items) {
      return entries;
    }

    for (let index = 0; index < dataTransfer.items.length; index++) {
      const item = dataTransfer.items[index];

      if (item.kind !== 'file') {
        continue;
      }

      const entry = item.webkitGetAsEntry?.() as DroppedFileSystemEntry | null;

      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  private readAllDirectoryEntries(reader: DroppedFileSystemDirectoryReader): Promise<DroppedFileSystemEntry[]> {
    return new Promise((resolve, reject) => {
      const allEntries: DroppedFileSystemEntry[] = [];

      const readBatch = (): void => {
        reader.readEntries(
          (entries) => {
            if (entries.length === 0) {
              resolve(allEntries);

              return;
            }

            allEntries.push(...entries);
            readBatch();
          },
          (error) => reject(error),
        );
      };

      readBatch();
    });
  }

  private collectUploadEntries(
    entry: DroppedFileSystemEntry,
    relativePath: string,
    files: CollectedUploadFile[],
    directories: Set<string>,
  ): Promise<void> {
    const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isFile) {
      return new Promise((resolve, reject) => {
        entry.file(
          (file) => {
            files.push({ relativePath: entryPath, file });
            resolve();
          },
          (error) => reject(error),
        );
      });
    }

    if (entry.isDirectory) {
      directories.add(entryPath);

      return this.readAllDirectoryEntries(entry.createReader()).then((childEntries) =>
        Promise.all(
          childEntries.map((childEntry) => this.collectUploadEntries(childEntry, entryPath, files, directories)),
        ).then(() => undefined),
      );
    }

    return Promise.resolve();
  }

  private buildFullUploadPath(targetPath: string, relativePath: string): string {
    return targetPath === '.' ? relativePath : `${targetPath}/${relativePath}`;
  }

  private awaitUploadFileContent(fullPath: string, bytes: ArrayBuffer, file: File, replace = false): Promise<void> {
    const writeDto: WriteFileDto = {
      bytes,
      fileType: mimeToAgentFileType(file.type),
      contentType: file.type || 'application/octet-stream',
    };
    const onProgress = (loaded: number, total: number): void => {
      const progress = total > 0 ? Math.round((loaded / total) * 100) : 0;

      this.updatePendingUploadProgress(fullPath, progress);
    };
    const putBytes = async (): Promise<void> => {
      const clientId = this.clientId();
      const agentId = this.agentId();
      const context = this.fileManagerContext();
      // Snapshot before HTTP — large uploads may detach/transfer the request ArrayBuffer.
      const snapshot: WriteFileDto = {
        ...writeDto,
        bytes: writeDto.bytes.slice(0),
      };

      try {
        await firstValueFrom(this.filesService.writeFile(clientId, agentId, fullPath, writeDto, context, onProgress));
        const content = await this.filesService.materializeWriteContent(clientId, agentId, fullPath, context, snapshot);

        this.store.dispatch(
          writeFileSuccess({
            clientId,
            agentId,
            filePath: fullPath,
            content,
            context,
          }),
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        this.store.dispatch(
          writeFileFailure({
            clientId,
            agentId,
            filePath: fullPath,
            error: message,
            context,
          }),
        );
        throw error;
      }
    };

    if (replace) {
      return putBytes();
    }

    // Subscribe before dispatch so a fast create success is not missed.
    const created = firstValueFrom(
      this.actions$.pipe(
        ofType(createFileOrDirectorySuccess, createFileOrDirectoryFailure),
        filter(
          (action) =>
            action.clientId === this.clientId() && action.agentId === this.agentId() && action.filePath === fullPath,
        ),
        take(1),
        map((action) => {
          if (action.type === createFileOrDirectoryFailure.type) {
            throw new Error(action.error);
          }
        }),
      ),
    );

    this.filesFacade.createFileOrDirectory(
      this.clientId(),
      this.agentId(),
      fullPath,
      { type: 'file' },
      this.fileManagerContext(),
    );

    return created.then(() => putBytes());
  }

  private updatePendingUploadProgress(path: string, progress: number): void {
    this.pendingUploads.update((current) =>
      current.map((pending) => (pending.path === path ? { ...pending, progress } : pending)),
    );
  }

  private uploadFilesToPath(files: File[], targetPath: string): void {
    if (files.length === 0) {
      return;
    }

    this.uploadTargetPath.set(targetPath);
    this.ensureUploadParentVisible(targetPath);

    void this.uploadFilesToPathQueued(files, targetPath);
  }

  private async uploadFilesToPathQueued(files: File[], targetPath: string): Promise<void> {
    const siblings = this.treeCache().get(targetPath === '.' ? '.' : targetPath) ?? [];
    const siblingNames = new Set(siblings.map((node) => node.name));
    const uploadedPaths: string[] = [];
    const pendingPaths: string[] = [];

    for (const file of files) {
      const baseName = file.name;
      const existing = siblings.find((node) => node.name.toLowerCase() === baseName.toLowerCase());
      let finalName = baseName;
      let replace = false;

      if (existing) {
        if (existing.type === 'directory') {
          finalName = suggestCopyBasename(baseName, siblingNames);
        } else {
          const choice = await this.promptNameCollision(baseName);

          if (choice === 'replace') {
            replace = true;
            finalName = existing.name;
          } else {
            finalName = suggestCopyBasename(baseName, siblingNames);
          }
        }
      }

      const fullPath = this.buildFullUploadPath(targetPath, finalName);

      pendingPaths.push(fullPath);
      this.registerPendingUploads([{ path: fullPath, type: 'file' }]);
      siblingNames.add(finalName);

      try {
        const bytes = await file.arrayBuffer();

        await this.awaitUploadFileContent(fullPath, bytes, file, replace);
        uploadedPaths.push(fullPath);
      } catch (error: unknown) {
        console.error(error);
        this.clearPendingUploads([fullPath]);
      }
    }

    this.clearPendingUploads(pendingPaths);
    this.refreshUploadedDirectories(targetPath);

    if (this.fileManagerContext() === 'app') {
      setTimeout(() => {
        this.vcsFacade.loadStatus(this.clientId(), this.agentId());
      }, 500);
    }

    if (uploadedPaths.length === 1) {
      setTimeout(() => {
        this.fileSelect.emit(uploadedPaths[0]);
      }, 500);
    }
  }

  private async uploadDroppedItems(event: DragEvent, targetPath: string): Promise<void> {
    const dataTransfer = event.dataTransfer;

    if (!dataTransfer) {
      return;
    }

    this.uploadTargetPath.set(targetPath);
    this.ensureUploadParentVisible(targetPath);

    const entries = this.getDroppedFileSystemEntries(dataTransfer);

    if (entries.length === 0) {
      if (dataTransfer.files.length > 0) {
        this.uploadFilesToPath(Array.from(dataTransfer.files), targetPath);
      }

      return;
    }

    // Register top-level drop names immediately so placeholders appear before deep walks finish.
    this.registerPendingUploads(
      entries.map((entry) => ({
        path: this.buildFullUploadPath(targetPath, entry.name),
        type: entry.isDirectory ? ('directory' as const) : ('file' as const),
      })),
    );

    const filesToUpload: CollectedUploadFile[] = [];
    const directories = new Set<string>();

    try {
      await Promise.all(entries.map((entry) => this.collectUploadEntries(entry, '', filesToUpload, directories)));
    } catch (error) {
      console.error('Failed to read dropped files:', error);
      this.clearPendingUploads(entries.map((entry) => this.buildFullUploadPath(targetPath, entry.name)));

      return;
    }

    const sortedDirectories = Array.from(directories).sort(
      (left, right) => left.split('/').length - right.split('/').length,
    );
    const pendingCreatePaths: string[] = [];
    const expandedDirectoryPaths: string[] = [];

    // Replace early top-level placeholders with the full nested path set once known.
    const nestedPending = [
      ...sortedDirectories.map((relativeDirectory) => ({
        path: this.buildFullUploadPath(targetPath, relativeDirectory),
        type: 'directory' as const,
      })),
      ...filesToUpload.map(({ relativePath }) => ({
        path: this.buildFullUploadPath(targetPath, relativePath),
        type: 'file' as const,
      })),
    ];

    this.clearPendingUploads(entries.map((entry) => this.buildFullUploadPath(targetPath, entry.name)));
    this.registerPendingUploads(nestedPending);

    for (const relativeDirectory of sortedDirectories) {
      const fullDirectoryPath = this.buildFullUploadPath(targetPath, relativeDirectory);

      pendingCreatePaths.push(fullDirectoryPath);

      try {
        await this.awaitCreateDirectory(fullDirectoryPath);
      } catch (error: unknown) {
        console.error(error);
        this.clearPendingUploads([fullDirectoryPath]);
      }

      if (!this.expandedPaths().has(fullDirectoryPath)) {
        this.directoryExpand.emit(fullDirectoryPath);
        expandedDirectoryPaths.push(fullDirectoryPath);
      }
    }

    const uploadedPaths: string[] = [];

    for (const { relativePath, file } of filesToUpload) {
      const fullPath = this.buildFullUploadPath(targetPath, relativePath);

      pendingCreatePaths.push(fullPath);

      try {
        const bytes = await file.arrayBuffer();

        await this.awaitUploadFileContent(fullPath, bytes, file);
        uploadedPaths.push(fullPath);
      } catch (error: unknown) {
        console.error(error);
        this.clearPendingUploads([fullPath]);
      }
    }

    this.clearPendingUploads(pendingCreatePaths);
    this.refreshUploadedDirectories(targetPath, expandedDirectoryPaths);

    if (this.fileManagerContext() === 'app') {
      setTimeout(() => {
        this.vcsFacade.loadStatus(this.clientId(), this.agentId());
      }, 500);
    }

    if (uploadedPaths.length === 1) {
      setTimeout(() => {
        this.fileSelect.emit(uploadedPaths[0]);
      }, 500);
    }
  }

  private awaitCreateDirectory(fullPath: string): Promise<void> {
    const created = firstValueFrom(
      this.actions$.pipe(
        ofType(createFileOrDirectorySuccess, createFileOrDirectoryFailure),
        filter(
          (action) =>
            action.clientId === this.clientId() && action.agentId === this.agentId() && action.filePath === fullPath,
        ),
        take(1),
        map((action) => {
          if (action.type === createFileOrDirectoryFailure.type) {
            throw new Error(action.error);
          }
        }),
      ),
    );

    this.filesFacade.createFileOrDirectory(
      this.clientId(),
      this.agentId(),
      fullPath,
      { type: 'directory' },
      this.fileManagerContext(),
    );

    return created;
  }

  private registerPendingUploads(entries: Array<{ path: string; type: 'file' | 'directory' }>): void {
    if (entries.length === 0) {
      return;
    }

    this.pendingUploads.update((current) => {
      const next = [...current];

      for (const entry of entries) {
        if (next.some((pending) => pending.path === entry.path)) {
          continue;
        }

        this.pendingUploadSeq += 1;
        next.push({
          id: `upload-${this.pendingUploadSeq}-${entry.path}`,
          path: entry.path,
          name: entry.path.includes('/') ? entry.path.slice(entry.path.lastIndexOf('/') + 1) : entry.path,
          parentPath: this.getParentPath(entry.path),
          type: entry.type,
        });
      }

      return next;
    });

    for (const entry of entries) {
      this.ensureAncestorsExpanded(entry.path);
    }
  }

  private clearPendingUploads(paths: string[]): void {
    if (paths.length === 0) {
      return;
    }

    const pathSet = new Set(paths);

    this.pendingUploads.update((current) => current.filter((pending) => !pathSet.has(pending.path)));
  }

  private ensureUploadParentVisible(targetPath: string): void {
    if (targetPath === '.') {
      return;
    }

    if (!this.expandedPaths().has(targetPath)) {
      this.directoryExpand.emit(targetPath);
    }

    if (!this.treeCache().has(targetPath)) {
      this.listDirectoryRel(targetPath);
    }
  }

  /** Expand every ancestor folder so nested upload placeholders are visible. */
  private ensureAncestorsExpanded(path: string): void {
    let current = this.getParentPath(path);

    while (current && current !== '.') {
      this.ensureUploadParentVisible(current);
      current = this.getParentPath(current);
    }
  }

  private refreshUploadedDirectories(targetPath: string, expandedDirectoryPaths: string[] = []): void {
    const pathsToRefresh = [...new Set([targetPath, ...expandedDirectoryPaths])].sort(
      (left, right) => left.split('/').length - right.split('/').length,
    );

    pathsToRefresh.forEach((path, index) => {
      setTimeout(() => {
        this.listDirectoryRel(path);
      }, index * 50);
    });
  }
}
