import { CommonModule } from '@angular/common';
import { Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { VcsFacade, type GitFileStatus } from '@forepath/agenstra/frontend/data-access-agent-console';
import { combineLatest, filter, map, pairwise, startWith, switchMap, take } from 'rxjs';

@Component({
  selector: 'framework-git-manager',
  imports: [CommonModule, FormsModule],
  templateUrl: './git-manager.component.html',
  styleUrls: ['./git-manager.component.scss'],
  standalone: true,
})
export class GitManagerComponent {
  private readonly vcsFacade = inject(VcsFacade);
  private readonly destroyRef = inject(DestroyRef);

  // Inputs
  clientId = input.required<string>();
  agentId = input.required<string>();

  // Outputs
  fileSelected = output<string>();
  showDiff = output<string>();

  // Internal state
  commitMessage = signal<string>('');
  selectedFiles = signal<Set<string>>(new Set());
  hasLoadedContent = signal<boolean>(false);
  private isReloadingAfterOperation = signal<boolean>(false);
  private pushError = signal<boolean>(false);
  private pullError = signal<boolean>(false);
  private fetchError = signal<boolean>(false);
  private pushErrorTimeout: ReturnType<typeof setTimeout> | null = null;
  private pullErrorTimeout: ReturnType<typeof setTimeout> | null = null;
  private fetchErrorTimeout: ReturnType<typeof setTimeout> | null = null;

  // Observables
  readonly status$ = this.vcsFacade.status$;
  readonly currentBranch$ = this.vcsFacade.currentBranch$;
  readonly loadingStatus$ = this.vcsFacade.loadingStatus$;

  // Convert signal to observable for reactive tracking
  readonly hasLoadedContent$ = toObservable(this.hasLoadedContent);

  // Only show loading spinner on first load
  readonly showLoadingSpinner$ = combineLatest([this.loadingStatus$, this.status$, this.hasLoadedContent$]).pipe(
    map(([loading, status, hasLoaded]) => {
      // Once we have content, mark as loaded
      if (status && !loading && !hasLoaded) {
        this.hasLoadedContent.set(true);
      }

      // Show spinner only if loading AND we haven't loaded content before
      return loading && !hasLoaded;
    }),
  );
  readonly staging$ = this.vcsFacade.staging$;
  readonly unstaging$ = this.vcsFacade.unstaging$;
  readonly committing$ = this.vcsFacade.committing$;
  readonly pushing$ = this.vcsFacade.pushing$;
  readonly pulling$ = this.vcsFacade.pulling$;
  readonly fetching$ = this.vcsFacade.fetching$;
  readonly error$ = this.vcsFacade.error$;

  // Convert reloading signal to observable
  readonly isReloadingAfterOperation$ = toObservable(this.isReloadingAfterOperation);

  // Convert error signals to observables
  readonly pushError$ = toObservable(this.pushError);
  readonly pullError$ = toObservable(this.pullError);
  readonly fetchError$ = toObservable(this.fetchError);

  // Check if any error is active
  readonly anyError$ = combineLatest([this.pushError$, this.pullError$, this.fetchError$]).pipe(
    map(([pushError, pullError, fetchError]) => pushError || pullError || fetchError),
  );

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

  // Computed
  readonly stagedFiles$ = this.status$.pipe(
    map((status) => status?.files.filter((f) => f.type === 'staged' || f.type === 'both') || []),
  );

  readonly unstagedFiles$ = this.status$.pipe(
    map(
      (status) =>
        status?.files.filter((f) => f.type === 'unstaged' || f.type === 'untracked' || f.type === 'both') || [],
    ),
  );

  readonly hasChanges$ = this.status$.pipe(map((status) => !status?.isClean));

  readonly hasUnpushedCommits$ = this.status$.pipe(map((status) => status?.hasUnpushedCommits || false));

  // Check if each section should have a top border (not first section)
  readonly hasCommitTopBorder$ = combineLatest([this.stagedFiles$, this.unstagedFiles$]).pipe(
    map(([_, __]) => false), // Commit is always first if it appears
  );

  readonly hasStagedTopBorder$ = combineLatest([this.stagedFiles$, this.unstagedFiles$]).pipe(
    map(([staged, _]) => staged.length > 0), // Has top border if commit section appears (staged files exist)
  );

  readonly hasUnstagedTopBorder$ = combineLatest([this.stagedFiles$, this.unstagedFiles$]).pipe(
    map(([staged, _]) => staged.length > 0), // Has top border if staged appears before it
  );

  constructor() {
    // Load git status when client/agent changes
    effect(() => {
      const clientId = this.clientId();
      const agentId = this.agentId();

      if (clientId && agentId) {
        // Reset loaded flag when client/agent changes (new agent = first load)
        this.hasLoadedContent.set(false);
        this.vcsFacade.loadStatus(clientId, agentId);
      }
    });

    // Track when operations complete to trigger reload
    combineLatest([this.staging$, this.unstaging$, this.committing$])
      .pipe(
        filter(([staging, unstaging, committing]) => {
          // Only trigger when transitioning from true to false (operation just completed)
          return !staging && !unstaging && !committing;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        // Mark as reloading immediately to prevent button flicker
        if (!this.isReloadingAfterOperation()) {
          this.isReloadingAfterOperation.set(true);
          setTimeout(() => {
            this.vcsFacade.loadStatus(this.clientId(), this.agentId());
          }, 300);
        }
      });

    // Clear reloading flag when status loading completes
    combineLatest([this.loadingStatus$, this.status$])
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

    // Track push errors - detect when push transitions from true to false with an error
    this.pushing$
      .pipe(
        startWith(false),
        pairwise(),
        filter(([prev, curr]) => prev === true && curr === false),
        switchMap(() =>
          this.error$.pipe(
            take(1), // Only take the error value at the moment of transition
            filter((error) => error !== null),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        // Clear all other error states when this error occurs
        clearAllErrorStates('push');

        // Clear any existing timeout for this operation
        if (this.pushErrorTimeout) {
          clearTimeout(this.pushErrorTimeout);
        }

        this.pushError.set(true);
        this.pushErrorTimeout = setTimeout(() => {
          this.pushError.set(false);
          this.pushErrorTimeout = null;
        }, 2000); // Show error for 2 seconds
      });

    // Helper method to clear all error states
    const clearAllErrorStates = (exceptOperation?: 'push' | 'pull' | 'fetch'): void => {
      if (exceptOperation !== 'push') {
        if (this.pushErrorTimeout) {
          clearTimeout(this.pushErrorTimeout);
          this.pushErrorTimeout = null;
        }

        this.pushError.set(false);
      }

      if (exceptOperation !== 'pull') {
        if (this.pullErrorTimeout) {
          clearTimeout(this.pullErrorTimeout);
          this.pullErrorTimeout = null;
        }

        this.pullError.set(false);
      }

      if (exceptOperation !== 'fetch') {
        if (this.fetchErrorTimeout) {
          clearTimeout(this.fetchErrorTimeout);
          this.fetchErrorTimeout = null;
        }

        this.fetchError.set(false);
      }
    };

    // Reset all error states when push operation starts
    this.pushing$
      .pipe(
        filter((pushing) => pushing === true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        clearAllErrorStates('push');
      });

    // Track pull errors - detect when pull transitions from true to false with an error
    this.pulling$
      .pipe(
        startWith(false),
        pairwise(),
        filter(([prev, curr]) => prev === true && curr === false),
        switchMap(() =>
          this.error$.pipe(
            take(1), // Only take the error value at the moment of transition
            filter((error) => error !== null),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        // Clear all other error states when this error occurs
        clearAllErrorStates('pull');

        // Clear any existing timeout for this operation
        if (this.pullErrorTimeout) {
          clearTimeout(this.pullErrorTimeout);
        }

        this.pullError.set(true);
        this.pullErrorTimeout = setTimeout(() => {
          this.pullError.set(false);
          this.pullErrorTimeout = null;
        }, 2000); // Show error for 2 seconds
      });

    // Reset all error states when pull operation starts
    this.pulling$
      .pipe(
        filter((pulling) => pulling === true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        clearAllErrorStates('pull');
      });

    // Track fetch errors - detect when fetch transitions from true to false with an error
    this.fetching$
      .pipe(
        startWith(false),
        pairwise(),
        filter(([prev, curr]) => prev === true && curr === false),
        switchMap(() =>
          this.error$.pipe(
            take(1), // Only take the error value at the moment of transition
            filter((error) => error !== null),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        // Clear all other error states when this error occurs
        clearAllErrorStates('fetch');

        // Clear any existing timeout for this operation
        if (this.fetchErrorTimeout) {
          clearTimeout(this.fetchErrorTimeout);
        }

        this.fetchError.set(true);
        this.fetchErrorTimeout = setTimeout(() => {
          this.fetchError.set(false);
          this.fetchErrorTimeout = null;
        }, 2000); // Show error for 2 seconds
      });

    // Reset all error states when fetch operation starts
    this.fetching$
      .pipe(
        filter((fetching) => fetching === true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        clearAllErrorStates('fetch');
      });
  }

  onFileClick(filePath: string): void {
    this.fileSelected.emit(filePath);
    this.showDiff.emit(filePath);
  }

  onStageFile(filePath: string): void {
    this.vcsFacade.stageFiles(this.clientId(), this.agentId(), { files: [filePath] });
  }

  onStageAll(): void {
    this.vcsFacade.stageFiles(this.clientId(), this.agentId(), { files: [] });
  }

  onUnstageFile(filePath: string): void {
    this.vcsFacade.unstageFiles(this.clientId(), this.agentId(), { files: [filePath] });
  }

  onUnstageAll(): void {
    this.vcsFacade.unstageFiles(this.clientId(), this.agentId(), { files: [] });
  }

  onCommit(): void {
    const message = this.commitMessage().trim();

    if (!message) {
      return;
    }

    this.vcsFacade.commit(this.clientId(), this.agentId(), { message });
    this.commitMessage.set('');
  }

  onPush(): void {
    this.vcsFacade.push(this.clientId(), this.agentId());
  }

  onForcePush(): void {
    this.vcsFacade.push(this.clientId(), this.agentId(), { force: true });
  }

  onPull(): void {
    this.vcsFacade.pull(this.clientId(), this.agentId());
  }

  onFetch(): void {
    this.vcsFacade.fetch(this.clientId(), this.agentId());
  }

  getStatusIcon(file: GitFileStatus): string {
    if (file.type === 'untracked') {
      return 'bi-question-circle';
    }

    if (file.isBinary) {
      return 'bi-file-binary';
    }

    if (file.status.includes('M')) {
      return 'bi-pencil';
    }

    if (file.status.includes('A')) {
      return 'bi-plus-circle';
    }

    if (file.status.includes('D')) {
      return 'bi-dash-circle';
    }

    return 'bi-file-earmark';
  }

  getStatusBadge(file: GitFileStatus): string {
    if (file.type === 'untracked') {
      return 'bg-info';
    }

    if (file.type === 'staged') {
      return 'bg-success';
    }

    if (file.type === 'unstaged') {
      return 'bg-warning';
    }

    if (file.type === 'both') {
      return 'bg-primary';
    }

    return 'bg-secondary';
  }
}
