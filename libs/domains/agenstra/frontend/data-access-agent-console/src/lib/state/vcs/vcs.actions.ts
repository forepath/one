import { createAction, props } from '@ngrx/store';

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

// Git Status Actions
export const loadGitStatus = createAction('[VCS] Load Git Status', props<{ clientId: string; agentId: string }>());

export const loadGitStatusSuccess = createAction('[VCS] Load Git Status Success', props<{ status: GitStatus }>());

export const loadGitStatusFailure = createAction('[VCS] Load Git Status Failure', props<{ error: string }>());

// Git Branches Actions
export const loadGitBranches = createAction('[VCS] Load Git Branches', props<{ clientId: string; agentId: string }>());

export const loadGitBranchesSuccess = createAction(
  '[VCS] Load Git Branches Success',
  props<{ branches: GitBranch[] }>(),
);

export const loadGitBranchesFailure = createAction('[VCS] Load Git Branches Failure', props<{ error: string }>());

// Git Diff Actions
export const loadGitDiff = createAction(
  '[VCS] Load Git Diff',
  props<{ clientId: string; agentId: string; filePath: string }>(),
);

export const loadGitDiffSuccess = createAction('[VCS] Load Git Diff Success', props<{ diff: GitDiff }>());

export const loadGitDiffFailure = createAction('[VCS] Load Git Diff Failure', props<{ error: string }>());

export const clearGitDiff = createAction('[VCS] Clear Git Diff');

// Stage Files Actions
export const stageFiles = createAction(
  '[VCS] Stage Files',
  props<{ clientId: string; agentId: string; dto: StageFilesDto }>(),
);

export const stageFilesSuccess = createAction('[VCS] Stage Files Success');

export const stageFilesFailure = createAction('[VCS] Stage Files Failure', props<{ error: string }>());

// Unstage Files Actions
export const unstageFiles = createAction(
  '[VCS] Unstage Files',
  props<{ clientId: string; agentId: string; dto: UnstageFilesDto }>(),
);

export const unstageFilesSuccess = createAction('[VCS] Unstage Files Success');

export const unstageFilesFailure = createAction('[VCS] Unstage Files Failure', props<{ error: string }>());

// Commit Actions
export const commit = createAction('[VCS] Commit', props<{ clientId: string; agentId: string; dto: CommitDto }>());

export const commitSuccess = createAction('[VCS] Commit Success');

export const commitFailure = createAction('[VCS] Commit Failure', props<{ error: string }>());

// Push Actions
export const push = createAction('[VCS] Push', props<{ clientId: string; agentId: string; force?: boolean }>());

export const pushSuccess = createAction('[VCS] Push Success');

export const pushFailure = createAction('[VCS] Push Failure', props<{ error: string }>());

// Pull Actions
export const pull = createAction('[VCS] Pull', props<{ clientId: string; agentId: string }>());

export const pullSuccess = createAction('[VCS] Pull Success');

export const pullFailure = createAction('[VCS] Pull Failure', props<{ error: string }>());

// Fetch Actions
export const fetch = createAction('[VCS] Fetch', props<{ clientId: string; agentId: string }>());

export const fetchSuccess = createAction('[VCS] Fetch Success');

export const fetchFailure = createAction('[VCS] Fetch Failure', props<{ error: string }>());

// Rebase Actions
export const rebase = createAction('[VCS] Rebase', props<{ clientId: string; agentId: string; dto: RebaseDto }>());

export const rebaseSuccess = createAction('[VCS] Rebase Success');

export const rebaseFailure = createAction('[VCS] Rebase Failure', props<{ error: string }>());

// Switch Branch Actions
export const switchBranch = createAction(
  '[VCS] Switch Branch',
  props<{ clientId: string; agentId: string; branch: string }>(),
);

export const switchBranchSuccess = createAction('[VCS] Switch Branch Success');

export const switchBranchFailure = createAction('[VCS] Switch Branch Failure', props<{ error: string }>());

// Create Branch Actions
export const createBranch = createAction(
  '[VCS] Create Branch',
  props<{ clientId: string; agentId: string; dto: CreateBranchDto }>(),
);

export const createBranchSuccess = createAction('[VCS] Create Branch Success');

export const createBranchFailure = createAction('[VCS] Create Branch Failure', props<{ error: string }>());

// Delete Branch Actions
export const deleteBranch = createAction(
  '[VCS] Delete Branch',
  props<{ clientId: string; agentId: string; branch: string }>(),
);

export const deleteBranchSuccess = createAction('[VCS] Delete Branch Success');

export const deleteBranchFailure = createAction('[VCS] Delete Branch Failure', props<{ error: string }>());

// Resolve Conflict Actions
export const resolveConflict = createAction(
  '[VCS] Resolve Conflict',
  props<{ clientId: string; agentId: string; dto: ResolveConflictDto }>(),
);

export const resolveConflictSuccess = createAction('[VCS] Resolve Conflict Success');

export const resolveConflictFailure = createAction('[VCS] Resolve Conflict Failure', props<{ error: string }>());
