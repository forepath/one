import { of, throwError } from 'rxjs';

import { WorkspaceSearchService } from '../../services/workspace-search.service';

import * as WorkspaceSearchActions from './workspace-search.actions';
import {
  loadWorkspaceIndexStatus$,
  reindexWorkspace$,
  reindexWorkspaceRefreshStatus$,
  searchWorkspace$,
} from './workspace-search.effects';

describe('WorkspaceSearchEffects', () => {
  let service: jest.Mocked<Pick<WorkspaceSearchService, 'getStatus' | 'search' | 'reindex'>>;

  beforeEach(() => {
    service = {
      getStatus: jest.fn(),
      search: jest.fn(),
      reindex: jest.fn(),
    };
  });

  it('loadWorkspaceIndexStatus$ maps success', (done) => {
    service.getStatus.mockReturnValue(of({ status: 'ready', docCount: 3 }));
    const action = WorkspaceSearchActions.loadWorkspaceIndexStatus({ clientId: 'c1', agentId: 'a1' });

    loadWorkspaceIndexStatus$(of(action), service as WorkspaceSearchService).subscribe((result) => {
      expect(result).toEqual(
        WorkspaceSearchActions.loadWorkspaceIndexStatusSuccess({
          clientId: 'c1',
          agentId: 'a1',
          status: { status: 'ready', docCount: 3 },
        }),
      );
      done();
    });
  });

  it('searchWorkspace$ maps hits', (done) => {
    service.search.mockReturnValue(
      of({
        status: 'ready',
        hits: [{ path: 'a.ts', fileName: 'a.ts', fileType: 'text', size: 1, snippet: null, line: null }],
        total: 1,
      }),
    );
    const action = WorkspaceSearchActions.searchWorkspace({
      clientId: 'c1',
      agentId: 'a1',
      query: 'foo',
      includePaths: [],
      excludePaths: [],
      mode: 'full',
    });

    searchWorkspace$(of(action), service as WorkspaceSearchService).subscribe((result) => {
      expect(result.type).toBe(WorkspaceSearchActions.searchWorkspaceSuccess.type);
      done();
    });
  });

  it('searchWorkspace$ maps failure', (done) => {
    service.search.mockReturnValue(throwError(() => new Error('boom')));
    const action = WorkspaceSearchActions.searchWorkspace({
      clientId: 'c1',
      agentId: 'a1',
      query: 'foo',
      includePaths: [],
      excludePaths: [],
      mode: 'full',
    });

    searchWorkspace$(of(action), service as WorkspaceSearchService).subscribe((result) => {
      expect(result).toEqual(
        WorkspaceSearchActions.searchWorkspaceFailure({
          clientId: 'c1',
          agentId: 'a1',
          error: 'boom',
        }),
      );
      done();
    });
  });

  it('reindexWorkspace$ maps success', (done) => {
    service.reindex.mockReturnValue(of({ accepted: true as const }));
    const action = WorkspaceSearchActions.reindexWorkspace({ clientId: 'c1', agentId: 'a1' });

    reindexWorkspace$(of(action), service as WorkspaceSearchService).subscribe((result) => {
      expect(result).toEqual(WorkspaceSearchActions.reindexWorkspaceSuccess({ clientId: 'c1', agentId: 'a1' }));
      done();
    });
  });

  it('reindexWorkspaceRefreshStatus$ loads status after success', (done) => {
    const action = WorkspaceSearchActions.reindexWorkspaceSuccess({ clientId: 'c1', agentId: 'a1' });

    reindexWorkspaceRefreshStatus$(of(action)).subscribe((result) => {
      expect(result).toEqual(WorkspaceSearchActions.loadWorkspaceIndexStatus({ clientId: 'c1', agentId: 'a1' }));
      done();
    });
  });
});
