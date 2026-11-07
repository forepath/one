import { mergeAgentGraphParts, pageAgentGraph, type AgentGraphEdge, type AgentGraphNode } from './graph-platform';

const node = (id: string, type: AgentGraphNode['type'] = 'file'): AgentGraphNode => ({ id, type, label: id });

describe('pageAgentGraph', () => {
  const nodes = [node('a'), node('b'), node('c'), node('env', 'environment'), node('d')];
  const edges: AgentGraphEdge[] = [
    { from: 'env', to: 'a', type: 'contains' },
    { from: 'a', to: 'b', type: 'imports' },
    { from: 'a', to: 'c', type: 'imports' },
    { from: 'c', to: 'd', type: 'imports' },
  ];

  it('ranks anchors first, then by degree, and pages without losing or repeating edges', () => {
    const first = pageAgentGraph(nodes, edges, 0, 2);
    const second = pageAgentGraph(nodes, edges, 2, 2);
    const third = pageAgentGraph(nodes, edges, 4, 2);

    expect(first.nodes.map((n) => n.id)).toEqual(['env', 'a']);
    expect(first.nextOffset).toBe(2);
    expect(third.nextOffset).toBeNull();
    expect(first.total).toBe(5);

    const all = [...first.edges, ...second.edges, ...third.edges];

    expect(all).toHaveLength(edges.length);
    expect(new Set(all.map((e) => `${e.from}>${e.to}`)).size).toBe(edges.length);
    // Every page only references nodes of the pages loaded so far.
    const loaded = new Set([...first.nodes, ...second.nodes].map((n) => n.id));

    expect(second.edges.every((e) => loaded.has(e.from) && loaded.has(e.to))).toBe(true);
  });

  it('filters by node type', () => {
    const page = pageAgentGraph(nodes, edges, 0, 10, new Set(['environment']));

    expect(page.nodes.map((n) => n.id)).toEqual(['env']);
    expect(page.edges).toEqual([]);
  });
});

describe('mergeAgentGraphParts', () => {
  it('merges nodes by id (attributes combined) and deduplicates edges', () => {
    const merged = mergeAgentGraphParts([
      { nodes: [{ ...node('a'), attrs: { size: 1 } }], edges: [{ from: 'a', to: 'b', type: 'imports' }] },
      {
        nodes: [{ ...node('a'), attrs: { language: 'ts' } }, node('b')],
        edges: [{ from: 'a', to: 'b', type: 'imports' }],
      },
    ]);

    expect(merged.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(merged.nodes[0].attrs).toEqual({ size: 1, language: 'ts' });
    expect(merged.edges).toHaveLength(1);
  });
});
