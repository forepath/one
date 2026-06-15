import { CommonModule, Location } from '@angular/common';
import {
  AfterViewInit,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  NgZone,
  OnDestroy,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  FilesFacade,
  getSocketInstance,
  moveFileOrDirectorySuccess,
  SocketsFacade,
  VcsFacade,
  type CreateFileDto,
  type FileContentDto,
  type FileManagerContext,
  type FileUpdateNotificationData,
  type ListDirectoryParams,
  type OpenTab,
  type WriteFileDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { LocaleService } from '@forepath/shared/frontend/util-configuration';
import { Actions, ofType } from '@ngrx/effects';
import { combineLatest, debounceTime, filter, map, Observable, of, Subject, switchMap, take } from 'rxjs';

import { ContainerStatsStatusBarComponent } from './container-stats-status-bar/container-stats-status-bar.component';
import { FileTreeComponent } from './file-tree/file-tree.component';
import { GitDiffViewerComponent } from './git-diff-viewer/git-diff-viewer.component';
import { GitManagerComponent } from './git-manager/git-manager.component';
import { MonacoEditorWrapperComponent } from './monaco-editor-wrapper/monaco-editor-wrapper.component';
import { TerminalComponent } from './terminal/terminal.component';

@Component({
  selector: 'framework-file-editor',
  imports: [
    CommonModule,
    FileTreeComponent,
    MonacoEditorWrapperComponent,
    TerminalComponent,
    GitManagerComponent,
    GitDiffViewerComponent,
    ContainerStatsStatusBarComponent,
  ],
  templateUrl: './file-editor.component.html',
  styleUrls: ['./file-editor.component.scss'],
  standalone: true,
})
export class FileEditorComponent implements OnDestroy, AfterViewInit {
  private readonly filesFacade = inject(FilesFacade);
  private readonly socketsFacade = inject(SocketsFacade);
  private readonly vcsFacade = inject(VcsFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly actions$ = inject(Actions);
  private readonly location = inject(Location);
  private readonly localeService = inject(LocaleService);
  private readonly ngZone = inject(NgZone);

  @ViewChild('tabsContainer', { static: false }) tabsContainerRef?: ElementRef<HTMLDivElement>;
  @ViewChild('tabsWrapper', { static: false }) tabsWrapperRef?: ElementRef<HTMLDivElement>;
  @ViewChild('fileUpdateModal', { static: false }) fileUpdateModalRef?: ElementRef<HTMLDivElement>;
  @ViewChild('saveOverrideModal', { static: false }) saveOverrideModalRef?: ElementRef<HTMLDivElement>;
  @ViewChild('fileTreeSidebar', { static: false }) fileTreeSidebarRef?: ElementRef<HTMLDivElement>;

  // Inputs
  clientId = input.required<string>();
  agentId = input.required<string>();
  chatVisible = input<boolean>(true);
  /** Files API root: workspace (`app`) or provider agent config (`config`). */
  fileManagerContext = input<FileManagerContext>('app');

  // Internal state
  selectedFilePath = signal<string | null>(null);
  expandedPaths = signal<Set<string>>(new Set());
  dirtyFiles = signal<Set<string>>(new Set());
  editorContent = signal<string>('');
  lastLoadedFilePath = signal<string | null>(null);
  visibleTabs = signal<OpenTab[]>([]);
  overflowedTabs = signal<OpenTab[]>([]);
  showMoreFilesDropdown = signal<boolean>(false);
  private allTabs = signal<OpenTab[]>([]);

  // Visibility toggles (exposed for parent component access)
  // Initialize based on screen size: true for desktop, false for mobile
  readonly fileTreeVisible = signal<boolean>(typeof window !== 'undefined' && window.innerWidth > 767.98);
  readonly terminalVisible = signal<boolean>(false);
  readonly gitManagerVisible = signal<boolean>(false);
  readonly gitDiffViewerVisible = signal<boolean>(false);
  readonly gitDiffFilePath = signal<string | null>(null);
  readonly autosaveEnabled = signal<boolean>(false);

  // Outputs
  readonly chatToggleRequested = output<void>();

  // File update notification state
  readonly showFileUpdateModal = signal<boolean>(false);
  readonly fileUpdateNotification = signal<FileUpdateNotificationData | null>(null);
  // Track rejected file updates: filePath -> timestamp of rejected update
  private readonly rejectedFileUpdates = signal<Map<string, string>>(new Map());
  // Track files we just saved to ignore our own notifications: filePath -> timestamp when saved
  private readonly recentlySavedFiles = signal<Map<string, number>>(new Map());

  // Sidebar resize state
  private readonly SIDEBAR_MIN_WIDTH = 150;
  private readonly SIDEBAR_MAX_WIDTH = 600;
  private readonly SIDEBAR_DEFAULT_WIDTH = 300;
  readonly sidebarWidth = signal<number>(300);
  private isResizing = false;
  private readonly boundOnResizeMove = this.onResizeMove.bind(this);
  private readonly boundOnResizeEnd = this.onResizeEnd.bind(this);

  // Autosave debounce subject
  private readonly autosaveTrigger$ = new Subject<void>();

  // Refresh debounce subject to prevent multiple rapid refreshes
  private readonly refreshTrigger$ = new Subject<void>();
  private isRefreshing = false;
  private previousFileManagerContext: FileManagerContext | null = null;

  // Convert signals to observables
  private readonly selectedFilePath$ = toObservable(this.selectedFilePath);
  private readonly clientId$ = toObservable(this.clientId);
  private readonly agentId$ = toObservable(this.agentId);
  private readonly fileManagerContext$ = toObservable(this.fileManagerContext);

  // Computed observables
  readonly selectedFileContent$: Observable<FileContentDto | null> = combineLatest([
    this.selectedFilePath$,
    this.clientId$,
    this.agentId$,
    this.fileManagerContext$,
  ]).pipe(
    switchMap(([filePath, clientId, agentId, fileCtx]) => {
      if (!filePath || !clientId || !agentId) {
        return of(null);
      }

      return this.filesFacade.getFileContent$(clientId, agentId, filePath, fileCtx);
    }),
  );

  readonly isReadingFile$: Observable<boolean> = combineLatest([
    this.selectedFilePath$,
    this.clientId$,
    this.agentId$,
    this.fileManagerContext$,
    toObservable(this.lastLoadedFilePath),
  ]).pipe(
    switchMap(([filePath, clientId, agentId, fileCtx, lastLoadedFilePath]) => {
      if (!filePath || !clientId || !agentId) {
        return of(false);
      }

      return this.filesFacade
        .isReadingFile$(clientId, agentId, filePath, fileCtx)
        .pipe(map((isLoading) => isLoading && lastLoadedFilePath !== filePath));
    }),
  );

  readonly isWritingFile$: Observable<boolean> = combineLatest([
    this.selectedFilePath$,
    this.clientId$,
    this.agentId$,
    this.fileManagerContext$,
  ]).pipe(
    switchMap(([filePath, clientId, agentId, fileCtx]) => {
      if (!filePath || !clientId || !agentId) {
        return of(false);
      }

      return this.filesFacade.isWritingFile$(clientId, agentId, filePath, fileCtx);
    }),
  );

  readonly isDirty = computed(() => {
    const filePath = this.selectedFilePath();

    return filePath ? this.dirtyFiles().has(filePath) : false;
  });

  // Convert observable to signal for proper cleanup
  private readonly selectedFileContentSignal = toSignal(this.selectedFileContent$, {
    initialValue: null,
  });

  // Open tabs
  readonly openTabs$: Observable<OpenTab[]> = combineLatest([
    this.clientId$,
    this.agentId$,
    this.fileManagerContext$,
  ]).pipe(
    switchMap(([clientId, agentId, fileCtx]) => {
      if (!clientId || !agentId) {
        return of([]);
      }

      return this.filesFacade.getOpenTabs$(clientId, agentId, fileCtx);
    }),
  );

  private resizeObserver?: ResizeObserver;

  private listParams(path: string): ListDirectoryParams {
    const c = this.fileManagerContext();

    return c === 'app' ? { path } : { path, context: c };
  }

  constructor() {
    effect(() => {
      const ctx = this.fileManagerContext();

      if (this.previousFileManagerContext !== null && this.previousFileManagerContext !== ctx) {
        this.selectedFilePath.set(null);
        this.lastLoadedFilePath.set(null);
        this.dirtyFiles.set(new Set());
        this.expandedPaths.set(new Set());
        this.gitManagerVisible.set(false);
        this.gitDiffViewerVisible.set(false);
        this.gitDiffFilePath.set(null);
      }

      this.previousFileManagerContext = ctx;
    });

    // Load file when selected
    effect(() => {
      const filePath = this.selectedFilePath();

      if (filePath && this.clientId() && this.agentId()) {
        this.filesFacade.readFile(this.clientId(), this.agentId(), filePath, this.fileManagerContext());
      }
    });

    // Update editor content only when a new file is selected (not when user edits)
    effect(() => {
      const filePath = this.selectedFilePath();
      const content = this.selectedFileContentSignal();

      // Only update editorContent if:
      // 1. We have content
      // 2. The file path changed (new file selected) OR it's the first load
      if (content && filePath && filePath !== this.lastLoadedFilePath()) {
        // Content is already base64-encoded, pass it directly
        this.editorContent.set(content.content);
        this.lastLoadedFilePath.set(filePath);
      }
    });

    // Calculate visible tabs when tabs change
    effect(() => {
      this.openTabs$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((tabs) => {
        this.allTabs.set(tabs);
        // Initially show all tabs, then calculate visible ones after DOM updates
        this.visibleTabs.set(tabs);
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
          setTimeout(() => {
            this.calculateVisibleTabs();
            // If the selected file is in overflowed tabs, move it to front
            const selectedPath = this.selectedFilePath();

            if (selectedPath && this.clientId() && this.agentId()) {
              const overflowed = this.overflowedTabs();
              const isOverflowed = overflowed.some((tab) => tab.filePath === selectedPath);

              if (isOverflowed) {
                this.filesFacade.moveTabToFront(
                  this.clientId(),
                  this.agentId(),
                  selectedPath,
                  this.fileManagerContext(),
                );
                // Recalculate after moving
                setTimeout(() => this.calculateVisibleTabs(), 50);
              }
            }
          }, 0);
        });
      });
    });

    // Recalculate tabs when file tree visibility changes
    effect(() => {
      // Access the signal to create dependency
      this.fileTreeVisible();

      // Recalculate after DOM updates - use longer delay to ensure layout is complete
      if (this.tabsContainerRef?.nativeElement) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(() => {
              this.calculateVisibleTabs();
            }, 200);
          });
        });
      }
    });

    // Listen for file move/rename success and update selected file if it was moved
    this.actions$.pipe(ofType(moveFileOrDirectorySuccess), takeUntilDestroyed(this.destroyRef)).subscribe((action) => {
      const currentSelectedPath = this.selectedFilePath();
      const clientId = this.clientId();
      const agentId = this.agentId();
      const actionCtx = action.context ?? 'app';

      if (actionCtx !== this.fileManagerContext()) {
        return;
      }

      // Reload git status after file move (workspace only)
      if (this.fileManagerContext() === 'app' && clientId === action.clientId && agentId === action.agentId) {
        setTimeout(() => {
          this.vcsFacade.loadStatus(clientId, agentId);
        }, 500);
      }

      // Check if the moved file is currently selected
      if (currentSelectedPath === action.sourcePath && clientId === action.clientId && agentId === action.agentId) {
        // Update selected file path to the new destination
        this.selectedFilePath.set(action.destinationPath);

        // Move dirty state from old path to new path if file was dirty
        const wasDirty = this.dirtyFiles().has(action.sourcePath);

        if (wasDirty) {
          this.dirtyFiles.update((dirty) => {
            const newDirty = new Set(dirty);

            newDirty.delete(action.sourcePath);
            newDirty.add(action.destinationPath);

            return newDirty;
          });
        }

        // Load the file content at the new location
        // The effect will automatically load it when selectedFilePath changes
        this.filesFacade.readFile(clientId, agentId, action.destinationPath, this.fileManagerContext());
      }
    });

    // Autosave: trigger save 1.5 seconds after typing stops (if autosave is enabled and file is dirty)
    this.autosaveTrigger$
      .pipe(
        debounceTime(1500), // 1.5 second delay
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        if (this.autosaveEnabled() && this.isDirty()) {
          this.onSave();
        }
      });

    // Debounced refresh: prevent multiple rapid refreshes from chat messages
    this.refreshTrigger$
      .pipe(
        debounceTime(500), // 500ms debounce to batch rapid refresh calls
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.performRefresh();
      });

    // Save immediately when autosave is enabled if file is already dirty
    let previousAutosaveEnabled = false;

    effect(() => {
      const autosaveEnabled = this.autosaveEnabled();
      const isDirty = this.isDirty();

      // Only trigger immediate save when autosave transitions from false to true
      if (autosaveEnabled && !previousAutosaveEnabled && isDirty) {
        // Use setTimeout to avoid triggering during signal updates
        setTimeout(() => {
          // Double-check conditions in case they changed
          if (this.autosaveEnabled() && this.isDirty()) {
            this.onSave();
          }
        }, 0);
      }

      previousAutosaveEnabled = autosaveEnabled;
    });

    // Subscribe to file update notifications
    this.socketsFacade
      .getForwardedEventsByEvent$('fileUpdateNotification')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((events) => {
        if (events.length === 0) {
          return;
        }

        // Get the most recent event
        const latestEvent = events[events.length - 1];
        const payload = latestEvent.payload;

        // Check if it's a success response with FileUpdateNotificationData
        if ('success' in payload && payload.success && 'data' in payload) {
          const notificationData = payload.data as FileUpdateNotificationData;

          this.handleFileUpdateNotification(notificationData);
        }
      });

    // Update query parameter when file path changes (silently, without navigation)
    effect(() => {
      const filePath = this.selectedFilePath();
      const clientId = this.clientId();
      const agentId = this.agentId();

      if (filePath && clientId && agentId) {
        this.updateQueryParameter(filePath);
      } else {
        this.updateQueryParameter(null);
      }
    });
  }

  ngAfterViewInit(): void {
    // Set up ResizeObserver to detect overflow
    if (this.tabsContainerRef?.nativeElement && this.tabsWrapperRef?.nativeElement) {
      this.resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          setTimeout(() => this.calculateVisibleTabs(), 0);
        });
      });
      this.resizeObserver.observe(this.tabsContainerRef.nativeElement);
      this.resizeObserver.observe(this.tabsWrapperRef.nativeElement);
    }

    // Initial calculation after view init
    setTimeout(() => this.calculateVisibleTabs(), 100);

    // Restore file from query parameter on initialization
    this.restoreFileFromQueryParameter();
  }

  /**
   * Public method to trigger tab recalculation.
   * Called by parent component when chat visibility changes.
   */
  recalculateTabs(): void {
    // Use double requestAnimationFrame and longer delay to ensure layout is complete
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (this.tabsContainerRef?.nativeElement) {
            this.calculateVisibleTabs();
          }
        }, 200);
      });
    });
  }

  onFileSelect(filePath: string): void {
    // Check if current file is dirty
    const currentPath = this.selectedFilePath();

    if (currentPath && this.dirtyFiles().has(currentPath)) {
      // TODO: Show confirmation dialog
    }

    this.selectedFilePath.set(filePath);
    this.dirtyFiles.update((dirty) => {
      const newDirty = new Set(dirty);

      newDirty.delete(currentPath || '');

      return newDirty;
    });

    // Open tab when file is selected
    // The effect will automatically move it to front if it ends up in overflow
    if (this.clientId() && this.agentId()) {
      this.filesFacade.openFileTab(this.clientId(), this.agentId(), filePath, this.fileManagerContext());
    }
  }

  onContentChange(content: string | Event): void {
    // Handle both string and Event types (defensive programming)
    let contentValue: string;

    if (typeof content === 'string') {
      contentValue = content;
    } else if (content instanceof Event) {
      // If it's an Event, try to get the value from the target
      const target = content.target as HTMLInputElement | HTMLTextAreaElement;

      contentValue = target?.value || '';
    } else {
      return;
    }

    const filePath = this.selectedFilePath();

    if (filePath) {
      this.editorContent.set(contentValue);
      this.dirtyFiles.update((dirty) => {
        const newDirty = new Set(dirty);

        newDirty.add(filePath);

        return newDirty;
      });

      // Trigger autosave debounce if autosave is enabled
      if (this.autosaveEnabled()) {
        this.autosaveTrigger$.next();
      }
    }
  }

  onSave(): void {
    const filePath = this.selectedFilePath();
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (!filePath || !clientId || !agentId) {
      return;
    }

    // Get content from editorContent signal (updated by contentChange events)
    const contentToSave = this.editorContent();

    if (!contentToSave) {
      return;
    }

    // Check if there are rejected file updates for this file
    const rejectedTimestamp = this.rejectedFileUpdates().get(filePath);

    if (rejectedTimestamp) {
      // Show confirmation modal before overriding newer changes
      if (this.saveOverrideModalRef) {
        this.showModal(this.saveOverrideModalRef);
      }

      return;
    }

    // No rejected updates, proceed with save
    this.performSave(filePath, contentToSave);
  }

  /**
   * Actually perform the save operation
   */
  private performSave(filePath: string, contentToSave: string): void {
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (!clientId || !agentId) {
      return;
    }

    const writeDto: WriteFileDto = {
      content: contentToSave, // Already base64-encoded
      encoding: 'utf-8',
    };

    this.filesFacade.writeFile(clientId, agentId, filePath, writeDto, this.fileManagerContext());

    // Mark as not dirty and sync editorContent after successful save
    // Also emit file update notification to other clients after successful save
    combineLatest([this.isWritingFile$, this.selectedFileContent$])
      .pipe(
        filter(([writing]) => !writing),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(([, savedContent]) => {
        // Update editorContent with saved content from server
        if (savedContent) {
          this.editorContent.set(savedContent.content);
        }

        // Mark as not dirty
        this.dirtyFiles.update((dirty) => {
          const newDirty = new Set(dirty);

          newDirty.delete(filePath);

          return newDirty;
        });
        // Clear rejected update tracking for this file (save was successful)
        this.rejectedFileUpdates.update((rejected) => {
          const newRejected = new Map(rejected);

          newRejected.delete(filePath);

          return newRejected;
        });

        // Track that we just saved this file to ignore our own notification
        this.recentlySavedFiles.update((saved) => {
          const newSaved = new Map(saved);

          newSaved.set(filePath, Date.now());

          return newSaved;
        });

        // Reload git status after file save (workspace only)
        if (this.fileManagerContext() === 'app') {
          setTimeout(() => {
            this.vcsFacade.loadStatus(clientId, agentId);
          }, 300);
        }

        // Emit file update notification to other clients after successful save
        // agentId is required for routing the event to the correct agent
        const agentId = this.agentId();

        if (!agentId) {
          // Cannot forward file update notification without an agent selected
          return;
        }

        // agentId is required for routing the event to the correct agent
        this.socketsFacade.forwardFileUpdate(filePath, agentId);

        // Clear the tracking after 5 seconds (notification should arrive within this time)
        setTimeout(() => {
          this.recentlySavedFiles.update((saved) => {
            const newSaved = new Map(saved);

            newSaved.delete(filePath);

            return newSaved;
          });
        }, 5000);
      });
  }

  /**
   * Confirm save override - proceed with saving despite rejected newer changes
   */
  onConfirmSaveOverride(): void {
    const filePath = this.selectedFilePath();

    if (!filePath) {
      return;
    }

    // Hide modal
    if (this.saveOverrideModalRef) {
      this.hideModal(this.saveOverrideModalRef);
    }

    // Get content and perform save
    const contentToSave = this.editorContent();

    if (contentToSave) {
      this.performSave(filePath, contentToSave);
    }
  }

  /**
   * Cancel save override - keep local changes without saving
   */
  onCancelSaveOverride(): void {
    // Just hide the modal
    if (this.saveOverrideModalRef) {
      this.hideModal(this.saveOverrideModalRef);
    }
  }

  onFileCreate(event: { path: string; type: 'file' | 'directory'; name: string }): void {
    const createDto: CreateFileDto = {
      type: event.type,
    };
    const fullPath = event.path === '.' ? event.name : `${event.path}/${event.name}`;

    this.filesFacade.createFileOrDirectory(
      this.clientId(),
      this.agentId(),
      fullPath,
      createDto,
      this.fileManagerContext(),
    );

    // Refresh directory listing
    this.filesFacade.listDirectory(this.clientId(), this.agentId(), this.listParams(event.path));

    // Reload git status after file creation (workspace only)
    if (this.fileManagerContext() === 'app') {
      setTimeout(() => {
        this.vcsFacade.loadStatus(this.clientId(), this.agentId());
      }, 500);
    }

    // If it's a file, select it
    if (event.type === 'file') {
      setTimeout(() => {
        this.selectedFilePath.set(fullPath);
      }, 500); // Wait for file to be created
    } else {
      // If it's a directory, expand it
      this.expandedPaths.update((expanded) => {
        const newExpanded = new Set(expanded);

        newExpanded.add(fullPath);

        return newExpanded;
      });
    }
  }

  onFileDelete(filePath: string): void {
    // Confirmation is handled by the file-tree component's Bootstrap modal
    this.filesFacade.deleteFileOrDirectory(this.clientId(), this.agentId(), filePath, this.fileManagerContext());

    // If deleted file was selected, clear selection
    if (this.selectedFilePath() === filePath) {
      this.selectedFilePath.set(null);
      this.dirtyFiles.update((dirty) => {
        const newDirty = new Set(dirty);

        newDirty.delete(filePath);

        return newDirty;
      });
    }

    // Refresh root directory listing
    this.filesFacade.listDirectory(this.clientId(), this.agentId(), this.listParams('.'));

    // Reload git status after file deletion (workspace only)
    if (this.fileManagerContext() === 'app') {
      setTimeout(() => {
        this.vcsFacade.loadStatus(this.clientId(), this.agentId());
      }, 500);
    }
  }

  onDirectoryExpand(path: string | Event): void {
    // Handle both string and Event types (defensive programming)
    const pathValue = typeof path === 'string' ? path : '';

    if (!pathValue) {
      return;
    }

    this.expandedPaths.update((expanded) => {
      const newExpanded = new Set(expanded);

      newExpanded.add(pathValue);

      return newExpanded;
    });
  }

  onDirectoryCollapse(path: string | Event): void {
    // Handle both string and Event types (defensive programming)
    const pathValue = typeof path === 'string' ? path : '';

    if (!pathValue) {
      return;
    }

    this.expandedPaths.update((expanded) => {
      const newExpanded = new Set(expanded);

      newExpanded.delete(pathValue);

      return newExpanded;
    });
  }

  /**
   * Refresh the file tree and reload file content while preserving state.
   * This method reloads directory listings and file content without losing
   * the currently selected file or expanded folder state.
   * Uses debouncing to prevent multiple rapid refreshes.
   */
  refresh(): void {
    // Trigger debounced refresh
    this.refreshTrigger$.next();
  }

  /**
   * Internal method that performs the actual refresh operation.
   * Called by the debounced refresh trigger.
   */
  private performRefresh(): void {
    // Prevent concurrent refreshes (debouncing handles most cases, but this is a safety check)
    if (this.isRefreshing) {
      return;
    }

    const clientId = this.clientId();
    const agentId = this.agentId();

    if (!clientId || !agentId) {
      return;
    }

    this.isRefreshing = true;

    // Save current state
    const currentSelectedFile = this.selectedFilePath();
    const currentExpandedPaths = new Set(this.expandedPaths());

    // Reload all expanded directories (including root)
    // Use a small delay for root to avoid immediate cancellation from the file tree component's effect
    currentExpandedPaths.forEach((path) => {
      if (path === '.') {
        // Small delay for root directory to avoid cancellation
        setTimeout(() => {
          this.filesFacade.listDirectory(clientId, agentId, this.listParams('.'));
        }, 50);
      } else {
        this.filesFacade.listDirectory(clientId, agentId, this.listParams(path));
      }
    });

    // If root is not in expanded paths, reload it anyway (it's always needed)
    if (!currentExpandedPaths.has('.')) {
      setTimeout(() => {
        this.filesFacade.listDirectory(clientId, agentId, this.listParams('.'));
      }, 50);
    }

    // Reset flag after a short delay to allow all listDirectory calls to be dispatched
    // The actual API calls are async, but we just need to prevent immediate duplicate calls
    setTimeout(() => {
      this.isRefreshing = false;
    }, 100);

    // Reload currently selected file if it exists
    if (currentSelectedFile) {
      this.filesFacade.readFile(clientId, agentId, currentSelectedFile, this.fileManagerContext());
    }
  }

  getFileName(filePath: string): string {
    return filePath.split('/').pop() || filePath;
  }

  onTabClick(filePath: string): void {
    this.selectedFilePath.set(filePath);
  }

  onTabClickFromDropdown(filePath: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    // Move the tab to the front before selecting it
    if (this.clientId() && this.agentId()) {
      this.filesFacade.moveTabToFront(this.clientId(), this.agentId(), filePath, this.fileManagerContext());
    }

    this.onTabClick(filePath);

    // Close Bootstrap dropdown
    const dropdownElement = (event.target as HTMLElement).closest('.dropdown');

    if (dropdownElement) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bootstrap = (window as any).bootstrap;
      const toggleButton = dropdownElement.querySelector('[data-bs-toggle="dropdown"]');

      if (bootstrap?.Dropdown && toggleButton) {
        const dropdown = bootstrap.Dropdown.getInstance(toggleButton);

        if (dropdown) {
          dropdown.hide();
        }
      }
    }

    // Recalculate visible tabs after moving to front
    setTimeout(() => this.calculateVisibleTabs(), 100);
  }

  onTabDoubleClick(filePath: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.clientId() && this.agentId()) {
      this.filesFacade.pinFileTab(this.clientId(), this.agentId(), filePath, this.fileManagerContext());
    }
  }

  onTabClose(filePath: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.clientId() && this.agentId()) {
      this.filesFacade.closeFileTab(this.clientId(), this.agentId(), filePath, this.fileManagerContext());

      // If the closed tab was selected, select the first remaining tab or clear selection
      if (this.selectedFilePath() === filePath) {
        this.openTabs$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((tabs) => {
          const remainingTabs = tabs.filter((tab) => tab.filePath !== filePath);

          if (remainingTabs.length > 0) {
            this.selectedFilePath.set(remainingTabs[0].filePath);
          } else {
            this.selectedFilePath.set(null);
          }
        });
      }
    }
  }

  /**
   * Open the currently selected file in a new window and close it from the current window
   */
  onOpenInNewWindow(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const filePath = this.selectedFilePath();
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (!filePath || !clientId || !agentId) {
      return;
    }

    // Build the URL
    const baseUrl = window.location.origin;
    const segment = this.fileManagerContext() === 'config' ? 'config' : 'editor';
    const editorPath = `/clients/${clientId}/agents/${agentId}/${segment}`;
    const queryParams = new URLSearchParams();

    queryParams.set('standalone', 'true');
    queryParams.set('file', encodeURIComponent(filePath));
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

    // Close the file from the current window
    // Wait a bit to ensure the new window has opened before closing the tab
    setTimeout(() => {
      if (this.clientId() && this.agentId()) {
        this.filesFacade.closeFileTab(this.clientId(), this.agentId(), filePath, this.fileManagerContext());

        // If the closed tab was selected, select the first remaining tab or clear selection
        if (this.selectedFilePath() === filePath) {
          this.openTabs$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((tabs) => {
            const remainingTabs = tabs.filter((tab) => tab.filePath !== filePath);

            if (remainingTabs.length > 0) {
              this.selectedFilePath.set(remainingTabs[0].filePath);
            } else {
              this.selectedFilePath.set(null);
            }
          });
        }
      }
    }, 200);
  }

  private calculateVisibleTabs(): void {
    const container = this.tabsContainerRef?.nativeElement;
    const wrapper = this.tabsWrapperRef?.nativeElement;

    if (!container || !wrapper) {
      return;
    }

    const tabs = this.allTabs();

    if (tabs.length === 0) {
      this.visibleTabs.set([]);
      this.overflowedTabs.set([]);
      this.showMoreFilesDropdown.set(false);

      return;
    }

    // First, temporarily show all tabs so we can measure them accurately
    // This ensures we get correct measurements even if some were previously hidden
    this.visibleTabs.set(tabs);

    // Force a reflow to ensure all tabs are rendered
    void container.offsetHeight;

    // Now get the actual container width after layout
    const containerWidth = container.clientWidth;
    const moreButtonWidth = 60; // Approximate width of "more files" button
    const availableWidth = containerWidth - moreButtonWidth;
    // Get all currently rendered tab elements (should be all tabs now)
    const tabElements = Array.from(wrapper.querySelectorAll<HTMLElement>('.file-editor-tab'));

    if (tabElements.length === 0) {
      // No tabs rendered yet, wait a bit more
      setTimeout(() => this.calculateVisibleTabs(), 50);

      return;
    }

    // If we don't have all tabs rendered yet, wait a bit more
    if (tabElements.length < tabs.length) {
      setTimeout(() => this.calculateVisibleTabs(), 50);

      return;
    }

    let totalWidth = 0;
    const visible: OpenTab[] = [];
    const overflowed: OpenTab[] = [];

    // Measure tabs and determine which fit
    for (let i = 0; i < tabs.length; i++) {
      const tabElement = tabElements[i];
      const tab = tabs[i];

      if (!tabElement) {
        // Tab element not found, skip it
        overflowed.push(tab);
        continue;
      }

      const tabWidth = tabElement.offsetWidth || tabElement.getBoundingClientRect().width;

      if (totalWidth + tabWidth <= availableWidth) {
        visible.push(tab);
        totalWidth += tabWidth;
      } else {
        // This tab and all remaining tabs overflow
        overflowed.push(...tabs.slice(i));
        break;
      }
    }

    // If we measured fewer tabs than we have, the rest are overflowed
    if (visible.length < tabs.length && overflowed.length === 0) {
      overflowed.push(...tabs.slice(visible.length));
    }

    // Check if the selected file is in overflowed tabs - if so, move it to front
    const selectedPath = this.selectedFilePath();

    if (selectedPath && this.clientId() && this.agentId()) {
      const isOverflowed = overflowed.some((tab) => tab.filePath === selectedPath);

      if (isOverflowed) {
        // Move selected tab to front and recalculate
        this.filesFacade.moveTabToFront(this.clientId(), this.agentId(), selectedPath, this.fileManagerContext());
        // The tab order change will trigger a recalculation via the effect
        // But we also need to recalculate immediately to show the change
        setTimeout(() => this.calculateVisibleTabs(), 50);

        return;
      }
    }

    // Now set the actual visible/overflowed tabs
    this.visibleTabs.set(visible);
    this.overflowedTabs.set(overflowed);
    this.showMoreFilesDropdown.set(overflowed.length > 0);
  }

  onToggleFileTree(): void {
    this.fileTreeVisible.update((visible) => !visible);
    // Explicitly trigger recalculation after toggling
    this.recalculateTabs();
  }

  onCloseFileTree(): void {
    this.fileTreeVisible.set(false);
    this.recalculateTabs();
  }

  onToggleTerminal(): void {
    this.terminalVisible.update((visible) => !visible);
  }

  onCloseTerminal(): void {
    this.terminalVisible.set(false);
  }

  onToggleGitManager(): void {
    if (this.fileManagerContext() !== 'app') {
      return;
    }

    const wasVisible = this.gitManagerVisible();

    this.gitManagerVisible.update((visible) => !visible);

    // On mobile, hide file tree when opening git manager
    if (!wasVisible && this.isMobile()) {
      this.fileTreeVisible.set(false);
    }
  }

  private isMobile(): boolean {
    return typeof window !== 'undefined' && window.innerWidth <= 767.98;
  }

  onCloseGitManager(): void {
    this.gitManagerVisible.set(false);
  }

  onShowGitDiff(filePath: string): void {
    if (this.fileManagerContext() !== 'app') {
      return;
    }

    this.gitDiffFilePath.set(filePath);
    this.gitDiffViewerVisible.set(true);
  }

  onCloseGitDiff(): void {
    this.gitDiffViewerVisible.set(false);
    this.gitDiffFilePath.set(null);
  }

  onToggleChat(): void {
    this.chatToggleRequested.emit();
  }

  /**
   * Handle file update notification from other clients
   * - If file is dirty: shows a modal asking user to accept or reject changes, and disables autosave
   * - If file is not dirty: automatically reloads the file from server
   */
  private handleFileUpdateNotification(notification: FileUpdateNotificationData): void {
    if (this.fileManagerContext() !== 'app') {
      return;
    }

    const currentFilePath = this.selectedFilePath();
    const currentSocketId = getSocketInstance()?.id;
    const clientId = this.clientId();
    const agentId = this.agentId();
    // Check if we just saved this file ourselves (ignore our own notifications)
    const recentlySaved = this.recentlySavedFiles().get(notification.filePath);

    if (recentlySaved && Date.now() - recentlySaved < 5000) {
      // We just saved this file within the last 5 seconds, ignore the notification
      // Clear the tracking since we've received our own notification
      this.recentlySavedFiles.update((saved) => {
        const newSaved = new Map(saved);

        newSaved.delete(notification.filePath);

        return newSaved;
      });

      return;
    }

    // Check conditions:
    // 1. Socket ID must be different (not our own update)
    // 2. Current user must be viewing the same file
    if (
      currentSocketId &&
      notification.socketId !== currentSocketId &&
      currentFilePath === notification.filePath &&
      clientId &&
      agentId
    ) {
      const isDirty = this.dirtyFiles().has(notification.filePath);

      if (isDirty) {
        // File has unsaved changes - disable autosave to prevent conflicts and show modal
        this.autosaveEnabled.set(false);
        this.fileUpdateNotification.set(notification);
        this.showFileUpdateModal.set(true);

        if (this.fileUpdateModalRef) {
          this.showModal(this.fileUpdateModalRef);
        }
      } else {
        // File is not dirty - automatically reload from server (no need to disable autosave)
        this.filesFacade.readFile(clientId, agentId, notification.filePath, this.fileManagerContext());
      }
    }
  }

  /**
   * Show a Bootstrap modal
   */
  private showModal(modalElement: ElementRef<HTMLDivElement>): void {
    if (modalElement?.nativeElement) {
      // Use Bootstrap 5 Modal API
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bootstrap = (window as any).bootstrap;
      const modal = bootstrap?.Modal?.getOrCreateInstance(modalElement.nativeElement);

      if (modal) {
        modal.show();
      } else {
        // Fallback: create new modal instance
        const Modal = bootstrap?.Modal;

        if (Modal) {
          new Modal(modalElement.nativeElement).show();
        }
      }
    }
  }

  /**
   * Hide a Bootstrap modal
   */
  private hideModal(modalElement: ElementRef<HTMLDivElement>): void {
    if (modalElement?.nativeElement) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bootstrap = (window as any).bootstrap;
      const modal = bootstrap?.Modal?.getInstance(modalElement.nativeElement);

      if (modal) {
        modal.hide();
      }
    }
  }

  /**
   * Accept external file changes - reload the file from server
   */
  onAcceptFileUpdate(): void {
    const notification = this.fileUpdateNotification();

    if (!notification) {
      return;
    }

    const filePath = notification.filePath;
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (!filePath || !clientId || !agentId) {
      return;
    }

    // Clear cached content first so Monaco wrapper receives a fresh emission and updates correctly
    this.filesFacade.clearFileContent(clientId, agentId, filePath, this.fileManagerContext());
    // Reset lastLoadedFilePath so the content effect will run when new content arrives
    this.lastLoadedFilePath.set(null);
    // Reload the file from server
    this.filesFacade.readFile(clientId, agentId, filePath, this.fileManagerContext());

    // Clear dirty state for this file
    this.dirtyFiles.update((dirty) => {
      const newDirty = new Set(dirty);

      newDirty.delete(filePath);

      return newDirty;
    });

    // Clear rejected update tracking (user accepted the changes)
    this.rejectedFileUpdates.update((rejected) => {
      const newRejected = new Map(rejected);

      newRejected.delete(filePath);

      return newRejected;
    });

    // Hide modal and clear notification
    if (this.fileUpdateModalRef) {
      this.hideModal(this.fileUpdateModalRef);
    }

    this.showFileUpdateModal.set(false);
    this.fileUpdateNotification.set(null);

    // Reload git status after accepting file update (workspace only)
    if (this.fileManagerContext() === 'app') {
      setTimeout(() => {
        this.vcsFacade.loadStatus(clientId, agentId);
      }, 500);
    }
  }

  /**
   * Reject external file changes - keep local changes and allow override
   */
  onRejectFileUpdate(): void {
    const notification = this.fileUpdateNotification();

    if (notification) {
      // Track that this file update was rejected (store timestamp for reference)
      this.rejectedFileUpdates.update((rejected) => {
        const newRejected = new Map(rejected);

        newRejected.set(notification.filePath, notification.timestamp);

        return newRejected;
      });
    }

    // Hide modal - keep the file dirty so user can save with CTRL+S or save button
    if (this.fileUpdateModalRef) {
      this.hideModal(this.fileUpdateModalRef);
    }

    this.showFileUpdateModal.set(false);
    this.fileUpdateNotification.set(null);
  }

  /**
   * Update the query parameter silently (without triggering navigation).
   * Deferred to next tick to avoid ExpressionChangedAfterItHasBeenCheckedError when
   * parent components (e.g. language switcher) read window.location during change detection.
   */
  private updateQueryParameter(filePath: string | null): void {
    queueMicrotask(() => {
      const url = new URL(window.location.href);

      if (filePath) {
        url.searchParams.set('file', encodeURIComponent(filePath));
      } else {
        url.searchParams.delete('file');
      }

      let pathname = url.pathname;
      const availableLocales = this.localeService.getAvailableLocales().map((loc) => loc.code);
      const pathSegments = pathname.split('/').filter(Boolean);
      const firstSegment = pathSegments[0] ?? '';

      if (availableLocales.includes(firstSegment) && pathSegments.length > 1) {
        pathname = '/' + pathSegments.slice(1).join('/');
      }

      this.location.replaceState(pathname + url.search + url.hash);
    });
  }

  /**
   * Restore file from query parameter on component initialization
   */
  private restoreFileFromQueryParameter(): void {
    const url = new URL(window.location.href);
    const fileParam = url.searchParams.get('file');

    if (fileParam && this.clientId() && this.agentId()) {
      try {
        const decodedPath = decodeURIComponent(fileParam);

        // Only restore if no file is currently selected
        if (!this.selectedFilePath()) {
          this.onFileSelect(decodedPath);
        }
      } catch (error) {
        // Invalid encoding, ignore
        console.warn('Failed to decode file path from query parameter:', error);
      }
    }
  }

  /** Start sidebar resize on mousedown/touchstart */
  onResizeStart(event: MouseEvent | TouchEvent): void {
    event.preventDefault();
    this.isResizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    // Run outside Angular zone for performance during drag
    this.ngZone.runOutsideAngular(() => {
      document.addEventListener('mousemove', this.boundOnResizeMove);
      document.addEventListener('mouseup', this.boundOnResizeEnd);
      document.addEventListener('touchmove', this.boundOnResizeMove);
      document.addEventListener('touchend', this.boundOnResizeEnd);
    });
  }

  private onResizeMove(event: MouseEvent | TouchEvent): void {
    if (!this.isResizing) return;

    const sidebarEl = this.fileTreeSidebarRef?.nativeElement;

    if (!sidebarEl) return;

    const containerRect = sidebarEl.parentElement?.getBoundingClientRect();

    if (!containerRect) return;

    const clientX = event instanceof MouseEvent ? event.clientX : event.touches[0].clientX;
    let newWidth = clientX - containerRect.left;

    newWidth = Math.max(this.SIDEBAR_MIN_WIDTH, Math.min(this.SIDEBAR_MAX_WIDTH, newWidth));

    // Apply width directly on the element for smooth dragging
    sidebarEl.style.flexBasis = `${newWidth}px`;
    this.ngZone.run(() => {
      this.sidebarWidth.set(newWidth);
    });
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

    // Recalculate tabs after resize
    this.recalculateTabs();
  }

  ngOnDestroy(): void {
    // Clear all open tabs when component is destroyed
    if (this.clientId() && this.agentId()) {
      this.filesFacade.clearOpenTabs(this.clientId(), this.agentId(), this.fileManagerContext());
    }

    // Clean up ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    // Clean up resize listeners in case component is destroyed mid-drag
    document.removeEventListener('mousemove', this.boundOnResizeMove);
    document.removeEventListener('mouseup', this.boundOnResizeEnd);
    document.removeEventListener('touchmove', this.boundOnResizeMove);
    document.removeEventListener('touchend', this.boundOnResizeEnd);
  }
}
