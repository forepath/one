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
  AgentsFacade,
  ClientsFacade,
  FilesFacade,
  VcsFacade,
  type FileManagerContext,
  type FileNodeDto,
  type ListDirectoryParams,
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
import { combineLatest, filter, map, Observable, of, Subscription, switchMap, take } from 'rxjs';

import { getGitRepositoryDisplayLabel } from '../../git-repository-display';
import { GitBranchModalComponent } from '../git-branch-modal/git-branch-modal.component';

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

@Component({
  selector: 'framework-file-tree',
  imports: [
    CommonModule,
    FormsModule,
    GitBranchModalComponent,
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
})
export class FileTreeComponent implements OnInit {
  private readonly filesFacade = inject(FilesFacade);
  private readonly clientsFacade = inject(ClientsFacade);
  private readonly agentsFacade = inject(AgentsFacade);
  private readonly vcsFacade = inject(VcsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly deleteFileModalOpen = signal(false);
  readonly renameFileModalOpen = signal(false);
  readonly moveFileModalOpen = signal(false);

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
  toggleGitManager = output<void>();

  // Internal state
  treeNodes = signal<TreeNode[]>([]);
  treeCache = signal<Map<string, FileNodeDto[]>>(new Map());
  contextMenuPath = signal<string | null>(null);
  contextMenuPosition = signal<{ x: number; y: number } | null>(null);
  creatingItem = signal<{ path: string; type: 'file' | 'directory' } | null>(null);
  newItemName = signal<string>('');
  itemToDelete = signal<{ path: string; type: 'file' | 'directory' } | null>(null);
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
        toObservable(this.treeCache),
      ]).pipe(map(([isLoading, cache]) => isLoading && !cache.has('.')));
    }),
  );

  readonly clientRepositoryName$: Observable<string | null> = combineLatest([
    toObservable(this.clientId),
    toObservable(this.agentId),
  ]).pipe(
    switchMap(([clientId, agentId]) => {
      if (!clientId || !agentId) {
        return of(null);
      }

      return combineLatest([
        this.clientsFacade.getClientById$(clientId),
        this.agentsFacade
          .getClientAgents$(clientId)
          .pipe(map((agents) => agents.find((agent) => agent.id === agentId) ?? null)),
      ]).pipe(map(([client, agent]) => getGitRepositoryDisplayLabel(agent, client?.config ?? null)));
    }),
  );

  // Git status observables
  readonly gitStatus$ = this.vcsFacade.status$;
  readonly currentBranch$ = this.vcsFacade.currentBranch$;
  readonly statusIndicator$ = this.vcsFacade.statusIndicator$;
  readonly loadingStatus$ = this.vcsFacade.loadingStatus$;
  readonly staging$ = this.vcsFacade.staging$;
  readonly unstaging$ = this.vcsFacade.unstaging$;
  readonly committing$ = this.vcsFacade.committing$;

  // Track if content has been loaded (for spinner display)
  private hasLoadedContent = signal<boolean>(false);
  readonly hasLoadedContent$ = toObservable(this.hasLoadedContent);
  private isReloadingAfterOperation = signal<boolean>(false);
  readonly isReloadingAfterOperation$ = toObservable(this.isReloadingAfterOperation);

  // Combined observable: true if any operation is in progress OR status is loading OR reloading after operation
  readonly isAnyOperationInProgress$ = combineLatest([
    this.staging$,
    this.unstaging$,
    this.committing$,
    this.loadingStatus$,
    this.isReloadingAfterOperation$,
  ]).pipe(
    map(
      ([staging, unstaging, committing, loadingStatus, isReloading]) =>
        staging || unstaging || committing || loadingStatus || isReloading,
    ),
  );

  // Show spinner only when reloading after an operation (not on initial load or when panel opens)
  // Track if we've had a successful operation that triggered a reload
  private hasHadOperation = signal<boolean>(false);
  readonly hasHadOperation$ = toObservable(this.hasHadOperation);

  readonly showStatusIndicatorSpinner$ = combineLatest([
    this.isAnyOperationInProgress$,
    this.hasHadOperation$,
    this.statusIndicator$,
  ]).pipe(
    map(([isInProgress, hasHadOp, indicator]) => {
      // Show spinner only if:
      // 1. Operation is in progress (staging/unstaging/committing/reloading)
      // 2. AND we've had an operation before (user has performed staging/unstaging/committing)
      // 3. AND status indicator exists (content is visible)
      // This ensures it doesn't show when panel first opens or on initial load
      return isInProgress && hasHadOp && indicator !== null;
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
        // Reset flags when client/agent changes (new agent = first load)
        this.hasLoadedContent.set(false);
        this.hasHadOperation.set(false);
        this.isReloadingAfterOperation.set(false);
        this.filesFacade.listDirectory(clientId, agentId, this.listParams('.'));

        if (this.fileManagerContext() === 'app') {
          this.vcsFacade.loadStatus(clientId, agentId);
        }
      }
    });

    // Reset hasHadOperation when panel closes
    effect(() => {
      const visible = this.gitManagerVisible();

      if (!visible) {
        // Panel is closed - reset operation flag so spinner doesn't show on next open
        this.hasHadOperation.set(false);
      }
    });

    // Track when operations start - mark that we've had an operation
    combineLatest([this.staging$, this.unstaging$, this.committing$])
      .pipe(
        filter(([staging, unstaging, committing]) => {
          // Mark when any operation starts (user has interacted)
          return staging || unstaging || committing;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        // User has performed an operation - mark this so spinner can show on reload
        if (!this.hasHadOperation()) {
          this.hasHadOperation.set(true);
        }
      });

    // Track when operations complete - mark as reloading to prevent flicker
    // This bridges the gap between operation completion and reload start
    combineLatest([this.staging$, this.unstaging$, this.committing$])
      .pipe(
        filter(([staging, unstaging, committing]) => {
          // Only trigger when transitioning from true to false (operation just completed)
          return !staging && !unstaging && !committing;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        // Mark as reloading immediately to prevent flicker
        // Only if we've had an operation (user has interacted)
        if (this.hasHadOperation() && !this.isReloadingAfterOperation()) {
          this.isReloadingAfterOperation.set(true);
        }
      });

    // Mark as loaded once first load completes (status available and not loading)
    combineLatest([this.loadingStatus$, this.gitStatus$])
      .pipe(
        filter(([loading, status]) => !loading && status !== null && !this.hasLoadedContent()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        // First load completed - mark as loaded
        this.hasLoadedContent.set(true);
      });

    // Clear reloading flag when status loading completes
    combineLatest([this.loadingStatus$, this.gitStatus$])
      .pipe(
        filter(([loading, status]) => !loading && status !== null && this.isReloadingAfterOperation()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        // Clear the flag after a brief delay to ensure smooth transition
        setTimeout(() => {
          this.isReloadingAfterOperation.set(false);
        }, 100);
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
  }

  ngOnInit(): void {
    // Subscribe to root directory observable with proper cleanup
    this.rootDirectory$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((nodes) => {
      if (nodes) {
        this.updateTreeCache('.', nodes);
        this.rebuildTree();
      }
    });
  }

  onFileClick(node: TreeNode, event: MouseEvent): void {
    event.stopPropagation();

    if (node.type === 'file') {
      this.fileSelect.emit(node.path);
    } else {
      this.onDirectoryToggle(node);
    }
  }

  onDirectoryToggle(node: TreeNode): void {
    if (node.type !== 'directory') {
      return;
    }

    const isExpanded = this.expandedPaths().has(node.path);

    if (isExpanded) {
      // Collapse
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
    this.contextMenuPath.set(node.path);
    this.contextMenuPosition.set({ x: event.clientX, y: event.clientY });
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
    // Find the node to get its type
    const node = this.findNodeByPath(path);

    if (node) {
      this.itemToDelete.set({ path, type: node.type });
      this.deleteFileModalOpen.set(true);
      this.onCloseContextMenu();
    }
  }

  onRenameItem(path: string): void {
    // Find the node to get its type and name
    const node = this.findNodeByPath(path);

    if (node) {
      this.itemToRename.set({ path, type: node.type, name: node.name });
      this.renameNewName.set(node.name);
      this.renameFileModalOpen.set(true);
      this.onCloseContextMenu();
    }
  }

  onMoveItem(path: string): void {
    // Find the node to get its type and name
    const node = this.findNodeByPath(path);

    if (node) {
      this.itemToMove.set({ path, type: node.type, name: node.name });
      // Set initial destination to parent directory
      const parentPath = this.getParentPath(path);

      this.moveDestinationPath.set(parentPath);
      this.moveFileModalOpen.set(true);
      this.onCloseContextMenu();
    }
  }

  confirmDeleteItem(): void {
    const item = this.itemToDelete();

    if (item) {
      this.fileDelete.emit(item.path);
      this.deleteFileModalOpen.set(false);
      this.itemToDelete.set(null);

      // Determine parent directory path
      const parentPath = this.getParentPath(item.path);

      // Remove the deleted item from cache if it exists
      this.removeFromCache(item.path);

      // Refresh the parent directory listing to update the tree
      this.listDirectoryRel(parentPath);
    }
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

    // File icons based on extension
    const ext = node.name.split('.').pop()?.toLowerCase();
    const iconMap: Record<string, string> = {
      ts: 'bi-filetype-ts',
      js: 'bi-filetype-js',
      json: 'bi-filetype-json',
      html: 'bi-filetype-html',
      css: 'bi-filetype-css',
      scss: 'bi-filetype-scss',
      md: 'bi-filetype-md',
      yaml: 'bi-filetype-yml',
      yml: 'bi-filetype-yml',
      xml: 'bi-filetype-xml',
      py: 'bi-filetype-py',
      java: 'bi-filetype-java',
      c: 'bi-filetype-c',
      cpp: 'bi-filetype-cpp',
      php: 'bi-filetype-php',
      go: 'bi-filetype-go',
      rs: 'bi-filetype-rs',
      vue: 'bi-filetype-vue',
    };

    return iconMap[ext || ''] || 'bi-file-earmark';
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

  getStatusIndicatorTitle(indicator: string): string {
    switch (indicator) {
      case 'clean':
        return $localize`:@@featureFileTree-statusClean:In sync with remote - Click to open Version Control`;
      case 'changes':
        return $localize`:@@featureFileTree-statusChanges:Local changes (staged, unstaged, or unpushed) - Click to open Version Control`;
      case 'conflict':
        return $localize`:@@featureFileTree-statusConflict:Merge conflicts detected - Click to open Version Control`;
      default:
        return '';
    }
  }

  getCurrentBranchTitle(branch: string): string {
    return $localize`:@@featureFileTree-currentBranchTitle:Current branch: ${branch}:branch:`;
  }

  getDeleteModalTitle(): string {
    const item = this.itemToDelete();

    if (!item) return '';

    return item.type === 'directory'
      ? $localize`:@@featureFileTree-deleteDirectoryTitle:Delete Directory`
      : $localize`:@@featureFileTree-deleteFileTitle:Delete File`;
  }

  getDeleteModalMessage(): string {
    const item = this.itemToDelete();

    if (!item) return '';

    const path = item.path;

    return item.type === 'directory'
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

  branchModalOpen = signal<boolean>(false);

  onOpenBranchModal(): void {
    this.branchModalOpen.set(true);
  }

  onBranchModalClosed(): void {
    this.branchModalOpen.set(false);
  }

  onStatusIndicatorClick(event: MouseEvent): void {
    event.stopPropagation(); // Prevent triggering the branch modal
    this.toggleGitManager.emit();
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
    const targetPath = parentPath || '.';

    this.uploadTargetPath.set(targetPath);

    // Use root input for root, folder input for folders
    const fileInput = targetPath === '.' ? this.rootFileInput : this.folderFileInput;

    if (fileInput?.nativeElement) {
      fileInput.nativeElement.click();
    }
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

  private uploadFileContent(fullPath: string, base64Content: string): void {
    this.filesFacade.createFileOrDirectory(
      this.clientId(),
      this.agentId(),
      fullPath,
      {
        type: 'file',
        content: base64Content,
      },
      this.fileManagerContext(),
    );
  }

  private readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const result = reader.result as string;
        const base64Content = result.includes(',') ? result.split(',')[1] : result;

        resolve(base64Content);
      };

      reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  private uploadFilesToPath(files: File[], targetPath: string): void {
    if (files.length === 0) {
      return;
    }

    this.uploadTargetPath.set(targetPath);

    let completedCount = 0;
    const uploadedPaths: string[] = [];

    files.forEach((file) => {
      const fullPath = this.buildFullUploadPath(targetPath, file.name);

      this.readFileAsBase64(file)
        .then((base64Content) => {
          this.uploadFileContent(fullPath, base64Content);
          uploadedPaths.push(fullPath);
        })
        .catch((error: unknown) => {
          console.error(error);
        })
        .finally(() => {
          completedCount++;

          if (completedCount === files.length) {
            this.onUploadComplete(targetPath, uploadedPaths, uploadedPaths);
          }
        });
    });
  }

  private async uploadDroppedItems(event: DragEvent, targetPath: string): Promise<void> {
    const dataTransfer = event.dataTransfer;

    if (!dataTransfer) {
      return;
    }

    this.uploadTargetPath.set(targetPath);

    const entries = this.getDroppedFileSystemEntries(dataTransfer);

    if (entries.length === 0) {
      if (dataTransfer.files.length > 0) {
        this.uploadFilesToPath(Array.from(dataTransfer.files), targetPath);
      }

      return;
    }

    const filesToUpload: CollectedUploadFile[] = [];
    const directories = new Set<string>();

    try {
      await Promise.all(entries.map((entry) => this.collectUploadEntries(entry, '', filesToUpload, directories)));
    } catch (error) {
      console.error('Failed to read dropped files:', error);

      return;
    }

    const sortedDirectories = Array.from(directories).sort(
      (left, right) => left.split('/').length - right.split('/').length,
    );
    const pendingCreatePaths: string[] = [];
    const expandedDirectoryPaths: string[] = [];

    for (const relativeDirectory of sortedDirectories) {
      const fullDirectoryPath = this.buildFullUploadPath(targetPath, relativeDirectory);

      pendingCreatePaths.push(fullDirectoryPath);

      this.filesFacade.createFileOrDirectory(
        this.clientId(),
        this.agentId(),
        fullDirectoryPath,
        { type: 'directory' },
        this.fileManagerContext(),
      );

      if (!this.expandedPaths().has(fullDirectoryPath)) {
        this.directoryExpand.emit(fullDirectoryPath);
        expandedDirectoryPaths.push(fullDirectoryPath);
      }
    }

    if (filesToUpload.length === 0) {
      this.onUploadComplete(targetPath, [], pendingCreatePaths, expandedDirectoryPaths);

      return;
    }

    let completedCount = 0;
    const uploadedPaths: string[] = [];

    for (const { relativePath, file } of filesToUpload) {
      const fullPath = this.buildFullUploadPath(targetPath, relativePath);

      pendingCreatePaths.push(fullPath);
      uploadedPaths.push(fullPath);

      this.readFileAsBase64(file)
        .then((base64Content) => {
          this.uploadFileContent(fullPath, base64Content);
        })
        .catch((error: unknown) => {
          console.error(error);
        })
        .finally(() => {
          completedCount++;

          if (completedCount === filesToUpload.length) {
            this.onUploadComplete(targetPath, uploadedPaths, pendingCreatePaths, expandedDirectoryPaths);
          }
        });
    }
  }

  private waitForCreatesToFinish(createPaths: string[]): Observable<void> {
    const clientId = this.clientId();
    const agentId = this.agentId();
    const context = this.fileManagerContext();
    const uniquePaths = [...new Set(createPaths)];

    if (!clientId || !agentId || uniquePaths.length === 0) {
      return of(undefined);
    }

    return combineLatest(
      uniquePaths.map((path) => this.filesFacade.isCreatingFile$(clientId, agentId, path, context)),
    ).pipe(
      filter((creatingFlags) => creatingFlags.every((creating) => !creating)),
      take(1),
      map(() => undefined),
    );
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

  private onUploadComplete(
    targetPath: string,
    uploadedPaths: string[],
    pendingCreatePaths: string[] = uploadedPaths,
    expandedDirectoryPaths: string[] = [],
  ): void {
    if (targetPath !== '.' && !this.expandedPaths().has(targetPath)) {
      this.directoryExpand.emit(targetPath);
    }

    this.waitForCreatesToFinish(pendingCreatePaths)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
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
      });
  }
}
