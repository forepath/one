import { workspaceSearchReducer, initialWorkspaceSearchState } from './workspace-search.reducer';
import * as WorkspaceSearchActions from './workspace-search.actions';

describe('workspaceSearchReducer', () => {
  it('stores search success hits and status', () => {
    const state = workspaceSearchReducer(
      initialWorkspaceSearchState,
      WorkspaceSearchActions.searchWorkspaceSuccess({
        clientId: 'c1',
        agentId: 'a1',
        status: 'ready',
        hits: [{ path: 'a.ts', fileName: 'a.ts', fileType: 'text', size: 1 }],
        total: 1,
      }),
    );

    expect(state.indexStatus).toBe('ready');
    expect(state.hits).toHaveLength(1);
    expect(state.loading).toBe(false);
  });

  it('marks indexing on reindex', () => {
    const state = workspaceSearchReducer(
      initialWorkspaceSearchState,
      WorkspaceSearchActions.reindexWorkspace({ clientId: 'c1', agentId: 'a1' }),
    );

    expect(state.indexStatus).toBe('indexing');
    expect(state.loading).toBe(true);
  });

  it('stores search mode', () => {
    const state = workspaceSearchReducer(
      initialWorkspaceSearchState,
      WorkspaceSearchActions.setWorkspaceSearchMode({ mode: 'files' }),
    );

    expect(state.mode).toBe('files');
  });
});
