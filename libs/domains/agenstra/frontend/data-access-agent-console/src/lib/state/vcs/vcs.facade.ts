import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  clearGitDiff,
  commit,
  createBranch,
  deleteBranch,
  fetch,
  loadGitBranches,
  loadGitDiff,
  loadGitStatus,
  pull,
  push,
  rebase,
  resolveConflict,
  stageFiles,
  switchBranch,
  unstageFiles,
} from './vcs.actions';
import {
  selectCommitting,
  selectCreatingBranch,
  selectCurrentBranch,
  selectDeletingBranch,
  selectFetching,
  selectGitBranches,
  selectGitDiff,
  selectGitStatus,
  selectGitStatusIndicator,
  selectLoadingBranches,
  selectLoadingDiff,
  selectLoadingStatus,
  selectPulling,
  selectPushing,
  selectRebasing,
  selectResolvingConflict,
  selectStaging,
  selectSwitchingBranch,
  selectUnstaging,
  selectVcsError,
} from './vcs.selectors';
import type {
  CommitDto,
  CreateBranchDto,
  GitBranch,
  GitDiff,
  GitStatus,
  RebaseDto,
  ResolveConflictDto,
  StageFilesDto,
  UnstageFilesDto,
} from './vcs.types';

/**
 * Facade for VCS state management.
 * Provides a clean API for components to interact with VCS state
 * without directly accessing the NgRx store.
 */
@Injectable({
  providedIn: 'root',
})
export class VcsFacade {
  private readonly store = inject(Store);

  // State observables
  readonly status$: Observable<GitStatus | null> = this.store.select(selectGitStatus);
  readonly branches$: Observable<GitBranch[]> = this.store.select(selectGitBranches);
  readonly currentBranch$: Observable<string | undefined> = this.store.select(selectCurrentBranch);
  readonly diff$: Observable<GitDiff | null> = this.store.select(selectGitDiff);
  readonly statusIndicator$: Observable<'clean' | 'changes' | 'conflict' | null> =
    this.store.select(selectGitStatusIndicator);

  // Loading state observables
  readonly loadingStatus$: Observable<boolean> = this.store.select(selectLoadingStatus);
  readonly loadingBranches$: Observable<boolean> = this.store.select(selectLoadingBranches);
  readonly loadingDiff$: Observable<boolean> = this.store.select(selectLoadingDiff);
  readonly staging$: Observable<boolean> = this.store.select(selectStaging);
  readonly unstaging$: Observable<boolean> = this.store.select(selectUnstaging);
  readonly committing$: Observable<boolean> = this.store.select(selectCommitting);
  readonly pushing$: Observable<boolean> = this.store.select(selectPushing);
  readonly pulling$: Observable<boolean> = this.store.select(selectPulling);
  readonly fetching$: Observable<boolean> = this.store.select(selectFetching);
  readonly rebasing$: Observable<boolean> = this.store.select(selectRebasing);
  readonly switchingBranch$: Observable<boolean> = this.store.select(selectSwitchingBranch);
  readonly creatingBranch$: Observable<boolean> = this.store.select(selectCreatingBranch);
  readonly deletingBranch$: Observable<boolean> = this.store.select(selectDeletingBranch);
  readonly resolvingConflict$: Observable<boolean> = this.store.select(selectResolvingConflict);

  // Error observable
  readonly error$: Observable<string | null> = this.store.select(selectVcsError);

  /**
   * Load git status for the agent's repository.
   */
  loadStatus(clientId: string, agentId: string): void {
    this.store.dispatch(loadGitStatus({ clientId, agentId }));
  }

  /**
   * Load all branches (local and remote).
   */
  loadBranches(clientId: string, agentId: string): void {
    this.store.dispatch(loadGitBranches({ clientId, agentId }));
  }

  /**
   * Load diff for a specific file.
   */
  loadDiff(clientId: string, agentId: string, filePath: string): void {
    this.store.dispatch(loadGitDiff({ clientId, agentId, filePath }));
  }

  /**
   * Clear the current diff.
   */
  clearDiff(): void {
    this.store.dispatch(clearGitDiff());
  }

  /**
   * Stage files.
   */
  stageFiles(clientId: string, agentId: string, dto: StageFilesDto): void {
    this.store.dispatch(stageFiles({ clientId, agentId, dto }));
  }

  /**
   * Unstage files.
   */
  unstageFiles(clientId: string, agentId: string, dto: UnstageFilesDto): void {
    this.store.dispatch(unstageFiles({ clientId, agentId, dto }));
  }

  /**
   * Commit staged changes.
   */
  commit(clientId: string, agentId: string, dto: CommitDto): void {
    this.store.dispatch(commit({ clientId, agentId, dto }));
  }

  /**
   * Push changes to remote.
   */
  push(clientId: string, agentId: string, options?: { force?: boolean }): void {
    this.store.dispatch(push({ clientId, agentId, force: options?.force }));
  }

  /**
   * Pull changes from remote.
   */
  pull(clientId: string, agentId: string): void {
    this.store.dispatch(pull({ clientId, agentId }));
  }

  /**
   * Fetch changes from remote.
   */
  fetch(clientId: string, agentId: string): void {
    this.store.dispatch(fetch({ clientId, agentId }));
  }

  /**
   * Rebase current branch onto another branch.
   */
  rebase(clientId: string, agentId: string, dto: RebaseDto): void {
    this.store.dispatch(rebase({ clientId, agentId, dto }));
  }

  /**
   * Switch to a different branch.
   */
  switchBranch(clientId: string, agentId: string, branch: string): void {
    this.store.dispatch(switchBranch({ clientId, agentId, branch }));
  }

  /**
   * Create a new branch.
   */
  createBranch(clientId: string, agentId: string, dto: CreateBranchDto): void {
    this.store.dispatch(createBranch({ clientId, agentId, dto }));
  }

  /**
   * Delete a branch.
   */
  deleteBranch(clientId: string, agentId: string, branch: string): void {
    this.store.dispatch(deleteBranch({ clientId, agentId, branch }));
  }

  /**
   * Resolve a merge conflict.
   */
  resolveConflict(clientId: string, agentId: string, dto: ResolveConflictDto): void {
    this.store.dispatch(resolveConflict({ clientId, agentId, dto }));
  }
}
