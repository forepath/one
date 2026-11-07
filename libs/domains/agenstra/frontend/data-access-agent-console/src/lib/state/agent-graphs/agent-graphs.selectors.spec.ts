import { initialAgentGraphsState, type AgentGraphsState } from './agent-graphs.reducer';
import {
  selectAgentGraphDocument,
  selectAgentGraphDocumentNodeTypes,
  selectAgentGraphRefreshing,
} from './agent-graphs.selectors';
import type { AgentGraphDocument } from './agent-graphs.types';

const document: AgentGraphDocument = {
  version: 1,
  scope: 'environment',
  layer: 'code',
  environmentId: 'a1',
  generatedAt: '2026-11-07T10:00:00.000Z',
  nodes: [
    { id: 'file:a', type: 'file', label: 'a' },
    { id: 'file:b', type: 'file', label: 'b' },
    { id: 'symbol:a#A', type: 'symbol', label: 'A' },
    { id: 'package:x', type: 'package', label: 'x' },
  ],
  edges: [],
  truncated: false,
  totalNodes: 4,
  totalEdges: 0,
};

describe('agent graphs selectors', () => {
  const state: { agentGraphs: AgentGraphsState } = {
    agentGraphs: {
      ...initialAgentGraphsState,
      document,
      documentKey: 'environment:c1:a1:code',
      refreshingKey: 'c1:a1',
    },
  };

  it('selects the current document', () => {
    expect(selectAgentGraphDocument(state)).toBe(document);
  });

  it('lists the node types of the document, most frequent first', () => {
    expect(selectAgentGraphDocumentNodeTypes(state)).toEqual([
      { type: 'file', count: 2 },
      { type: 'package', count: 1 },
      { type: 'symbol', count: 1 },
    ]);
    expect(selectAgentGraphDocumentNodeTypes({ agentGraphs: initialAgentGraphsState })).toEqual([]);
  });

  it('reports whether an environment is refreshing', () => {
    expect(selectAgentGraphRefreshing('c1', 'a1')(state)).toBe(true);
    expect(selectAgentGraphRefreshing('c1', 'a2')(state)).toBe(false);
  });
});
