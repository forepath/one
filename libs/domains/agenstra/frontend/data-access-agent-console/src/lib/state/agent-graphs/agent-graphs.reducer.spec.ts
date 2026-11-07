import {
  agentGraphRefreshPollFinished,
  clearAgentGraphNodeDetail,
  expandAgentGraphNeighbors,
  expandAgentGraphNeighborsSuccess,
  loadAgentGraphDocument,
  loadAgentGraphDocumentFailure,
  loadAgentGraphDocumentSuccess,
  loadAgentGraphNodeDetail,
  loadAgentGraphNodeDetailSuccess,
  loadAgentGraphOverview,
  loadAgentGraphOverviewSuccess,
  loadAgentGraphReferences,
  loadAgentGraphReferencesSuccess,
  loadAgentGraphStatus,
  loadAgentGraphStatusSuccess,
  loadGlobalAgentGraph,
  loadAgentGraphDocumentPageSuccess,
  loadWorkspaceAgentGraph,
  refreshAgentGraph,
  refreshAgentGraphFailure,
  refreshAgentGraphSuccess,
  refreshWorkspaceGraphSnapshot,
  refreshWorkspaceGraphSnapshotSuccess,
} from './agent-graphs.actions';
import { agentGraphsReducer, initialAgentGraphsState, type AgentGraphsState } from './agent-graphs.reducer';
import {
  agentGraphDocumentKey,
  agentGraphNodeDetailKey,
  mergeAgentGraphDocuments,
  type AgentGraphDocument,
  type AgentGraphNode,
  type AgentGraphNodeDetail,
  type AgentGraphOverview,
  type AgentGraphStatus,
} from './agent-graphs.types';

function node(id: string, overrides: Partial<AgentGraphNode> = {}): AgentGraphNode {
  return { id, type: 'file', label: id, ...overrides };
}

function documentFixture(overrides: Partial<AgentGraphDocument> = {}): AgentGraphDocument {
  return {
    version: 1,
    scope: 'environment',
    layer: 'code',
    environmentId: 'a1',
    generatedAt: '2026-11-07T10:00:00.000Z',
    nodes: [node('file:a'), node('file:b')],
    edges: [{ from: 'file:a', to: 'file:b', type: 'imports' }],
    truncated: false,
    totalNodes: 2,
    totalEdges: 1,
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
    languages: { typescript: 2 },
    fileCount: 2,
    ...overrides,
  };
}

function detailFixture(nodeId = 'file:a'): AgentGraphNodeDetail {
  return {
    node: node(nodeId),
    outgoing: [{ edge: { from: nodeId, to: 'file:b', type: 'imports' }, node: node('file:b') }],
    incoming: [],
    truncated: false,
  };
}

const envKey = agentGraphDocumentKey({ scope: 'environment', clientId: 'c1', agentId: 'a1', layer: 'code' });

function withDocument(): AgentGraphsState {
  return agentGraphsReducer(
    agentGraphsReducer(
      initialAgentGraphsState,
      loadAgentGraphDocument({ clientId: 'c1', agentId: 'a1', layer: 'code' }),
    ),
    loadAgentGraphDocumentSuccess({ key: envKey, document: documentFixture() }),
  );
}

describe('agentGraphsReducer', () => {
  it('keeps only the document currently viewed', () => {
    const loaded = withDocument();

    expect(loaded.documentKey).toBe(envKey);
    expect(loaded.document?.nodes).toHaveLength(2);
    expect(loaded.documentLoading).toBe(false);

    // Reloading the same view keeps the document while loading.
    const reloading = agentGraphsReducer(
      loaded,
      loadAgentGraphDocument({ clientId: 'c1', agentId: 'a1', layer: 'code' }),
    );

    expect(reloading.document).toBe(loaded.document);
    expect(reloading.documentLoading).toBe(true);

    // Another view drops it right away.
    const other = agentGraphsReducer(loaded, loadAgentGraphDocument({ clientId: 'c1', agentId: 'a1', layer: 'paths' }));

    expect(other.document).toBeNull();
    expect(other.documentKey).not.toBe(envKey);
  });

  it('ignores late responses of an earlier view', () => {
    const switched = agentGraphsReducer(withDocument(), loadGlobalAgentGraph({}));
    const late = agentGraphsReducer(
      switched,
      loadAgentGraphDocumentSuccess({ key: envKey, document: documentFixture() }),
    );

    expect(late.document).toBeNull();
    expect(late.documentLoading).toBe(true);

    const lateFailure = agentGraphsReducer(switched, loadAgentGraphDocumentFailure({ key: envKey, error: 'boom' }));

    expect(lateFailure.documentError).toBeNull();
  });

  it('keys documents by scope, layer and node limit', () => {
    const knowledge = agentGraphsReducer(
      initialAgentGraphsState,
      loadWorkspaceAgentGraph({ clientId: 'c1', layer: 'knowledge' }),
    );
    const global = agentGraphsReducer(initialAgentGraphsState, loadGlobalAgentGraph({ layer: 'code', limit: 1500 }));

    expect(knowledge.documentKey).toBe('workspace:c1::knowledge:all');
    expect(global.documentKey).toBe('global:::code:1500');
  });

  it('shows the first page right away and appends further pages', () => {
    const key = 'environment:c1:a1:all:all';
    const loading = agentGraphsReducer(
      initialAgentGraphsState,
      loadAgentGraphDocument({ clientId: 'c1', agentId: 'a1', layer: 'all' }),
    );

    expect(loading.documentKey).toBe(key);

    const first = agentGraphsReducer(
      loading,
      loadAgentGraphDocumentSuccess({
        key,
        document: documentFixture({ nodes: [node('a')], edges: [], truncated: true, totalNodes: 2, nextOffset: 1 }),
      }),
    );

    expect(first.documentLoading).toBe(false);
    expect(first.documentLoadingMore).toBe(true);

    const second = agentGraphsReducer(
      first,
      loadAgentGraphDocumentPageSuccess({
        key,
        document: documentFixture({
          nodes: [node('b')],
          edges: [{ from: 'a', to: 'b', type: 'imports' }],
          truncated: false,
          totalNodes: 2,
          offset: 1,
          nextOffset: null,
        }),
      }),
    );

    expect(second.documentLoadingMore).toBe(false);
    expect(second.document?.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(second.document?.edges).toHaveLength(1);
    expect(second.document?.truncated).toBe(false);
  });

  it('merges expanded neighbors into the current document', () => {
    const loading = agentGraphsReducer(
      withDocument(),
      expandAgentGraphNeighbors({ clientId: 'c1', agentId: 'a1', layer: 'code', nodeId: 'file:b' }),
    );

    expect(loading.neighborsLoading).toBe(true);

    const merged = agentGraphsReducer(
      loading,
      expandAgentGraphNeighborsSuccess({
        key: envKey,
        document: documentFixture({
          nodes: [node('file:b'), node('file:c')],
          edges: [
            { from: 'file:b', to: 'file:c', type: 'imports' },
            { from: 'file:a', to: 'file:b', type: 'imports' },
          ],
        }),
      }),
    );

    expect(merged.neighborsLoading).toBe(false);
    expect(merged.document?.nodes.map((n) => n.id)).toEqual(['file:a', 'file:b', 'file:c']);
    expect(merged.document?.edges).toHaveLength(2);
    expect(merged.document?.totalNodes).toBe(3);
  });

  it('tracks status and overview per environment', () => {
    let state = agentGraphsReducer(initialAgentGraphsState, loadAgentGraphStatus({ clientId: 'c1', agentId: 'a1' }));

    state = agentGraphsReducer(
      state,
      loadAgentGraphStatusSuccess({ clientId: 'c1', agentId: 'a1', status: statusFixture() }),
    );
    expect(state.status?.status).toBe('ready');

    // A status of another environment (late poll) is dropped.
    state = agentGraphsReducer(
      state,
      loadAgentGraphStatusSuccess({ clientId: 'c1', agentId: 'a2', status: statusFixture({ status: 'failed' }) }),
    );
    expect(state.status?.status).toBe('ready');

    state = agentGraphsReducer(state, loadAgentGraphOverview({ clientId: 'c1', agentId: 'a1' }));

    const overview: AgentGraphOverview = {
      scope: 'environment',
      environmentId: 'a1',
      status: statusFixture({ status: 'stale' }),
      modules: [],
      hubs: [],
      communities: [],
      instructions: [],
    };

    state = agentGraphsReducer(state, loadAgentGraphOverviewSuccess({ clientId: 'c1', agentId: 'a1', overview }));
    expect(state.overview).toBe(overview);
    expect(state.status?.status).toBe('stale');
  });

  it('marks an environment as refreshing until polling finished', () => {
    let state = agentGraphsReducer(initialAgentGraphsState, loadAgentGraphStatus({ clientId: 'c1', agentId: 'a1' }));

    state = agentGraphsReducer(
      state,
      loadAgentGraphStatusSuccess({ clientId: 'c1', agentId: 'a1', status: statusFixture() }),
    );
    state = agentGraphsReducer(state, refreshAgentGraph({ clientId: 'c1', agentId: 'a1', layer: 'code' }));
    expect(state.refreshingKey).toBe('c1:a1');

    state = agentGraphsReducer(
      state,
      refreshAgentGraphSuccess({
        clientId: 'c1',
        agentId: 'a1',
        layer: 'code',
        response: { environmentId: 'a1', queued: true, status: 'building' },
      }),
    );
    expect(state.status?.status).toBe('building');

    state = agentGraphsReducer(state, agentGraphRefreshPollFinished({ clientId: 'c1', agentId: 'a1', status: null }));
    expect(state.refreshingKey).toBeNull();

    state = agentGraphsReducer(state, refreshAgentGraph({ clientId: 'c1', agentId: 'a1', layer: 'code' }));
    state = agentGraphsReducer(state, refreshAgentGraphFailure({ clientId: 'c1', agentId: 'a1', error: 'down' }));
    expect(state.refreshingKey).toBeNull();
    expect(state.error).toBe('down');
  });

  it('keeps the last loaded node detail only', () => {
    let state = agentGraphsReducer(
      initialAgentGraphsState,
      loadAgentGraphNodeDetail({ clientId: 'c1', agentId: 'a1', layer: 'code', nodeId: 'file:a' }),
    );

    expect(state.nodeDetailLoading).toBe(true);

    state = agentGraphsReducer(
      state,
      loadAgentGraphNodeDetailSuccess({
        key: agentGraphNodeDetailKey('c1', 'a1', 'code', 'file:a'),
        clientId: 'c1',
        agentId: 'a1',
        layer: 'code',
        detail: detailFixture('file:a'),
      }),
    );
    expect(state.nodeDetail?.nodeId).toBe('file:a');
    expect(state.nodeDetail?.environmentId).toBe('a1');

    // A response for a node that is no longer selected is ignored.
    state = agentGraphsReducer(
      state,
      loadAgentGraphNodeDetail({ clientId: 'c1', agentId: 'a1', layer: 'code', nodeId: 'file:b' }),
    );
    state = agentGraphsReducer(
      state,
      loadAgentGraphNodeDetailSuccess({
        key: agentGraphNodeDetailKey('c1', 'a1', 'code', 'file:a'),
        clientId: 'c1',
        agentId: 'a1',
        layer: 'code',
        detail: detailFixture('file:a'),
      }),
    );
    expect(state.nodeDetailLoading).toBe(true);

    state = agentGraphsReducer(state, clearAgentGraphNodeDetail());
    expect(state.nodeDetail).toBeNull();
    expect(state.nodeDetailKey).toBeNull();
  });

  it('stores references of the requested environment', () => {
    let state = agentGraphsReducer(
      initialAgentGraphsState,
      loadAgentGraphReferences({ clientId: 'c1', agentId: 'a1', promptId: 'p1' }),
    );

    state = agentGraphsReducer(
      state,
      loadAgentGraphReferencesSuccess({
        clientId: 'c1',
        agentId: 'a1',
        response: { environmentId: 'a1', prompts: [] },
      }),
    );
    expect(state.references?.environmentId).toBe('a1');
    expect(state.referencesLoading).toBe(false);
  });

  it('tracks workspace snapshot refreshes', () => {
    let state = agentGraphsReducer(
      initialAgentGraphsState,
      refreshWorkspaceGraphSnapshot({ clientId: 'c1', layer: 'knowledge' }),
    );

    expect(state.snapshotRefreshing).toBe(true);

    state = agentGraphsReducer(
      state,
      refreshWorkspaceGraphSnapshotSuccess({
        clientId: 'c1',
        status: { clientId: 'c1', status: 'ready', builtAt: null, error: null, nodes: 3, edges: 2 },
      }),
    );
    expect(state.snapshotRefreshing).toBe(false);
    expect(state.snapshotStatus?.nodes).toBe(3);
  });
});

describe('mergeAgentGraphDocuments', () => {
  it('returns the base document when nothing is new', () => {
    const base = documentFixture();

    expect(mergeAgentGraphDocuments(base, documentFixture())).toBe(base);
  });

  it('drops edges to nodes that are not part of the merged document', () => {
    const merged = mergeAgentGraphDocuments(
      documentFixture(),
      documentFixture({ nodes: [], edges: [{ from: 'file:a', to: 'file:x', type: 'imports' }] }),
    );

    expect(merged.edges).toHaveLength(1);
  });
});
