import type {
  AgentGraphDocument,
  AgentGraphEdge,
  AgentGraphNode,
} from '@forepath/agenstra/shared/util-opencode-config';

import { GraphJobSlot, runGraphJob, type GraphJobResponse } from './graph-compute';
import {
  ForceEngine,
  buildTopology,
  groupCommunityArrays,
  neighborhoodMask,
  placeUnknownNodes,
  prepareLayout,
  seedStarPositions,
  type GraphTopologyInput,
} from './graph-engine';
import { buildSceneIndex, cellAt, forEachCellInRect, levelForZoom, type SceneIndex } from './graph-index';
import { ringExtent, seededRandom } from './graph-layout';
import { GraphModelBuilder, type GraphSnapshot } from './graph-model';
import { GraphRenderer, NODE_BUDGET, clipSegment, type GraphScene, type RenderState } from './graph-renderer';

function graphDocument(
  nodes: { id: string; type: string; label?: string; community?: number; attrs?: Record<string, unknown> }[],
  edges: { from: string; to: string; type?: string }[],
): AgentGraphDocument {
  return {
    version: 1,
    scope: 'environment',
    layer: 'all',
    generatedAt: '2026-11-08T00:00:00.000Z',
    nodes: nodes.map((node) => ({ label: node.id, ...node }) as AgentGraphNode),
    edges: edges.map((edge) => ({ type: 'imports', ...edge }) as AgentGraphEdge),
    truncated: false,
    totalNodes: nodes.length,
    totalEdges: edges.length,
  };
}

/** Hub (environment) with `count` members linked to it. */
function starDocument(hub: string, count: number, type = 'file'): AgentGraphDocument {
  const nodes = [{ id: hub, type: 'environment' }];
  const edges: { from: string; to: string }[] = [];

  for (let i = 0; i < count; i++) {
    nodes.push({ id: `${hub}/${type}:${i}`, type });
    edges.push({ from: hub, to: `${hub}/${type}:${i}` });
  }

  return graphDocument(nodes, edges);
}

function merge(a: AgentGraphDocument, b: AgentGraphDocument): AgentGraphDocument {
  return { ...a, nodes: [...a.nodes, ...b.nodes], edges: [...a.edges, ...b.edges] };
}

function snapshotOf(document: AgentGraphDocument): GraphSnapshot {
  const builder = new GraphModelBuilder();

  builder.update(document);

  return builder.snapshot();
}

function inputOf(snapshot: GraphSnapshot): GraphTopologyInput {
  return {
    count: snapshot.count,
    types: snapshot.types,
    typeNames: snapshot.typeNames,
    community: snapshot.community,
    edgeSource: snapshot.edgeSource,
    edgeTarget: snapshot.edgeTarget,
  };
}

/** Settled scene of a document (layout and index built inline). */
function sceneOf(document: AgentGraphDocument): GraphScene {
  const snapshot = snapshotOf(document);
  const input = inputOf(snapshot);
  const { topology, positions, engine } = prepareLayout({
    ...input,
    positions: new Float32Array(snapshot.count * 2),
    known: new Uint8Array(snapshot.count),
    knownCount: 0,
    seed: 1,
  });

  engine.run();

  return { snapshot, positions, topology, index: indexOf(snapshot, positions, topology, null) };
}

function indexOf(
  snapshot: GraphSnapshot,
  positions: Float32Array,
  topology: GraphScene['topology'],
  mask: Uint8Array | null,
): SceneIndex {
  return buildSceneIndex({
    count: snapshot.count,
    positions,
    mask,
    types: snapshot.types,
    typeTotal: snapshot.typeNames.length,
    degree: topology.degree,
    radius: topology.radius,
    edgeSource: snapshot.edgeSource,
    edgeTarget: snapshot.edgeTarget,
  });
}

/** Records canvas calls (jsdom has no 2D canvas). */
function recordingContext() {
  const calls: Record<string, number> = {};
  const texts: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_target, key: string) => {
        if (key === 'fillText') {
          return (text: string) => {
            texts.push(text);
            calls[key] = (calls[key] ?? 0) + 1;
          };
        }

        return () => {
          calls[key] = (calls[key] ?? 0) + 1;
        };
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;

  return { ctx, calls, texts };
}

function renderState(scene: GraphScene, overrides: Partial<RenderState> = {}): RenderState {
  return {
    index: scene.index,
    transform: { x: 400, y: 300, k: 1 },
    width: 800,
    height: 600,
    dpr: 1,
    palette: {
      background: '#fff',
      text: '#000',
      edge: '#888',
      emphasis: '#000',
      selection: '#00f',
      match: '#ff0',
      fallback: '#999',
      types: scene.snapshot.typeNames.map(() => '#123456'),
    },
    visible: null,
    focusActive: false,
    focusSize: 0,
    focus: null,
    selected: -1,
    hover: null,
    highlighted: [],
    showLabels: true,
    moved: [],
    movedMask: null,
    ...overrides,
  };
}

describe('graph model', () => {
  it('maps ids, types and edges and skips duplicates, dangling edges and self loops', () => {
    const snapshot = snapshotOf(
      graphDocument(
        [
          { id: 'a', type: 'file', community: 3 },
          { id: 'b', type: 'symbol', attrs: { missing: true } },
          { id: 'a', type: 'file' },
        ],
        [
          { from: 'a', to: 'b' },
          { from: 'a', to: 'a' },
          { from: 'a', to: 'missing' },
        ],
      ),
    );

    expect(snapshot.count).toBe(2);
    expect(snapshot.edgeCount).toBe(1);
    expect(snapshot.typeNames).toEqual(['file', 'symbol']);
    expect([...snapshot.community]).toEqual([3, -1]);
    expect([...snapshot.missing]).toEqual([0, 1]);
    expect(snapshot.indexOf('b')).toBe(1);
    expect(snapshot.indexOf('missing')).toBe(-1);
    expect(snapshot.nodes[0].id).toBe('a');
  });

  it('extends the model when a document appends to the previous one (pages) and rebuilds otherwise', () => {
    const builder = new GraphModelBuilder();
    const first = starDocument('env', 3);
    const second = merge(first, graphDocument([{ id: 'x', type: 'file' }], [{ from: 'env', to: 'x' }]));

    expect(builder.update(first)).toBe(false);

    const before = builder.snapshot();

    // Relabeled node objects with the same ids still extend.
    expect(builder.update({ ...second, nodes: second.nodes.map((node) => ({ ...node })) })).toBe(true);

    const after = builder.snapshot();

    expect(after.count).toBe(5);
    expect(after.edgeCount).toBe(4);
    expect(after.indexOf('x')).toBe(4);
    // Earlier snapshots stay valid views.
    expect(before.count).toBe(4);
    expect(before.indexOf('x')).toBe(-1);
    expect(builder.update(starDocument('other', 2))).toBe(false);
    expect(builder.snapshot().indexOf('env')).toBe(-1);
  });

  it('takes a document in resumable slices', () => {
    const builder = new GraphModelBuilder();
    const ingest = builder.begin(starDocument('env', 10_000));
    let steps = 0;

    while (!ingest.step(0)) {
      steps++;
    }

    expect(steps).toBeGreaterThan(1);
    expect(builder.snapshot().count).toBe(10_001);
    expect(builder.snapshot().edgeCount).toBe(10_000);
  });
});

describe('graph engine', () => {
  it('builds unique adjacency, degrees, incident edges and parallel edge offsets', () => {
    const snapshot = snapshotOf(
      graphDocument(
        [
          { id: 'a', type: 'file' },
          { id: 'b', type: 'file' },
          { id: 'c', type: 'file' },
        ],
        [
          { from: 'a', to: 'b', type: 'imports' },
          { from: 'b', to: 'a', type: 'depends_on' },
          { from: 'b', to: 'c' },
        ],
      ),
    );
    const topology = buildTopology(inputOf(snapshot));

    expect([...topology.degree]).toEqual([1, 2, 1]);
    expect([...topology.adjacency.subarray(topology.adjacencyStart[1], topology.adjacencyStart[2])].sort()).toEqual([
      0, 2,
    ]);
    expect([...topology.edgeOffset]).toEqual([-3, 3, 0]);
    expect(topology.incidentStart[2] - topology.incidentStart[1]).toBe(3);
    expect(topology.radius[1]).toBeGreaterThan(topology.radius[0]);
  });

  it('computes undirected neighborhoods as masks', () => {
    const snapshot = snapshotOf(
      graphDocument(
        ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'file' })),
        [
          { from: 'a', to: 'b' },
          { from: 'c', to: 'b' },
          { from: 'c', to: 'd' },
        ],
      ),
    );
    const topology = buildTopology(inputOf(snapshot));

    expect(neighborhoodMask(topology, 4, [0], 0).size).toBe(1);
    expect([...neighborhoodMask(topology, 4, [0], 1).mask]).toEqual([1, 1, 0, 0]);
    expect(neighborhoodMask(topology, 4, [0], 3).size).toBe(4);
  });

  it('groups by community ids when present, else around hub types', () => {
    const communities = snapshotOf(
      graphDocument(
        [
          ...['a1', 'a2', 'a3'].map((id) => ({ id, type: 'file', community: 1 })),
          ...['b1', 'b2', 'b3', 'b4'].map((id) => ({ id, type: 'file', community: 2 })),
          { id: 'loose', type: 'file' },
        ],
        [{ from: 'a1', to: 'a2' }],
      ),
    );
    const byCommunity = groupCommunityArrays(inputOf(communities), buildTopology(inputOf(communities)));

    expect(byCommunity.map((group) => group.members.length).sort()).toEqual([1, 3, 4]);
    expect(byCommunity.find((group) => group.members.length === 1)?.hub).toBe(-1);

    const hubs = snapshotOf(merge(starDocument('env:1', 5), starDocument('env:2', 4)));
    const byHub = groupCommunityArrays(inputOf(hubs), buildTopology(inputOf(hubs)));

    expect(byHub.map((group) => hubs.ids[group.hub]).sort()).toEqual(['env:1', 'env:2']);
    expect(byHub.reduce((sum, group) => sum + group.members.length, 0)).toBe(hubs.count);
  });

  it('seeds stars deterministically and keeps groups apart', () => {
    const snapshot = snapshotOf(merge(starDocument('env:1', 30), starDocument('env:2', 30)));
    const input = inputOf(snapshot);
    const topology = buildTopology(input);
    const a = new Float32Array(snapshot.count * 2);
    const b = new Float32Array(snapshot.count * 2);
    const hubs = seedStarPositions(input, topology, a, seededRandom(7));

    seedStarPositions(input, topology, b, seededRandom(7));

    expect([...a]).toEqual([...b]);
    expect(hubs).toHaveLength(2);
    expect(Math.hypot(a[hubs[0] * 2] - a[hubs[1] * 2], a[hubs[0] * 2 + 1] - a[hubs[1] * 2 + 1])).toBeGreaterThanOrEqual(
      2 * ringExtent(30) - 1,
    );
  });

  it('settles a force layout in steps and keeps pinned nodes in place', () => {
    const snapshot = snapshotOf(starDocument('env', 600));
    const input = inputOf(snapshot);
    const topology = buildTopology(input);
    const positions = new Float32Array(snapshot.count * 2);
    const hubs = seedStarPositions(input, topology, positions, seededRandom(1));
    const hub = [positions[hubs[0] * 2], positions[hubs[0] * 2 + 1]];
    const engine = new ForceEngine(positions, topology.radius, topology, { iterations: 30, pinned: hubs });

    expect(engine.step(10)).toBe(false);
    expect(engine.progress).toBeCloseTo(1 / 3);

    engine.run();

    expect(engine.done).toBe(true);
    expect([positions[hubs[0] * 2], positions[hubs[0] * 2 + 1]]).toEqual(hub);
    expect([...positions].every(Number.isFinite)).toBe(true);
  });

  it('keeps known positions and places new nodes next to a known neighbor', () => {
    const snapshot = snapshotOf(
      graphDocument(
        [
          { id: 'a', type: 'file' },
          { id: 'b', type: 'file' },
        ],
        [{ from: 'a', to: 'b' }],
      ),
    );
    const topology = buildTopology(inputOf(snapshot));
    const positions = new Float32Array([500, 500, 0, 0]);

    placeUnknownNodes(2, topology, positions, new Uint8Array([1, 0]), seededRandom(2));

    expect([positions[0], positions[1]]).toEqual([500, 500]);
    expect(Math.hypot(positions[2] - 500, positions[3] - 500)).toBeLessThanOrEqual(70);
  });

  it('settles incrementally when most positions are known', () => {
    const snapshot = snapshotOf(starDocument('env', 20));
    const known = new Uint8Array(snapshot.count).fill(1);
    const positions = new Float32Array(snapshot.count * 2).map((_, i) => i * 10);
    const layout = prepareLayout({ ...inputOf(snapshot), positions, known, knownCount: snapshot.count, seed: 1 });

    expect(layout.fresh).toBe(false);
    expect(layout.engine.iterations).toBe(40);
    expect(layout.positions[2]).toBe(20);
  });
});

describe('graph index', () => {
  const scene = sceneOf(merge(starDocument('env:1', 300), starDocument('env:2', 200, 'symbol')));
  const { index, snapshot } = scene;

  it('keeps exact counts and type compositions on every level', () => {
    for (const level of index.levels) {
      let total = 0;
      let types = 0;

      level.count.forEach((count) => (total += count));
      level.typeCount.forEach((count) => (types += count));
      expect(total).toBe(snapshot.count);
      expect(types).toBe(snapshot.count);
    }

    const top = index.levels[index.levels.length - 1];

    expect(top.cells).toHaveLength(1);
    expect(snapshot.typeNames[top.typeCode[0]]).toBe('file');
    expect(top.typeCount[0]).toBe(300);
    expect(snapshot.ids[top.rep[0]]).toBe('env:1');
  });

  it('aggregates edges between cells with weights', () => {
    for (const level of index.levels) {
      let weight = 0;

      level.edgeWeight?.forEach((value) => (weight += value));
      // Both directions are stored; edges inside one cell are not drawn.
      expect(weight / 2).toBeLessThanOrEqual(snapshot.edgeCount);
    }

    const finest = index.levels[0];
    let weight = 0;

    finest.edgeWeight?.forEach((value) => (weight += value));
    expect(weight).toBeGreaterThan(0);
  });

  it('visits only the cells in a rectangle and finds the cell of a point', () => {
    const level = index.levels[0];
    const x = index.order.length ? scene.positions[index.order[0] * 2] : 0;
    const y = index.order.length ? scene.positions[index.order[0] * 2 + 1] : 0;
    const cell = cellAt(index, level, x, y);
    const visited: number[] = [];

    expect(cell).toBeGreaterThanOrEqual(0);
    forEachCellInRect(index, level, x, y, x, y, (c) => {
      visited.push(c);
    });
    expect(visited).toEqual([cell]);

    let all = 0;

    forEachCellInRect(index, level, -1e9, -1e9, 1e9, 1e9, () => {
      all++;
    });
    expect(all).toBe(level.cells.length);
  });

  it('picks the level whose cells are wide enough on screen', () => {
    expect(levelForZoom(index, 1, 12)?.level).toBe(0);
    expect(levelForZoom(index, 0.01, 12)?.level).toBeGreaterThan(0);
  });

  it('indexes only the masked subset', () => {
    const mask = new Uint8Array(snapshot.count);

    mask[0] = 1;
    mask[1] = 1;

    const subset = indexOf(snapshot, scene.positions, scene.topology, mask);

    expect(subset.order).toHaveLength(2);
    expect(subset.edgeCount).toBe(1);
    expect(indexOf(snapshot, scene.positions, scene.topology, new Uint8Array(snapshot.count)).levels).toEqual([]);
  });
});

describe('graph renderer', () => {
  it('clips segments to the viewport', () => {
    const out = new Float64Array(4);

    expect(clipSegment(-100, 50, 200, 50, 0, 0, 100, 100, out)).toBe(true);
    expect([...out]).toEqual([0, 50, 100, 50]);
    expect(clipSegment(-100, -50, 200, -50, 0, 0, 100, 100, out)).toBe(false);
  });

  it('draws individual nodes, edges and labels when few are in view', () => {
    const scene = sceneOf(starDocument('env', 40));
    const renderer = new GraphRenderer(false);
    const { ctx, texts } = recordingContext();
    const frame = renderer.draw(ctx, scene, renderState(scene, { transform: { x: 400, y: 300, k: 1 } }));

    expect(frame.mode).toBe('detail');
    expect(frame.nodes).toBe(41);
    expect(frame.edges).toBe(40);
    expect(texts).toContain('env');
  });

  it('switches to the overview with exact counts when too many nodes are in view', () => {
    const scene = sceneOf(starDocument('env', NODE_BUDGET * 1.5));
    const renderer = new GraphRenderer(false);
    const { ctx } = recordingContext();
    const state = renderState(scene, { transform: { x: 400, y: 300, k: 0.02 } });
    const frame = renderer.draw(ctx, scene, state);

    expect(frame.mode).toBe('overview');
    expect(frame.cells).toBeGreaterThan(0);
    expect(frame.cells).toBeLessThan(scene.snapshot.count);

    // Panning at the same zoom keeps the mode; hovering a cell summarizes it.
    expect(renderer.draw(ctx, scene, { ...state, transform: { x: 410, y: 300, k: 0.02 } }).mode).toBe('overview');

    const level = scene.index.levels[frame.level];
    const cell = level.count.indexOf(Math.max(...level.count));
    const target = renderer.hitTest(scene, state, level.cx[cell] * 0.02 + 400, level.cy[cell] * 0.02 + 300);

    expect(target).toEqual({ kind: 'cell', level: frame.level, cell });

    const summary = renderer.cellSummary(scene.snapshot, scene.index, frame.level, cell);

    expect(summary.count).toBe(level.count[cell]);
    expect(summary.types.reduce((sum, entry) => sum + entry.count, 0)).toBe(summary.count);
  }, 60_000);

  it('hit-tests nodes in screen pixels and respects the drawn subset', () => {
    const scene = sceneOf(starDocument('env', 10));
    const renderer = new GraphRenderer(false);
    const state = renderState(scene);
    const { ctx } = recordingContext();

    renderer.draw(ctx, scene, state);

    const hub = scene.snapshot.indexOf('env');
    const sx = scene.positions[hub * 2] + 400;
    const sy = scene.positions[hub * 2 + 1] + 300;

    expect(renderer.hitTest(scene, state, sx + 1, sy)).toEqual({ kind: 'node', index: hub });
    expect(renderer.hitTest(scene, state, sx + 300, sy + 300)).toBeNull();

    const visible = new Uint8Array(scene.snapshot.count).fill(1);

    visible[hub] = 0;
    expect(renderer.hitTest(scene, { ...state, visible }, sx + 1, sy)?.kind === 'node' && hub).toBeFalsy();
  });

  it('thins edges only while the view moves; a resting view is always drawn complete', () => {
    const scene = sceneOf(starDocument('env', 3000));
    const renderer = new GraphRenderer(true);
    const { ctx } = recordingContext();
    const at = (x: number) => renderState(scene, { transform: { x, y: 300, k: 0.2 } });
    const complete = renderer.draw(ctx, scene, at(400), 0);

    // Slow frames while panning reduce the budgets (never the grouping).
    for (let i = 1; i <= 8; i++) {
      renderer.draw(ctx, scene, at(400 + i), 2000);
    }

    expect(renderer.budgetScale).toBeLessThan(1);

    const moving = renderer.draw(ctx, scene, at(420), 2000);

    expect(moving.mode).toBe(complete.mode);
    expect(moving.nodes).toBe(complete.nodes);

    // The same view again (selection, hover, new data): complete, whatever the latency.
    const resting = renderer.draw(ctx, scene, at(420), 2000);
    const again = renderer.draw(ctx, scene, at(420), 2000);

    expect(resting.edges).toBe(complete.edges);
    expect(again.edges).toBe(resting.edges);
    expect(resting.budgetScale).toBeGreaterThanOrEqual(1);
  });

  it('draws the hover on the overlay only', () => {
    const scene = sceneOf(starDocument('env', 10));
    const renderer = new GraphRenderer(false);
    const base = recordingContext();
    const overlay = recordingContext();
    const hub = scene.snapshot.indexOf('env');
    const state = renderState(scene, { hover: { kind: 'node', index: hub } });

    renderer.draw(base.ctx, scene, state);
    expect(base.texts.filter((text) => text === 'env')).toHaveLength(1);

    const baseCalls = { ...base.calls };

    renderer.drawOverlay(overlay.ctx, scene, state);

    expect(base.calls).toEqual(baseCalls);
    expect(overlay.calls['clearRect']).toBe(1);
    expect(overlay.calls['stroke']).toBeGreaterThan(0);
    expect(overlay.texts).toEqual(['env']);

    renderer.drawOverlay(overlay.ctx, scene, { ...state, hover: null });
    expect(overlay.calls['clearRect']).toBe(2);
    expect(overlay.texts).toEqual(['env']);
  });
});

describe('graph jobs', () => {
  const snapshot = snapshotOf(starDocument('env', 50));
  const layoutRequest = {
    kind: 'layout' as const,
    input: {
      ...inputOf(snapshot),
      positions: new Float32Array(snapshot.count * 2),
      known: new Uint8Array(snapshot.count),
      knownCount: 0,
      seed: 3,
    },
    mask: null,
  };

  it('runs a layout job to positions, topology and index', async () => {
    const responses: GraphJobResponse[] = [];

    await runGraphJob({ ...layoutRequest, job: 1 }, (response) => responses.push(response));

    const result = responses.find((response) => response.kind === 'layout');

    expect(result && result.kind === 'layout' && result.positions.length).toBe(snapshot.count * 2);
    expect(result && result.kind === 'layout' && result.index.order.length).toBe(snapshot.count);
  });

  it('runs jobs inline without workers; a newer job supersedes a running one', async () => {
    const responses: GraphJobResponse[] = [];
    const slot = new GraphJobSlot(null, (response) => responses.push(response));
    const first = slot.run(layoutRequest);
    const second = slot.run(layoutRequest);

    expect(slot.busy).toBe(true);

    await new Promise<void>((resolve) => {
      const check = () => (slot.busy ? setTimeout(check, 5) : resolve());

      check();
    });

    expect(second).toBe(first + 1);
    expect(responses.every((response) => response.job === second)).toBe(true);
    expect(responses.some((response) => response.kind === 'layout')).toBe(true);
    slot.destroy();
  });
});
