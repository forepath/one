import {
  ForceLayout,
  applyCachedPositions,
  buildLayoutModel,
  computeBounds,
  defaultIterations,
  findNodeAt,
  fitTransform,
  groupCommunities,
  hashSeed,
  matchNodes,
  neighborhood,
  ringExtent,
  screenToWorld,
  seedCommunityStars,
  seededRandom,
  zoomAt,
  type GraphLayoutInputEdge,
  type GraphLayoutInputNode,
} from './graph-layout';

function star(
  hub: string,
  count: number,
  type = 'file',
): { nodes: GraphLayoutInputNode[]; edges: GraphLayoutInputEdge[] } {
  const nodes: GraphLayoutInputNode[] = [{ id: hub, type: 'environment', label: hub }];
  const edges: GraphLayoutInputEdge[] = [];

  for (let i = 0; i < count; i++) {
    const id = `${hub}/${type}:${i}`;

    nodes.push({ id, type, label: `${type} ${i}` });
    edges.push({ from: hub, to: id, type: 'contains' });
  }

  return { nodes, edges };
}

describe('graph layout', () => {
  it('builds indices, adjacency and degrees and skips dangling edges / self loops', () => {
    const model = buildLayoutModel(
      [
        { id: 'a', type: 'file' },
        { id: 'b', type: 'file' },
        { id: 'a', type: 'file' },
      ],
      [
        { from: 'a', to: 'b', type: 'imports' },
        { from: 'a', to: 'b', type: 'depends_on' },
        { from: 'a', to: 'a', type: 'imports' },
        { from: 'a', to: 'missing', type: 'imports' },
      ],
    );

    expect(model.nodes).toHaveLength(2);
    expect(model.links).toHaveLength(2);
    expect(model.adjacency[0]).toEqual([1]);
    expect(model.nodes[0].degree).toBe(1);
    // Parallel edges get opposite draw offsets.
    expect(model.links.map((link) => link.offset)).toEqual([-3, 3]);
  });

  it('caps the number of links', () => {
    const { nodes, edges } = star('env', 20);

    expect(buildLayoutModel(nodes, edges, { maxLinks: 5 }).links).toHaveLength(5);
  });

  it('computes undirected neighborhoods', () => {
    const model = buildLayoutModel(
      ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'file' })),
      [
        { from: 'a', to: 'b', type: 'imports' },
        { from: 'c', to: 'b', type: 'imports' },
        { from: 'c', to: 'd', type: 'imports' },
      ],
    );

    expect([...neighborhood(model.adjacency, [0], 0)]).toEqual([0]);
    expect([...neighborhood(model.adjacency, [0], 1)].sort()).toEqual([0, 1]);
    expect([...neighborhood(model.adjacency, [0], 3)].sort()).toEqual([0, 1, 2, 3]);
  });

  it('groups by community ids when the document has them', () => {
    const nodes: GraphLayoutInputNode[] = [
      ...['a1', 'a2', 'a3'].map((id) => ({ id, type: 'file', community: 1 })),
      ...['b1', 'b2', 'b3', 'b4'].map((id) => ({ id, type: 'file', community: 2 })),
      { id: 'loose', type: 'file' },
    ];
    const model = buildLayoutModel(nodes, [{ from: 'a1', to: 'a2', type: 'imports' }]);
    const groups = groupCommunities(model);

    expect(groups.map((group) => group.members.length).sort()).toEqual([1, 3, 4]);
    expect(groups.find((group) => group.members.length === 1)?.hub).toBe(-1);
    expect(groups.find((group) => group.members.length === 3)?.hub).toBe(model.indexById.get('a1'));
  });

  it('groups around hub types without community ids', () => {
    const first = star('env:1', 5);
    const second = star('env:2', 4);
    const model = buildLayoutModel([...first.nodes, ...second.nodes], [...first.edges, ...second.edges]);
    const groups = groupCommunities(model);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => model.nodes[group.hub].id).sort()).toEqual(['env:1', 'env:2']);
    expect(groups.reduce((sum, group) => sum + group.members.length, 0)).toBe(model.nodes.length);
  });

  it('seeds stars deterministically and keeps groups apart', () => {
    const first = star('env:1', 30);
    const second = star('env:2', 30);
    const build = () => buildLayoutModel([...first.nodes, ...second.nodes], [...first.edges, ...second.edges]);
    const a = build();
    const b = build();
    const hubsA = seedCommunityStars(a, seededRandom(7));

    seedCommunityStars(b, seededRandom(7));

    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]));
    expect(hubsA).toHaveLength(2);

    const [hub1, hub2] = hubsA.map((index) => a.nodes[index]);
    const distance = Math.hypot(hub1.x - hub2.x, hub1.y - hub2.y);

    expect(distance).toBeGreaterThanOrEqual(2 * ringExtent(30));
  });

  it('settles a force layout in steps, keeps pinned hubs and releases them at the end', () => {
    const { nodes, edges } = star('env', 40);
    const model = buildLayoutModel(nodes, edges);
    const random = seededRandom(1);
    const hubs = seedCommunityStars(model, random);
    const hub = model.nodes[hubs[0]];
    const hubPosition = { x: hub.x, y: hub.y };
    const layout = new ForceLayout(model, { iterations: 30, pinned: hubs, random });

    expect(hub.fixed).toBe(true);
    expect(layout.step(10)).toBe(false);
    expect(layout.progress).toBeCloseTo(1 / 3);
    expect({ x: hub.x, y: hub.y }).toEqual(hubPosition);

    layout.run();

    expect(layout.done).toBe(true);
    expect(hub.fixed).toBe(false);
    expect(model.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
  });

  it('uses grid-bucketed repulsion for large graphs without producing NaN', () => {
    const { nodes, edges } = star('env', 600);
    const model = buildLayoutModel(nodes, edges);
    const random = seededRandom(3);

    new ForceLayout(model, { iterations: 5, pinned: seedCommunityStars(model, random), random }).run();

    expect(model.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
  });

  it('scales the iteration budget down for large graphs', () => {
    expect(defaultIterations(100)).toBeGreaterThan(defaultIterations(1000));
    expect(defaultIterations(1000)).toBeGreaterThan(defaultIterations(6000));
  });

  it('reuses cached positions and places new nodes next to a known neighbor', () => {
    const model = buildLayoutModel(
      [
        { id: 'a', type: 'file' },
        { id: 'b', type: 'file' },
      ],
      [{ from: 'a', to: 'b', type: 'imports' }],
    );
    const reused = applyCachedPositions(model, new Map([['a', { x: 500, y: 500 }]]), seededRandom(2));

    expect(reused).toBe(1);
    expect(model.nodes[0]).toMatchObject({ x: 500, y: 500 });
    expect(Math.hypot(model.nodes[1].x - 500, model.nodes[1].y - 500)).toBeLessThanOrEqual(70);
  });

  it('fits bounds into the viewport and zooms around a point', () => {
    const model = buildLayoutModel(
      [
        { id: 'a', type: 'file' },
        { id: 'b', type: 'file' },
      ],
      [],
    );

    model.nodes[0].x = -100;
    model.nodes[1].x = 100;

    const bounds = computeBounds(model.nodes);
    const transform = fitTransform(bounds, 400, 300, { padding: 0 });

    expect(transform.k).toBeCloseTo(400 / (200 + 2 * model.nodes[0].radius));
    expect(transform.x).toBeCloseTo(200);

    const zoomed = zoomAt(transform, 50, 60, 2);
    const before = screenToWorld(transform, 50, 60);
    const after = screenToWorld(zoomed, 50, 60);

    expect(zoomed.k).toBeCloseTo(transform.k * 2);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(computeBounds(model.nodes, () => false)).toBeNull();
    expect(fitTransform(null, 400, 300)).toEqual({ x: 200, y: 150, k: 1 });
  });

  it('hit-tests in screen pixels and respects visibility', () => {
    const model = buildLayoutModel(
      [
        { id: 'a', type: 'file' },
        { id: 'b', type: 'symbol' },
      ],
      [],
    );

    model.nodes[1].x = 100;

    const transform = { x: 0, y: 0, k: 1 };

    expect(findNodeAt(model.nodes, transform, 2, 1)).toBe(0);
    expect(findNodeAt(model.nodes, transform, 101, 0)).toBe(1);
    expect(findNodeAt(model.nodes, transform, 50, 50)).toBe(-1);
    expect(findNodeAt(model.nodes, transform, 101, 0, (node) => node.type !== 'symbol')).toBe(-1);
  });

  it('matches nodes by label prefix first, then label, path and id', () => {
    const nodes: GraphLayoutInputNode[] = [
      { id: 'file:src/user-auth.ts', type: 'file', label: 'user-auth.ts', path: 'src/user-auth.ts' },
      { id: 'symbol:x#AuthService', type: 'symbol', label: 'AuthService' },
      { id: 'file:src/a.ts', type: 'file', label: 'a.ts', path: 'src/auth/a.ts' },
      { id: 'file:src/b.ts', type: 'file', label: 'b.ts' },
    ];

    expect(matchNodes(nodes, ' auth ')).toEqual(['symbol:x#AuthService', 'file:src/user-auth.ts', 'file:src/a.ts']);
    expect(matchNodes(nodes, 'auth', 1)).toEqual(['symbol:x#AuthService']);
    expect(matchNodes(nodes, '')).toEqual([]);
  });

  it('produces stable seeds and pseudo random numbers', () => {
    expect(hashSeed(['a', 'b'])).toBe(hashSeed(['a', 'b']));
    expect(hashSeed(['a', 'b'])).not.toBe(hashSeed(['b', 'a']));

    const random = seededRandom(42);
    const values = [random(), random(), random()];

    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(seededRandom(42)()).toBe(values[0]);
  });
});
