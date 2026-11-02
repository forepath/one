import {
  bundleEdges,
  nearestVisible,
  workspaceLayout,
  workspaceLayoutKey,
  workspacePositions,
  workspaceVisibleItems,
  workspaceZoomLevel,
  type WorkspaceBox,
} from './workspace-layout';
import { workspaceModel, type WorkspaceModel } from './workspace-model';
import { WS_GRAPH, WS_RESOURCES } from './workspace-testing';

/** Index pairs of boxes that overlap. */
function overlaps(boxes: readonly WorkspaceBox[]): [number, number][] {
  const out: [number, number][] = [];

  boxes.forEach((p, i) =>
    boxes.forEach((q, j) => {
      if (j > i && p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height)
        out.push([i, j]);
    }),
  );

  return out;
}

describe('workspace layout (3.36)', () => {
  const model = workspaceModel(WS_GRAPH, WS_RESOURCES);

  it('maps zoom to semantic levels', () => {
    expect([0.1, 0.3, 0.8, 2].map(workspaceZoomLevel)).toEqual([0, 1, 2, 3]);
  });

  it('instantiates only the level’s kinds; kept items bring their ancestors', () => {
    const l0 = workspaceVisibleItems(model, 0);

    expect([...l0].sort()).toEqual(['external:0.0.0.0/0', 'hostname:shop.example.com', 'site:a', 'site:b', 'site:c']);
    expect(workspaceVisibleItems(model, 2).has('replica:shop/site/web/0')).toBe(false);
    expect(workspaceVisibleItems(model, 3).has('replica:shop/site/web/0')).toBe(true);

    const kept = workspaceVisibleItems(model, 0, ['replica:shop/site/web/0']);

    expect(kept.has('stack:shop/site/web@n1') && kept.has('node:n1') && kept.has('replica:shop/site/web/0')).toBe(true);
  });

  it('bundles edges onto the nearest visible ancestor and adds up flow rates', () => {
    const visible = workspaceVisibleItems(model, 1);
    const edges = bundleEdges(model, visible);
    const flows = edges.filter((e) => e.kind === 'flow');

    expect(flows).toEqual([
      expect.objectContaining({
        source: 'node:n1',
        target: 'node:n3',
        count: 2,
        data: expect.objectContaining({ bytesPerSecond: 150 }),
      }),
    ]);
    expect(edges.find((e) => e.kind === 'tunnel')).toMatchObject({ id: 'tunnel:n1|n3', count: 1 });
    expect(nearestVisible(model, visible, 'replica:shop/site/web/1')).toBe('node:n2');
    // Far out: site to site; edges inside one visible item are dropped.
    expect(bundleEdges(model, workspaceVisibleItems(model, 0)).filter((e) => e.kind === 'flow')).toEqual([
      expect.objectContaining({ source: 'site:a', target: 'site:b', count: 2 }),
    ]);
    expect(
      bundleEdges(model, workspaceVisibleItems(model, 0), [
        { id: 'x', kind: 'flow', layer: 'policies', source: 'node:n1', target: 'node:n2', data: {} },
      ]),
    ).toEqual([]);
  });

  it('is deterministic and nests children inside their parents', () => {
    const visible = workspaceVisibleItems(model, 3);
    const a = workspaceLayout(model, visible);
    const b = workspaceLayout(workspaceModel(WS_GRAPH, [...WS_RESOURCES].reverse()), visible);

    expect([...a.entries()]).toEqual(
      [...b.entries()].sort((x, y) => [...a.keys()].indexOf(x[0]) - [...a.keys()].indexOf(y[0])),
    );

    const inside = (child: string, parent: string) => {
      const c = a.get(child) as WorkspaceBox;
      const p = a.get(parent) as WorkspaceBox;

      return c.x >= p.x && c.y >= p.y && c.x + c.width <= p.x + p.width && c.y + c.height <= p.y + p.height;
    };

    expect(inside('node:n1', 'site:a')).toBe(true);
    expect(inside('stack:shop/site/web@n1', 'node:n1')).toBe(true);
    expect(inside('replica:shop/site/web/2', 'stack:shop/site/web@n1')).toBe(true);
    expect(inside('vm:shop/db1', 'node:n3')).toBe(true);
    // Sites don't overlap.
    expect(overlaps(['site:a', 'site:b', 'site:c'].map((id) => a.get(id) as WorkspaceBox))).toEqual([]);

    const positions = workspacePositions(model, a, visible);

    expect(positions['replica:shop/site/web/0']).toBeDefined();
    expect(positions['site:a']).toBeUndefined();
    expect(positions['site:c']).toBeDefined();
  });

  describe('sites as a star around the centre (2026-10-29)', () => {
    /** `nodes[i]` nodes in site `s<i>`, listed in reverse to prove the order comes from the names. */
    const star = (nodes: readonly number[]) => {
      const elements: typeof WS_GRAPH.elements = [];

      nodes.forEach((count, s) => {
        elements.push({ id: `site:s${s}`, kind: 'site', label: `s${s}`, data: {} });

        for (let n = 0; n < count; n++)
          elements.push({ id: `node:s${s}n${n}`, kind: 'node', label: `n${n}`, parent: `site:s${s}`, data: {} });
      });

      return workspaceModel({ elements: elements.reverse(), edges: [] }, []);
    };
    const sites = (m: WorkspaceModel, aspect?: number) => {
      const boxes = workspaceLayout(m, workspaceVisibleItems(m, 3), aspect);

      return m.items
        .filter((i) => i.kind === 'site')
        .sort((x, y) => x.label.localeCompare(y.label))
        .map((i) => boxes.get(i.id) as WorkspaceBox);
    };
    const centre = (b: WorkspaceBox) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    const mean = (boxes: WorkspaceBox[]) => ({
      x: boxes.reduce((sum, b) => sum + centre(b).x, 0) / boxes.length,
      y: boxes.reduce((sum, b) => sum + centre(b).y, 0) / boxes.length,
    });

    it('centres a single site', () => {
      const [only] = sites(star([3]));

      expect(only.x).toBe(0);
      expect(only.y).toBe(0);
    });

    it('puts two sites left and right of the centre', () => {
      const [s0, s1] = sites(star([2, 9]));

      expect(centre(s0).y).toBe(centre(s1).y);
      expect(s0.x + s0.width).toBeLessThan(s1.x);
    });

    it('spaces n sites evenly around the centre by name, from the top clockwise, without overlaps', () => {
      // One site with many nodes: the radius follows the largest box.
      const boxes = sites(star([1, 2, 40, 3, 1, 5, 2]));
      const middle = mean(boxes);

      expect(overlaps(boxes)).toEqual([]);
      // s0 at the top, s1 to its right (clockwise).
      expect(Math.min(...boxes.map((b) => centre(b).y))).toBe(centre(boxes[0]).y);
      expect(centre(boxes[0]).x).toBeCloseTo(middle.x, 0);
      expect(centre(boxes[1]).x).toBeGreaterThan(middle.x);
      // Evenly on one ellipse: (dx / a)² + (dy / b)² is the same for every site.
      const a = Math.max(...boxes.map((b) => Math.abs(centre(b).x - middle.x))) || 1;
      const quarter = boxes.map((b) => centre(b)).find((c) => Math.abs(c.x - middle.x) < 1) ?? centre(boxes[0]);
      const b = Math.abs(quarter.y - middle.y);

      for (const box of boxes) {
        const c = centre(box);

        expect(((c.x - middle.x) / a) ** 2 + ((c.y - middle.y) / b) ** 2).toBeLessThan(1.05);
      }
    });

    it('never overlaps for 2 … 24 sites of mixed sizes and any aspect', () => {
      for (let n = 2; n <= 24; n++)
        for (const aspect of [0.5, 1, 1.6, 3]) {
          const boxes = sites(star(Array.from({ length: n }, (_, i) => (i * 7) % 11)), aspect);

          expect({ n, aspect, overlaps: overlaps(boxes) }).toEqual({ n, aspect, overlaps: [] });
        }
    });

    it('stretches the star towards the viewport aspect and stays deterministic', () => {
      const m = star([2, 2, 2, 2, 2, 2]);
      const bounds = (boxes: WorkspaceBox[]) =>
        (Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x))) /
        (Math.max(...boxes.map((b) => b.y + b.height)) - Math.min(...boxes.map((b) => b.y)));

      expect(bounds(sites(m, 2.5))).toBeGreaterThan(bounds(sites(m, 0.6)));
      expect(bounds(sites(m, 2.5))).toBeGreaterThan(1.5);
      expect(sites(m)).toEqual(sites(star([2, 2, 2, 2, 2, 2])));
    });

    describe('ring order by links (few crossings)', () => {
      /** `n` sites with one node each, linked by `links` (site index pairs, via their nodes). */
      const linked = (n: number, links: readonly [number, number][]) =>
        workspaceModel(
          {
            elements: Array.from({ length: n }, (_, s) => [
              { id: `site:s${s}`, kind: 'site', label: `s${s}`, data: {} },
              { id: `node:s${s}n0`, kind: 'node', label: 'n0', parent: `site:s${s}`, data: {} },
            ]).flat(),
            edges: links.map(([a, b], i) => ({
              id: `tunnel:${i}`,
              kind: 'tunnel',
              source: `node:s${a}n0`,
              target: `node:s${b}n0`,
              layer: 'tunnels',
              data: {},
            })),
          },
          [],
        );
      /** Proper intersections of the straight site-to-site segments (shared ends don't count). */
      const crossings = (boxes: readonly WorkspaceBox[], links: readonly [number, number][]) => {
        const c = boxes.map(centre);
        const side = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
          Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
        let count = 0;

        links.forEach(([a, b], i) =>
          links.slice(i + 1).forEach(([d, e]) => {
            if (new Set([a, b, d, e]).size < 4) return;
            if (
              side(c[a], c[b], c[d]) * side(c[a], c[b], c[e]) < 0 &&
              side(c[d], c[e], c[a]) * side(c[d], c[e], c[b]) < 0
            )
              count++;
          }),
        );

        return count;
      };
      /** The same sites, laid out without links: the name order. */
      const byName = (n: number) => sites(linked(n, []));
      const SAMPLES: Record<string, { n: number; links: [number, number][] }> = {
        chain: {
          n: 5,
          links: [
            [0, 3],
            [3, 1],
            [1, 4],
            [4, 2],
          ],
        },
        hub: {
          n: 6,
          links: [
            [2, 0],
            [2, 1],
            [2, 3],
            [2, 4],
            [2, 5],
          ],
        },
        pairs: {
          n: 6,
          links: [
            [0, 3],
            [1, 4],
            [2, 5],
          ],
        },
        ring: {
          n: 6,
          links: [
            [0, 2],
            [2, 4],
            [4, 1],
            [1, 3],
            [3, 5],
            [5, 0],
          ],
        },
        twoClusters: {
          n: 6,
          links: [
            [0, 2],
            [2, 4],
            [4, 0],
            [1, 3],
            [3, 5],
            [5, 1],
            [0, 1],
          ],
        },
        mesh4: {
          n: 4,
          links: [
            [0, 1],
            [0, 2],
            [0, 3],
            [1, 2],
            [1, 3],
            [2, 3],
          ],
        },
      };

      it.each(Object.entries(SAMPLES))('%s: no more crossings than name order', (_, { n, links }) => {
        const ordered = crossings(sites(linked(n, links)), links);

        expect(ordered).toBeLessThanOrEqual(crossings(byName(n), links));
        expect(overlaps(sites(linked(n, links)))).toEqual([]);
      });

      it('makes chains, hubs, pairs, rings and linked clusters crossing-free (name order is not)', () => {
        for (const name of ['chain', 'hub', 'pairs', 'ring', 'twoClusters']) {
          const { n, links } = SAMPLES[name];

          expect({ name, crossings: crossings(sites(linked(n, links)), links) }).toEqual({ name, crossings: 0 });
        }
        expect(crossings(byName(6), SAMPLES['pairs'].links)).toBeGreaterThan(0);
        expect(crossings(byName(5), SAMPLES['chain'].links)).toBeGreaterThan(0);
        // A full mesh of 4 always has its one unavoidable crossing on a ring.
        expect(crossings(sites(linked(4, SAMPLES['mesh4'].links)), SAMPLES['mesh4'].links)).toBe(1);
      });

      it('is stable: the first site by name stays at the top, same links give the same layout', () => {
        const { n, links } = SAMPLES['pairs'];
        const boxes = sites(linked(n, links));

        expect(Math.min(...boxes.map((b) => centre(b).y))).toBe(centre(boxes[0]).y);
        expect(sites(linked(n, [...links].reverse()))).toEqual(boxes);
      });
    });

    it('keeps groups below and border items right of the star', () => {
      const boxes = workspaceLayout(model, workspaceVisibleItems(model, 3));
      const ring = ['site:a', 'site:b', 'site:c'].map((id) => boxes.get(id) as WorkspaceBox);
      const bottom = Math.max(...ring.map((b) => b.y + b.height));
      const right = Math.max(...ring.map((b) => b.x + b.width));

      expect((boxes.get('group:shop/frontend') as WorkspaceBox).y).toBeGreaterThan(bottom);
      expect((boxes.get('hostname:shop.example.com') as WorkspaceBox).x).toBeGreaterThan(right);
    });
  });

  it('keys layouts by the visible set', () => {
    expect(workspaceLayoutKey(new Set(['a', 'b']))).toBe(workspaceLayoutKey(new Set(['b', 'a'])));
    expect(workspaceLayoutKey(new Set(['a']))).not.toBe(workspaceLayoutKey(new Set(['b'])));
  });

  it('lays out 1,000 nodes / 10,000 replicas quickly (P5 perf budget, unit-level)', () => {
    const elements: typeof WS_GRAPH.elements = [];

    for (let s = 0; s < 10; s++) elements.push({ id: `site:s${s}`, kind: 'site', label: `s${s}`, data: {} });

    for (let n = 0; n < 1000; n++) {
      elements.push({ id: `node:n${n}`, kind: 'node', label: `n${n}`, parent: `site:s${n % 10}`, data: {} });

      for (let r = 0; r < 10; r++)
        elements.push({
          id: `replica:p/d${n % 50}/svc${r % 3}/${n * 10 + r}`,
          kind: 'replica',
          label: `r${r}`,
          parent: `node:n${n}`,
          project: 'p',
          data: {},
        });
    }

    const started = performance.now();
    const big: WorkspaceModel = workspaceModel({ elements, edges: [] }, []);
    const visible = workspaceVisibleItems(big, 3);
    const boxes = workspaceLayout(big, visible);

    expect(boxes.size).toBe(visible.size);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('runs the whole map pipeline for 1,000 nodes / 10,000 replicas within budget (P5 perf, unit level)', () => {
    const elements: typeof WS_GRAPH.elements = [];
    const edges: typeof WS_GRAPH.edges = [];

    for (let s = 0; s < 10; s++) elements.push({ id: `site:s${s}`, kind: 'site', label: `s${s}`, data: {} });

    for (let n = 0; n < 1000; n++) {
      elements.push({ id: `node:n${n}`, kind: 'node', label: `n${n}`, parent: `site:s${n % 10}`, data: {} });

      for (let r = 0; r < 10; r++)
        elements.push({
          id: `replica:p/d${n % 50}/svc${r % 3}/${n * 10 + r}`,
          kind: 'replica',
          label: `r${r}`,
          parent: `node:n${n}`,
          project: 'p',
          data: {},
        });

      edges.push({
        id: `tunnel:${n}`,
        kind: 'tunnel',
        source: `node:n${n}`,
        target: `node:n${(n + 1) % 1000}`,
        layer: 'tunnels',
        data: {},
      });
    }

    for (let f = 0; f < 5000; f++)
      edges.push({
        id: `flow:${f}`,
        kind: 'flow',
        source: `replica:p/d${f % 50}/svc${f % 3}/${(f * 7) % 10000}`,
        target: `replica:p/d${(f + 1) % 50}/svc${(f + 1) % 3}/${(f * 13) % 10000}`,
        layer: 'policies',
        data: { bytesPerSecond: 1 },
      });

    const started = performance.now();
    const big = workspaceModel({ elements, edges }, []);
    const all = workspaceVisibleItems(big, 3);
    const boxes = workspaceLayout(big, all);
    const far = workspaceVisibleItems(big, 1);
    const bundled = bundleEdges(big, far);
    const positions = workspacePositions(big, boxes, far);
    const elapsed = performance.now() - started;

    // Far out (L1) only sites and nodes are instantiated, edges bundled per node pair.
    expect(far.size).toBe(1010);
    expect(Object.keys(positions)).toHaveLength(1000);
    expect(bundled.length).toBeLessThan(edges.length);
    expect(elapsed).toBeLessThan(8000);
  });
});
