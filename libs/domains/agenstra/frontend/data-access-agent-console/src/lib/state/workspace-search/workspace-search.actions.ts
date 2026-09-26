import { createAction, props } from '@ngrx/store';

import type {
  WorkspaceIndexStatusDto,
  WorkspaceSearchHitDto,
  WorkspaceIndexStatusState,
  WorkspaceSearchMode,
} from './workspace-search.types';

export const loadWorkspaceIndexStatus = createAction(
  '[WorkspaceSearch] Load Status',
  props<{ clientId: string; agentId: string }>(),
);

export const loadWorkspaceIndexStatusSuccess = createAction(
  '[WorkspaceSearch] Load Status Success',
  props<{ clientId: string; agentId: string; status: WorkspaceIndexStatusDto }>(),
);

export const loadWorkspaceIndexStatusFailure = createAction(
  '[WorkspaceSearch] Load Status Failure',
  props<{ clientId: string; agentId: string; error: string }>(),
);

export const searchWorkspace = createAction(
  '[WorkspaceSearch] Search',
  props<{
    clientId: string;
    agentId: string;
    query: string;
    includePaths: string[];
    excludePaths: string[];
    mode: WorkspaceSearchMode;
  }>(),
);

export const searchWorkspaceSuccess = createAction(
  '[WorkspaceSearch] Search Success',
  props<{
    clientId: string;
    agentId: string;
    status: WorkspaceIndexStatusState;
    hits: WorkspaceSearchHitDto[];
    total: number;
  }>(),
);

export const searchWorkspaceFailure = createAction(
  '[WorkspaceSearch] Search Failure',
  props<{ clientId: string; agentId: string; error: string }>(),
);

export const reindexWorkspace = createAction(
  '[WorkspaceSearch] Reindex',
  props<{ clientId: string; agentId: string }>(),
);

export const reindexWorkspaceSuccess = createAction(
  '[WorkspaceSearch] Reindex Success',
  props<{ clientId: string; agentId: string }>(),
);

export const reindexWorkspaceFailure = createAction(
  '[WorkspaceSearch] Reindex Failure',
  props<{ clientId: string; agentId: string; error: string }>(),
);

export const setWorkspaceSearchQuery = createAction('[WorkspaceSearch] Set Query', props<{ query: string }>());

export const setWorkspaceSearchMode = createAction(
  '[WorkspaceSearch] Set Mode',
  props<{ mode: WorkspaceSearchMode }>(),
);

export const setWorkspaceIncludePaths = createAction(
  '[WorkspaceSearch] Set Include Paths',
  props<{ paths: string[] }>(),
);

export const setWorkspaceExcludePaths = createAction(
  '[WorkspaceSearch] Set Exclude Paths',
  props<{ paths: string[] }>(),
);

export const clearWorkspaceSearchResults = createAction('[WorkspaceSearch] Clear Results');
