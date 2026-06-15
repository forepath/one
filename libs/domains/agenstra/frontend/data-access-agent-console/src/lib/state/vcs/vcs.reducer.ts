import { createReducer, on } from '@ngrx/store';

import {
  clearGitDiff,
  commit,
  commitFailure,
  commitSuccess,
  createBranch,
  createBranchFailure,
  createBranchSuccess,
  deleteBranch,
  deleteBranchFailure,
  deleteBranchSuccess,
  fetch,
  fetchFailure,
  fetchSuccess,
  loadGitBranches,
  loadGitBranchesFailure,
  loadGitBranchesSuccess,
  loadGitDiff,
  loadGitDiffFailure,
  loadGitDiffSuccess,
  loadGitStatus,
  loadGitStatusFailure,
  loadGitStatusSuccess,
  pull,
  pullFailure,
  pullSuccess,
  push,
  pushFailure,
  pushSuccess,
  rebase,
  rebaseFailure,
  rebaseSuccess,
  resolveConflict,
  resolveConflictFailure,
  resolveConflictSuccess,
  stageFiles,
  stageFilesFailure,
  stageFilesSuccess,
  switchBranch,
  switchBranchFailure,
  switchBranchSuccess,
  unstageFiles,
  unstageFilesFailure,
  unstageFilesSuccess,
} from './vcs.actions';
import type { GitBranch, GitDiff, GitStatus } from './vcs.types';

export interface VcsState {
  status: GitStatus | null;
  branches: GitBranch[];
  diff: GitDiff | null;
  loadingStatus: boolean;
  loadingBranches: boolean;
  loadingDiff: boolean;
  staging: boolean;
  unstaging: boolean;
  committing: boolean;
  pushing: boolean;
  pulling: boolean;
  fetching: boolean;
  rebasing: boolean;
  switchingBranch: boolean;
  creatingBranch: boolean;
  deletingBranch: boolean;
  resolvingConflict: boolean;
  error: string | null;
}

export const initialVcsState: VcsState = {
  status: null,
  branches: [],
  diff: null,
  loadingStatus: false,
  loadingBranches: false,
  loadingDiff: false,
  staging: false,
  unstaging: false,
  committing: false,
  pushing: false,
  pulling: false,
  fetching: false,
  rebasing: false,
  switchingBranch: false,
  creatingBranch: false,
  deletingBranch: false,
  resolvingConflict: false,
  error: null,
};

export const vcsReducer = createReducer(
  initialVcsState,

  // Load Git Status
  on(loadGitStatus, (state) => ({
    ...state,
    loadingStatus: true,
    error: null,
  })),
  on(loadGitStatusSuccess, (state, { status }) => ({
    ...state,
    status,
    loadingStatus: false,
    error: null,
  })),
  on(loadGitStatusFailure, (state, { error }) => ({
    ...state,
    loadingStatus: false,
    error,
  })),

  // Load Git Branches
  on(loadGitBranches, (state) => ({
    ...state,
    loadingBranches: true,
    error: null,
  })),
  on(loadGitBranchesSuccess, (state, { branches }) => ({
    ...state,
    branches,
    loadingBranches: false,
    error: null,
  })),
  on(loadGitBranchesFailure, (state, { error }) => ({
    ...state,
    loadingBranches: false,
    error,
  })),

  // Load Git Diff
  on(loadGitDiff, (state) => ({
    ...state,
    loadingDiff: true,
    error: null,
  })),
  on(loadGitDiffSuccess, (state, { diff }) => ({
    ...state,
    diff,
    loadingDiff: false,
    error: null,
  })),
  on(loadGitDiffFailure, (state, { error }) => ({
    ...state,
    loadingDiff: false,
    error,
  })),
  on(clearGitDiff, (state) => ({
    ...state,
    diff: null,
  })),

  // Stage Files
  on(stageFiles, (state) => ({
    ...state,
    staging: true,
    error: null,
  })),
  on(stageFilesSuccess, (state) => ({
    ...state,
    staging: false,
    error: null,
  })),
  on(stageFilesFailure, (state, { error }) => ({
    ...state,
    staging: false,
    error,
  })),

  // Unstage Files
  on(unstageFiles, (state) => ({
    ...state,
    unstaging: true,
    error: null,
  })),
  on(unstageFilesSuccess, (state) => ({
    ...state,
    unstaging: false,
    error: null,
  })),
  on(unstageFilesFailure, (state, { error }) => ({
    ...state,
    unstaging: false,
    error,
  })),

  // Commit
  on(commit, (state) => ({
    ...state,
    committing: true,
    error: null,
  })),
  on(commitSuccess, (state) => ({
    ...state,
    committing: false,
    error: null,
  })),
  on(commitFailure, (state, { error }) => ({
    ...state,
    committing: false,
    error,
  })),

  // Push
  on(push, (state) => ({
    ...state,
    pushing: true,
    error: null,
  })),
  on(pushSuccess, (state) => ({
    ...state,
    pushing: false,
    error: null,
  })),
  on(pushFailure, (state, { error }) => ({
    ...state,
    pushing: false,
    error,
  })),

  // Pull
  on(pull, (state) => ({
    ...state,
    pulling: true,
    error: null,
  })),
  on(pullSuccess, (state) => ({
    ...state,
    pulling: false,
    error: null,
  })),
  on(pullFailure, (state, { error }) => ({
    ...state,
    pulling: false,
    error,
  })),

  // Fetch
  on(fetch, (state) => ({
    ...state,
    fetching: true,
    error: null,
  })),
  on(fetchSuccess, (state) => ({
    ...state,
    fetching: false,
    error: null,
  })),
  on(fetchFailure, (state, { error }) => ({
    ...state,
    fetching: false,
    error,
  })),

  // Rebase
  on(rebase, (state) => ({
    ...state,
    rebasing: true,
    error: null,
  })),
  on(rebaseSuccess, (state) => ({
    ...state,
    rebasing: false,
    error: null,
  })),
  on(rebaseFailure, (state, { error }) => ({
    ...state,
    rebasing: false,
    error,
  })),

  // Switch Branch
  on(switchBranch, (state) => ({
    ...state,
    switchingBranch: true,
    error: null,
  })),
  on(switchBranchSuccess, (state) => ({
    ...state,
    switchingBranch: false,
    error: null,
  })),
  on(switchBranchFailure, (state, { error }) => ({
    ...state,
    switchingBranch: false,
    error,
  })),

  // Create Branch
  on(createBranch, (state) => ({
    ...state,
    creatingBranch: true,
    error: null,
  })),
  on(createBranchSuccess, (state) => ({
    ...state,
    creatingBranch: false,
    error: null,
  })),
  on(createBranchFailure, (state, { error }) => ({
    ...state,
    creatingBranch: false,
    error,
  })),

  // Delete Branch
  on(deleteBranch, (state) => ({
    ...state,
    deletingBranch: true,
    error: null,
  })),
  on(deleteBranchSuccess, (state) => ({
    ...state,
    deletingBranch: false,
    error: null,
  })),
  on(deleteBranchFailure, (state, { error }) => ({
    ...state,
    deletingBranch: false,
    error,
  })),

  // Resolve Conflict
  on(resolveConflict, (state) => ({
    ...state,
    resolvingConflict: true,
    error: null,
  })),
  on(resolveConflictSuccess, (state) => ({
    ...state,
    resolvingConflict: false,
    error: null,
  })),
  on(resolveConflictFailure, (state, { error }) => ({
    ...state,
    resolvingConflict: false,
    error,
  })),
);
