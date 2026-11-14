import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { Observable, of, throwError } from 'rxjs';
import { take } from 'rxjs/operators';

import { AgentGraphsService } from '../../services/agent-graphs.service';

import {
  agentGraphRefreshPollFinished,
  expandAgentGraphNeighbors,
  expandAgentGraphNeighborsSuccess,
  loadAgentGraphDocument,
  loadAgentGraphDocumentFailure,
  loadAgentGraphDocumentSuccess,
  loadAgentGraphNodeDetail,
  loadAgentGraphNodeDetailSuccess,
  loadAgentGraphOverview,
  loadAgentGraphReferences,
  loadAgentGraphReferencesSuccess,
  loadAgentGraphStatusSuccess,
  loadGlobalAgentGraph,
  loadAgentGraphDocumentPageSuccess,
  loadWorkspaceAgentGraph,
  refreshAgentGraph,
  refreshAgentGraphFailure,
  refreshAgentGraphSuccess,
  refreshWorkspaceGraphSnapshot,
  refreshWorkspaceGraphSnapshotSuccess,
  searchAgentGraph,
  searchAgentGraphSuccess,
} from './agent-graphs.actions';
import {
  AGENT_GRAPH_STATUS_POLL_MAX,
  AGENT_GRAPH_STATUS_POLL_MS,
  expandAgentGraphNeighbors$,
  loadAgentGraphDocument$,
  loadAgentGraphNodeDetail$,
  loadAgentGraphReferences$,
  loadGlobalAgentGraph$,
  loadWorkspaceAgentGraph$,
  pollAgentGraphStatusAfterRefresh$,
  refreshAgentGraph$,
  refreshWorkspaceGraphSnapshot$,
  searchAgentGraph$,
} from './agent-graphs.effects';
import {
  agentGraphDocumentKey,
  agentGraphNodeDetailKey,
  type AgentGraphDocument,
  type AgentGraphNodeDetail,
  type AgentGraphStatus,
} from './agent-graphs.types';

function documentFixture(overrides: Partial<AgentGraphDocument> = {}): AgentGraphDocument {
  return {
    version: 1,
    scope: 'environment',
    layer: 'code',
    environmentId: 'a1',
    generatedAt: '2026-11-07T10:00:00.000Z',
    nodes: [{ id: 'file:a', type: 'file', label: 'a' }],
    edges: [],
    truncated: false,
    totalNodes: 1,
    totalEdges: 0,
    ...overrides,
  };
}

function statusFixture(overrides: Partial<AgentGraphStatus> = {}): AgentGraphStatus {
  return {
    environmentId: 'a1',
    status: 'ready',
    builtAt: '2026-11-07T10:00:00.000Z',
    buildDurationMs: 1200,
    truncated: false,
    error: null,
    layers: {},
    languages: {},
    fileCount: 1,
    ...overrides,
  };
}

type ServiceMock = jest.Mocked<
  Pick<
    AgentGraphsService,
    | 'getDocument'
    | 'getWorkspaceGraph'
    | 'getGlobalGraph'
    | 'getNeighbors'
    | 'getStatus'
    | 'refresh'
    | 'getNode'
    | 'search'
    | 'getReferences'
    | 'refreshWorkspaceSnapshot'
  >
>;

describe('agent graphs effects', () => {
  let actions$: Observable<Action>;
  let service: ServiceMock;

  beforeEach(() => {
    service = {
      getDocument: jest.fn(),
      getWorkspaceGraph: jest.fn(),
      getGlobalGraph: jest.fn(),
      getNeighbors: jest.fn(),
      getStatus: jest.fn(),
      refresh: jest.fn(),
      getNode: jest.fn(),
      search: jest.fn(),
      getReferences: jest.fn(),
      refreshWorkspaceSnapshot: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AgentGraphsService, useValue: service }],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const first = (effect: () => Observable<Action>): Promise<Action> =>
    new Promise((resolve) => TestBed.runInInjectionContext(() => effect().pipe(take(1)).subscribe(resolve)));
  const collect = (effect: () => Observable<Action>): Action[] => {
    const emitted: Action[] = [];

    TestBed.runInInjectionContext(() => effect().subscribe((action) => emitted.push(action)));

    return emitted;
  };

  it('loads an environment document with a fixed node limit in one request', async () => {
    service.getDocument.mockReturnValue(of(documentFixture()));
    actions$ = of(loadAgentGraphDocument({ clientId: 'c1', agentId: 'a1', layer: 'code', limit: 3000 }));

    await expect(first(loadAgentGraphDocument$)).resolves.toEqual(
      loadAgentGraphDocumentSuccess({ key: 'environment:c1:a1:code:3000', document: documentFixture() }),
    );
    expect(service.getDocument).toHaveBeenCalledWith('c1', 'a1', {
      layer: 'code',
      limit: 3000,
      offset: 0,
      types: undefined,
    });
  });

  it('loads every page in turn without a node limit', () => {
    const pages = [
      documentFixture({ nodes: [{ id: 'a', type: 'file', label: 'a' }], nextOffset: 2000, truncated: true }),
      documentFixture({
        nodes: [{ id: 'b', type: 'file', label: 'b' }],
        offset: 2000,
        nextOffset: 4000,
        truncated: true,
      }),
      documentFixture({ nodes: [{ id: 'c', type: 'file', label: 'c' }], offset: 4000, nextOffset: null }),
    ];

    service.getDocument.mockImplementation((_c, _a, query) => of(pages[(query?.offset ?? 0) / 2000]));
    actions$ = of(loadAgentGraphDocument({ clientId: 'c1', agentId: 'a1', layer: 'all' }));

    const key = 'environment:c1:a1:all:all';

    expect(collect(loadAgentGraphDocument$)).toEqual([
      loadAgentGraphDocumentSuccess({ key, document: pages[0] }),
      loadAgentGraphDocumentPageSuccess({ key, document: pages[1] }),
      loadAgentGraphDocumentPageSuccess({ key, document: pages[2] }),
    ]);
    expect(service.getDocument.mock.calls.map(([, , query]) => [query?.offset, query?.limit])).toEqual([
      [0, 2000],
      [2000, 2000],
      [4000, 2000],
    ]);
  });

  it('maps validation errors (message arrays) to one string', async () => {
    service.getDocument.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { message: ['a', 'b'] } })),
    );
    actions$ = of(loadAgentGraphDocument({ clientId: 'c1', agentId: 'a1', layer: 'code' }));

    await expect(first(loadAgentGraphDocument$)).resolves.toEqual(
      loadAgentGraphDocumentFailure({ key: 'environment:c1:a1:code:all', error: 'a; b' }),
    );
  });

  it('loads workspace and global graphs per layer', async () => {
    service.getWorkspaceGraph.mockReturnValue(of(documentFixture({ scope: 'workspace' })));
    service.getGlobalGraph.mockReturnValue(of(documentFixture({ scope: 'global', layer: 'knowledge' })));

    actions$ = of(loadWorkspaceAgentGraph({ clientId: 'c1', layer: 'paths', limit: 1500 }));
    await expect(first(loadWorkspaceAgentGraph$)).resolves.toEqual(
      loadAgentGraphDocumentSuccess({
        key: agentGraphDocumentKey({ scope: 'workspace', clientId: 'c1', layer: 'paths', limit: 1500 }),
        document: documentFixture({ scope: 'workspace' }),
      }),
    );
    expect(service.getWorkspaceGraph).toHaveBeenCalledWith('c1', { layer: 'paths', limit: 1500, offset: 0 });

    actions$ = of(loadGlobalAgentGraph({ layer: 'knowledge', limit: 6000 }));
    await expect(first(loadGlobalAgentGraph$)).resolves.toEqual(
      loadAgentGraphDocumentSuccess({
        key: 'global:::knowledge:6000',
        document: documentFixture({ scope: 'global', layer: 'knowledge' }),
      }),
    );
    expect(service.getGlobalGraph).toHaveBeenCalledWith({ layer: 'knowledge', limit: 6000, offset: 0 });
  });

  it('expands neighbors of a node', async () => {
    service.getNeighbors.mockReturnValue(of(documentFixture()));
    actions$ = of(expandAgentGraphNeighbors({ clientId: 'c1', agentId: 'a1', layer: 'code', nodeId: 'file:a' }));

    await expect(first(expandAgentGraphNeighbors$)).resolves.toEqual(
      expandAgentGraphNeighborsSuccess({ key: 'environment:c1:a1:code:all', document: documentFixture() }),
    );
    expect(service.getNeighbors).toHaveBeenCalledWith('c1', 'a1', 'file:a', { layer: 'code', depth: 1 });
  });

  it('queues a refresh and reports failures', async () => {
    service.refresh.mockReturnValueOnce(of({ environmentId: 'a1', queued: true, status: 'building' }));
    actions$ = of(refreshAgentGraph({ clientId: 'c1', agentId: 'a1', layer: 'code' }));
    await expect(first(refreshAgentGraph$)).resolves.toEqual(
      refreshAgentGraphSuccess({
        clientId: 'c1',
        agentId: 'a1',
        layer: 'code',
        response: { environmentId: 'a1', queued: true, status: 'building' },
      }),
    );

    service.refresh.mockReturnValueOnce(throwError(() => new Error('down')));
    actions$ = of(refreshAgentGraph({ clientId: 'c1', agentId: 'a1', layer: 'code' }));
    await expect(first(refreshAgentGraph$)).resolves.toEqual(
      refreshAgentGraphFailure({ clientId: 'c1', agentId: 'a1', error: 'down' }),
    );
  });

  it('polls the status while building and reloads the document afterwards', () => {
    jest.useFakeTimers();
    service.getStatus
      .mockReturnValueOnce(of(statusFixture({ status: 'building' })))
      .mockReturnValueOnce(of(statusFixture({ status: 'ready' })));
    actions$ = of(
      refreshAgentGraphSuccess({
        clientId: 'c1',
        agentId: 'a1',
        layer: 'paths',
        limit: 3000,
        response: { environmentId: 'a1', queued: true, status: 'building' },
      }),
    );

    const emitted = collect(pollAgentGraphStatusAfterRefresh$);

    expect(emitted).toEqual([]);
    jest.advanceTimersByTime(AGENT_GRAPH_STATUS_POLL_MS);
    expect(emitted).toEqual([
      loadAgentGraphStatusSuccess({ clientId: 'c1', agentId: 'a1', status: statusFixture({ status: 'building' }) }),
    ]);
    jest.advanceTimersByTime(AGENT_GRAPH_STATUS_POLL_MS);
    expect(emitted.slice(1)).toEqual([
      loadAgentGraphStatusSuccess({ clientId: 'c1', agentId: 'a1', status: statusFixture({ status: 'ready' }) }),
      agentGraphRefreshPollFinished({ clientId: 'c1', agentId: 'a1', status: statusFixture({ status: 'ready' }) }),
      loadAgentGraphDocument({ clientId: 'c1', agentId: 'a1', layer: 'paths', limit: 3000 }),
      loadAgentGraphOverview({ clientId: 'c1', agentId: 'a1' }),
    ]);
    expect(service.getStatus).toHaveBeenCalledTimes(2);
  });

  it('stops polling after the poll window without reloading', () => {
    jest.useFakeTimers();
    service.getStatus.mockReturnValue(of(statusFixture({ status: 'building' })));
    actions$ = of(
      refreshAgentGraphSuccess({
        clientId: 'c1',
        agentId: 'a1',
        layer: 'code',
        response: { environmentId: 'a1', queued: true, status: 'building' },
      }),
    );

    const emitted = collect(pollAgentGraphStatusAfterRefresh$);

    jest.advanceTimersByTime(AGENT_GRAPH_STATUS_POLL_MS * (AGENT_GRAPH_STATUS_POLL_MAX + 2));
    expect(service.getStatus).toHaveBeenCalledTimes(AGENT_GRAPH_STATUS_POLL_MAX);
    expect(emitted[emitted.length - 1]).toEqual(
      agentGraphRefreshPollFinished({ clientId: 'c1', agentId: 'a1', status: statusFixture({ status: 'building' }) }),
    );
    expect(emitted.some((action) => action.type === loadAgentGraphDocument.type)).toBe(false);
  });

  it('loads node details under their key', async () => {
    const detail: AgentGraphNodeDetail = {
      node: { id: 'file:a', type: 'file', label: 'a' },
      outgoing: [],
      incoming: [],
      truncated: false,
    };

    service.getNode.mockReturnValue(of(detail));
    actions$ = of(loadAgentGraphNodeDetail({ clientId: 'c1', agentId: 'a1', layer: 'code', nodeId: 'file:a' }));

    await expect(first(loadAgentGraphNodeDetail$)).resolves.toEqual(
      loadAgentGraphNodeDetailSuccess({
        key: agentGraphNodeDetailKey('c1', 'a1', 'code', 'file:a'),
        clientId: 'c1',
        agentId: 'a1',
        layer: 'code',
        detail,
      }),
    );
    expect(service.getNode).toHaveBeenCalledWith('c1', 'a1', 'file:a', 'code');
  });

  it('searches and loads prompt references', async () => {
    service.search.mockReturnValue(of({ query: 'auth', hits: [], byType: {} }));
    actions$ = of(searchAgentGraph({ clientId: 'c1', agentId: 'a1', query: 'auth', layer: 'code' }));
    await expect(first(searchAgentGraph$)).resolves.toEqual(
      searchAgentGraphSuccess({ response: { query: 'auth', hits: [], byType: {} } }),
    );

    service.getReferences.mockReturnValue(of({ environmentId: 'a1', prompts: [] }));
    actions$ = of(loadAgentGraphReferences({ clientId: 'c1', agentId: 'a1', promptId: 'p1' }));
    await expect(first(loadAgentGraphReferences$)).resolves.toEqual(
      loadAgentGraphReferencesSuccess({
        clientId: 'c1',
        agentId: 'a1',
        response: { environmentId: 'a1', prompts: [] },
      }),
    );
    expect(service.getReferences).toHaveBeenCalledWith('c1', 'a1', { promptId: 'p1', limit: undefined });
  });

  it('refreshes the workspace snapshot and reloads it', () => {
    const status = { clientId: 'c1', status: 'ready' as const, builtAt: null, error: null, nodes: 1, edges: 0 };

    service.refreshWorkspaceSnapshot.mockReturnValue(of(status));
    actions$ = of(refreshWorkspaceGraphSnapshot({ clientId: 'c1', layer: 'knowledge' }));

    expect(collect(refreshWorkspaceGraphSnapshot$)).toEqual([
      refreshWorkspaceGraphSnapshotSuccess({ clientId: 'c1', status }),
      loadWorkspaceAgentGraph({ clientId: 'c1', layer: 'knowledge' }),
    ]);
  });
});
