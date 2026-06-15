import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { VcsState } from './vcs.reducer';

export const selectVcsState = createFeatureSelector<VcsState>('vcs');

export const selectGitStatus = createSelector(selectVcsState, (state) => state.status);

export const selectGitBranches = createSelector(selectVcsState, (state) => state.branches);

export const selectCurrentBranch = createSelector(selectGitStatus, (status) => status?.currentBranch);

export const selectGitDiff = createSelector(selectVcsState, (state) => state.diff);

export const selectLoadingStatus = createSelector(selectVcsState, (state) => state.loadingStatus);

export const selectLoadingBranches = createSelector(selectVcsState, (state) => state.loadingBranches);

export const selectLoadingDiff = createSelector(selectVcsState, (state) => state.loadingDiff);

export const selectStaging = createSelector(selectVcsState, (state) => state.staging);

export const selectUnstaging = createSelector(selectVcsState, (state) => state.unstaging);

export const selectCommitting = createSelector(selectVcsState, (state) => state.committing);

export const selectPushing = createSelector(selectVcsState, (state) => state.pushing);

export const selectPulling = createSelector(selectVcsState, (state) => state.pulling);

export const selectFetching = createSelector(selectVcsState, (state) => state.fetching);

export const selectRebasing = createSelector(selectVcsState, (state) => state.rebasing);

export const selectSwitchingBranch = createSelector(selectVcsState, (state) => state.switchingBranch);

export const selectCreatingBranch = createSelector(selectVcsState, (state) => state.creatingBranch);

export const selectDeletingBranch = createSelector(selectVcsState, (state) => state.deletingBranch);

export const selectResolvingConflict = createSelector(selectVcsState, (state) => state.resolvingConflict);

export const selectVcsError = createSelector(selectVcsState, (state) => state.error);

export const selectGitStatusIndicator = createSelector(selectGitStatus, (status) => {
  if (!status) return null;

  // Check for conflicts (files with 'U' in status = unmerged/conflict)
  const hasConflicts = status.files.some((f) => f.status.includes('U'));

  if (hasConflicts) return 'conflict'; // red

  // Check for local changes (staged, unstaged, untracked, or unpushed commits)
  const hasLocalChanges = !status.isClean || status.hasUnpushedCommits;

  if (hasLocalChanges) return 'changes'; // yellow

  // Completely in sync with remote
  return 'clean'; // green
});
