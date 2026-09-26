import { createReducer, on } from '@ngrx/store';

import * as WorkspaceSearchActions from './workspace-search.actions';
import type { WorkspaceIndexStatusState, WorkspaceSearchHitDto, WorkspaceSearchMode } from './workspace-search.types';

export interface WorkspaceSearchState {
  clientId: string | null;
  agentId: string | null;
  query: string;
  mode: WorkspaceSearchMode;
  includePaths: string[];
  excludePaths: string[];
  indexStatus: WorkspaceIndexStatusState | null;
  docCount: number;
  hits: WorkspaceSearchHitDto[];
  total: number;
  loading: boolean;
  error: string | null;
}

export const initialWorkspaceSearchState: WorkspaceSearchState = {
  clientId: null,
  agentId: null,
  query: '',
  mode: 'full',
  includePaths: [],
  excludePaths: [],
  indexStatus: null,
  docCount: 0,
  hits: [],
  total: 0,
  loading: false,
  error: null,
};

export const workspaceSearchReducer = createReducer(
  initialWorkspaceSearchState,
  on(WorkspaceSearchActions.setWorkspaceSearchQuery, (state, { query }) => ({
    ...state,
    query,
  })),
  on(WorkspaceSearchActions.setWorkspaceSearchMode, (state, { mode }) => ({
    ...state,
    mode,
  })),
  on(WorkspaceSearchActions.setWorkspaceIncludePaths, (state, { paths }) => ({
    ...state,
    includePaths: paths,
  })),
  on(WorkspaceSearchActions.setWorkspaceExcludePaths, (state, { paths }) => ({
    ...state,
    excludePaths: paths,
  })),
  on(WorkspaceSearchActions.clearWorkspaceSearchResults, (state) => ({
    ...state,
    hits: [],
    total: 0,
    error: null,
  })),
  on(WorkspaceSearchActions.loadWorkspaceIndexStatus, (state, { clientId, agentId }) => ({
    ...state,
    clientId,
    agentId,
    loading: true,
    error: null,
  })),
  on(WorkspaceSearchActions.loadWorkspaceIndexStatusSuccess, (state, { status }) => ({
    ...state,
    loading: false,
    indexStatus: status.status,
    docCount: status.docCount,
    error: status.message ?? null,
  })),
  on(WorkspaceSearchActions.loadWorkspaceIndexStatusFailure, (state, { error }) => ({
    ...state,
    loading: false,
    indexStatus: 'error' as const,
    error,
  })),
  on(
    WorkspaceSearchActions.searchWorkspace,
    (state, { clientId, agentId, query, includePaths, excludePaths, mode }) => ({
      ...state,
      clientId,
      agentId,
      query,
      includePaths,
      excludePaths,
      mode,
      loading: true,
      error: null,
    }),
  ),
  on(WorkspaceSearchActions.searchWorkspaceSuccess, (state, { status, hits, total }) => ({
    ...state,
    loading: false,
    indexStatus: status,
    hits,
    total,
  })),
  on(WorkspaceSearchActions.searchWorkspaceFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(WorkspaceSearchActions.reindexWorkspace, (state) => ({
    ...state,
    loading: true,
    indexStatus: 'indexing' as const,
    error: null,
  })),
  on(WorkspaceSearchActions.reindexWorkspaceSuccess, (state) => ({
    ...state,
    loading: false,
    indexStatus: 'indexing' as const,
  })),
  on(WorkspaceSearchActions.reindexWorkspaceFailure, (state, { error }) => ({
    ...state,
    loading: false,
    indexStatus: 'error' as const,
    error,
  })),
);
