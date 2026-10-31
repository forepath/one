import type { TopologyEdge } from '@forepath/loadweaver/frontend/data-access-console';

import type { WorkspaceItem, WorkspaceItemKind, WorkspaceModel } from './workspace-model';

/**
 * The Workspace's own deterministic grouped layout (3.36): sites in a star around the map centre (evenly on an
 * ellipse fitted to the viewport aspect, ordered by their links for few crossings; 2026-10-29), nodes in a grid per site, stacks / VMs /
 * volumes in a grid per node, replicas in a row per stack; groups below, outside peers / hostnames / addresses on a
 * border column. Pure and allocation-light so it runs in a web worker; the same model always gives the same
 * positions (cached per user + cluster). Semantic zoom (L0 sites … L3 replicas) decides which items are
 * instantiated at all; edges of hidden items are bundled onto their nearest visible ancestor.
 */

export type WorkspaceZoomLevel = 0 | 1 | 2 | 3;

export interface WorkspaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which kinds a zoom level instantiates (collapsed compounds' children are not created at all). */
const LEVEL_KINDS: Record<WorkspaceZoomLevel, ReadonlySet<WorkspaceItemKind>> = {
  0: new Set(['site', 'external', 'hostname']),
  1: new Set(['site', 'node', 'external', 'hostname', 'address', 'group']),
  2: new Set(['site', 'node', 'stack', 'vm', 'volume', 'external', 'hostname', 'address', 'group']),
  3: new Set(['site', 'node', 'stack', 'replica', 'vm', 'volume', 'external', 'hostname', 'address', 'group']),
};

/** The semantic zoom level of a Cytoscape zoom factor (thresholds tuned for the default node sizes). */
export function workspaceZoomLevel(zoom: number): WorkspaceZoomLevel {
  if (zoom < 0.25) return 0;

  if (zoom < 0.5) return 1;

  if (zoom < 1.1) return 2;

  return 3;
}

/**
 * Ids of the drawn items to instantiate at a level. `expanded` forces children of these items in (selection,
 * search hits), `keep` forces single items in (their ancestors come along).
 */
export function workspaceVisibleItems(
  model: WorkspaceModel,
  level: WorkspaceZoomLevel,
  keep: Iterable<string> = [],
): Set<string> {
  const kinds = LEVEL_KINDS[level];
  const visible = new Set(model.items.filter((i) => i.drawn && kinds.has(i.kind)).map((i) => i.id));

  for (const id of keep) {
    let current: string | null = id;

    while (current && model.byId.get(current)?.drawn) {
      visible.add(current);
      current = model.byId.get(current)?.parent ?? null;
    }
  }

  // A child is only shown inside a visible parent.
  for (const id of [...visible]) {
    const parent = model.byId.get(id)?.parent;

    if (parent && !visible.has(parent)) visible.delete(id);
  }

  return visible;
}

/** The nearest visible item for an id (itself, or an ancestor), or null. */
export function nearestVisible(model: WorkspaceModel, visible: ReadonlySet<string>, id: string): string | null {
  let current: string | null = id;
  const seen = new Set<string>();

  while (current && !seen.has(current)) {
    if (visible.has(current)) return current;

    seen.add(current);
    current = model.byId.get(current)?.parent ?? null;
  }

  return null;
}

/** An edge drawn between visible items, standing for `count` underlying edges. */
export interface WorkspaceBundledEdge {
  id: string;
  kind: string;
  layer: string;
  source: string;
  target: string;
  count: number;
  /** The underlying edge ids. */
  edges: string[];
  data: Record<string, unknown>;
}

/**
 * Edges of hidden items move to their nearest visible ancestor; parallel edges of the same kind between the same
 * ends merge (flow rates add up); edges inside one visible item are dropped.
 */
export function bundleEdges(
  model: WorkspaceModel,
  visible: ReadonlySet<string>,
  edges: readonly TopologyEdge[] = model.edges,
): WorkspaceBundledEdge[] {
  const out = new Map<string, WorkspaceBundledEdge>();

  for (const e of edges) {
    const source = visible.has(e.source) ? e.source : nearestVisible(model, visible, e.source);
    const target = visible.has(e.target) ? e.target : nearestVisible(model, visible, e.target);

    if (!source || !target || source === target) continue;

    const direct = source === e.source && target === e.target;
    const key = direct ? e.id : `${e.kind}:${source}->${target}`;
    const bundled = out.get(key);

    if (bundled) {
      bundled.count += 1;
      bundled.edges.push(e.id);

      if (typeof e.data['bytesPerSecond'] === 'number')
        bundled.data['bytesPerSecond'] = Number(bundled.data['bytesPerSecond'] ?? 0) + e.data['bytesPerSecond'];
    } else
      out.set(key, {
        id: key,
        kind: e.kind,
        layer: e.layer,
        source,
        target,
        count: 1,
        edges: [e.id],
        data: { ...e.data },
      });
  }

  return [...out.values()];
}

/** Default viewport aspect (width / height) of the star layout when the caller does not know the canvas size. */
export const WORKSPACE_LAYOUT_ASPECT = 1.6;

/**
 * Positions (top-left boxes) of the visible items. Compounds are sized from their children; leaves have fixed
 * sizes. Cytoscape takes the centers of leaves (`x + width / 2`), compounds follow their children.
 *
 * Top-level items (sites, then site-less nodes / compounds; each by name) form a star around the centre: 1 item sits
 * at the centre, 2 left and right of it, n ≥ 3 evenly on an ellipse starting at the top, clockwise. The ring radius
 * comes from the largest item's diagonal, so no two boxes overlap however many nodes a site holds; the ellipse
 * stretches towards `aspect` (viewport width / height) so fit-to-screen uses the canvas. Inside each item nothing
 * changes. Groups sit below the star, hostnames / addresses / outside peers in a column right of it.
 */
export function workspaceLayout(
  model: WorkspaceModel,
  visible: ReadonlySet<string>,
  aspect = 1.6, // = WORKSPACE_LAYOUT_ASPECT (inlined: the function's source runs in the worker)
): Map<string, WorkspaceBox> {
  // Self-contained (no module-level references): the function's source also runs in a web worker.
  const GAP = 24;
  const PAD = 16;
  const HEADER = 28;
  const LEAF: Partial<Record<WorkspaceItemKind, { width: number; height: number }>> = {
    replica: { width: 36, height: 36 },
    stack: { width: 140, height: 52 },
    vm: { width: 140, height: 52 },
    volume: { width: 140, height: 40 },
    node: { width: 180, height: 72 },
    site: { width: 220, height: 96 },
    group: { width: 160, height: 48 },
    hostname: { width: 200, height: 36 },
    address: { width: 160, height: 36 },
    external: { width: 160, height: 36 },
  };
  const ORDER: Partial<Record<WorkspaceItemKind, number>> = { stack: 0, vm: 1, volume: 2, replica: 3 };

  function leafSize(item: WorkspaceItem): { width: number; height: number } {
    return LEAF[item.kind] ?? { width: 140, height: 40 };
  }

  /** Grid of boxes: as square as possible, row-major, in the given order. */
  function grid(sizes: readonly { width: number; height: number }[]): {
    offsets: { x: number; y: number }[];
    width: number;
    height: number;
  } {
    if (sizes.length === 0) return { offsets: [], width: 0, height: 0 };

    const columns = Math.ceil(Math.sqrt(sizes.length));
    const colWidth = Math.max(...sizes.map((s) => s.width));
    const rowHeights: number[] = [];

    sizes.forEach((s, i) => {
      const row = Math.floor(i / columns);

      rowHeights[row] = Math.max(rowHeights[row] ?? 0, s.height);
    });

    const rowY = rowHeights.map((_, r) => rowHeights.slice(0, r).reduce((a, h) => a + h + GAP, 0));
    const offsets = sizes.map((_, i) => ({ x: (i % columns) * (colWidth + GAP), y: rowY[Math.floor(i / columns)] }));

    return {
      offsets,
      width: Math.min(columns, sizes.length) * (colWidth + GAP) - GAP,
      height: rowY[rowY.length - 1] + rowHeights[rowHeights.length - 1],
    };
  }

  function sortChildren(a: WorkspaceItem, b: WorkspaceItem): number {
    return (
      (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9) ||
      (a.project ?? '').localeCompare(b.project ?? '') ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id)
    );
  }

  const boxes = new Map<string, WorkspaceBox>();
  const children = (item: WorkspaceItem) =>
    item.children
      .map((id) => model.byId.get(id) as WorkspaceItem)
      .filter((c) => c && visible.has(c.id))
      .sort(sortChildren);
  const sizeCache = new Map<string, { width: number; height: number }>();
  const size = (item: WorkspaceItem): { width: number; height: number } => {
    const cached = sizeCache.get(item.id);

    if (cached) return cached;

    const kids = children(item);
    let result: { width: number; height: number };

    if (kids.length === 0) result = leafSize(item);
    else if (item.kind === 'stack') {
      // Replicas in one row.
      result = {
        width: Math.max(leafSize(item).width, kids.length * (36 + 8) - 8 + 2 * PAD),
        height: 36 + HEADER + 2 * PAD,
      };
    } else {
      const g = grid(kids.map(size));

      result = {
        width: Math.max(leafSize(item).width, g.width + 2 * PAD),
        height: Math.max(leafSize(item).height, g.height + HEADER + 2 * PAD),
      };
    }

    sizeCache.set(item.id, result);

    return result;
  };
  const place = (item: WorkspaceItem, x: number, y: number) => {
    const s = size(item);

    boxes.set(item.id, { x, y, width: s.width, height: s.height });

    const kids = children(item);

    if (kids.length === 0) return;

    if (item.kind === 'stack') kids.forEach((k, i) => place(k, x + PAD + i * (36 + 8), y + HEADER + PAD));
    else {
      const g = grid(kids.map(size));

      kids.forEach((k, i) => place(k, x + PAD + g.offsets[i].x, y + HEADER + PAD + g.offsets[i].y));
    }
  };
  /**
   * Centres of `sizes` on the star (relative to the star's centre at 0 / 0). Adjacent centres on a circle of radius R
   * are 2R·sin(π/n) apart, at least one box diagonal (+ gap) apart means no overlap; an ellipse with both semi-axes
   * ≥ R only moves points further apart, so it is stretched towards the viewport aspect.
   */
  function ring(sizes: readonly { width: number; height: number }[]): { x: number; y: number }[] {
    const n = sizes.length;

    if (n === 0) return [];
    if (n === 1) return [{ x: 0, y: 0 }];

    const w = Math.max(...sizes.map((s) => s.width));
    const h = Math.max(...sizes.map((s) => s.height));
    const diagonal = Math.hypot(w, h) + GAP * 2;
    const r = Math.max(diagonal / (2 * Math.sin(Math.PI / n)), diagonal / 2);
    const ratio = aspect > 0 && Number.isFinite(aspect) ? aspect : 1.6;
    let a = r;
    let b = r;

    if (n > 2) {
      // The star's bounding box (2a + w) × (2b + h) towards the viewport's width / height.
      if (ratio * (2 * r + h) - w > 2 * r) a = (ratio * (2 * r + h) - w) / 2;
      else b = Math.max(r, ((2 * r + w) / ratio - h) / 2);
    }

    // n = 2: left / right; otherwise from the top, clockwise.
    const start = n === 2 ? Math.PI : -Math.PI / 2;

    return sizes.map((_, i) => {
      const angle = start + (2 * Math.PI * i) / n;

      return { x: Math.round(a * Math.cos(angle)), y: Math.round(b * Math.sin(angle)) };
    });
  }

  /**
   * Ring order with few edge crossings: links between the items (edges of anything inside them, counted per pair) are
   * chords of the ring; two chords cross exactly when their ends interleave. Greedy insertion, most-linked item first
   * (name as the tiebreaker), each at the slot with the fewest crossings, then the shortest ring distance of its
   * links, then the earliest slot; refined by moving single items. Deterministic; rotated so the first name sits at
   * the top. Up to 16 items (beyond that, name order: the cost grows with pairs²); fewer than 4 cannot cross.
   */
  function arrange(items: WorkspaceItem[]): WorkspaceItem[] {
    const n = items.length;

    if (n < 4 || n > 16) return items;

    const index = new Map(items.map((item, i) => [item.id, i]));
    const top = (id: string): number | undefined => {
      let current = model.byId.get(id);

      for (let guard = 0; current && guard < 64; guard++) {
        const i = index.get(current.id);

        if (i !== undefined) return i;
        current = current.parent ? model.byId.get(current.parent) : undefined;
      }

      return undefined;
    };
    const weight = new Map<string, number>();

    for (const e of model.edges) {
      const a = top(e.source);
      const b = top(e.target);

      if (a === undefined || b === undefined || a === b) continue;

      const key = a < b ? `${a}:${b}` : `${b}:${a}`;

      weight.set(key, (weight.get(key) ?? 0) + 1);
    }

    if (weight.size === 0) return items;

    const pairs = [...weight.entries()].map(([key, w]) => {
      const [a, b] = key.split(':').map(Number);

      return { a, b, w };
    });
    const degree = items.map((_, i) => pairs.reduce((sum, p) => sum + (p.a === i || p.b === i ? p.w : 0), 0));
    const queue = items.map((_, i) => i).sort((x, y) => degree[y] - degree[x] || x - y);
    const cost = (ring: number[]): number => {
      const at = new Map(ring.map((item, slot) => [item, slot]));
      const placed = pairs.filter((p) => at.has(p.a) && at.has(p.b));
      let crossings = 0;
      let length = 0;

      for (let i = 0; i < placed.length; i++) {
        const p = placed[i];
        const [p1, p2] = [at.get(p.a) as number, at.get(p.b) as number].sort((x, y) => x - y);
        const gap = p2 - p1;

        length += p.w * Math.min(gap, ring.length - gap);

        for (let j = i + 1; j < placed.length; j++) {
          const q = placed[j];

          if (q.a === p.a || q.a === p.b || q.b === p.a || q.b === p.b) continue;

          const q1 = at.get(q.a) as number;
          const q2 = at.get(q.b) as number;

          if ((q1 > p1 && q1 < p2) !== (q2 > p1 && q2 < p2)) crossings += p.w * q.w;
        }
      }

      return crossings * 1e6 + length;
    };
    /** `next` inserted into `ring` at its cheapest slot (earliest on ties). */
    const insert = (ring: number[], next: number): number[] => {
      let best: number[] = [...ring, next];
      let bestCost = Infinity;

      for (let slot = 0; slot <= ring.length; slot++) {
        const candidate = [...ring.slice(0, slot), next, ...ring.slice(slot)];
        const c = cost(candidate);

        if (c < bestCost) {
          best = candidate;
          bestCost = c;
        }
      }

      return best;
    };
    let ring: number[] = [];

    for (const next of queue) ring = insert(ring, next);

    // Refine: move single items to their cheapest slot while that helps (a few passes; greedy can trap e.g. cycles).
    let current = cost(ring);

    for (let pass = 0; pass < 4; pass++) {
      let improved = false;

      for (const item of queue) {
        const candidate = insert(
          ring.filter((i) => i !== item),
          item,
        );
        const c = cost(candidate);

        if (c < current) {
          ring = candidate;
          current = c;
          improved = true;
        }
      }

      if (!improved) break;
    }

    // Rotate so the first item by name (index 0) is at the top; turn so its smaller-named neighbour follows clockwise.
    const start = ring.indexOf(0);
    const rotated = [...ring.slice(start), ...ring.slice(0, start)];
    const ordered = rotated[1] > rotated[rotated.length - 1] ? [rotated[0], ...rotated.slice(1).reverse()] : rotated;

    return ordered.map((i) => items[i]);
  }

  const roots = model.items.filter((i) => visible.has(i.id) && (!i.parent || !visible.has(i.parent)));
  const by = (kinds: WorkspaceItemKind[]) =>
    roots
      .filter((i) => kinds.includes(i.kind))
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  // Star: sites, then nodes without a site, then other unparented compounds, around the centre; ordered by their links.
  const main = arrange([...by(['site']), ...by(['node']), ...by(['stack', 'vm', 'volume', 'replica'])]);
  const centres = ring(main.map(size));
  const left = Math.min(0, ...main.map((item, i) => centres[i].x - size(item).width / 2));
  const top = Math.min(0, ...main.map((item, i) => centres[i].y - size(item).height / 2));
  let x = 0;
  let mainHeight = 0;

  main.forEach((item, i) => {
    const s = size(item);
    const boxX = centres[i].x - s.width / 2 - left;
    const boxY = centres[i].y - s.height / 2 - top;

    place(item, boxX, boxY);
    x = Math.max(x, boxX + s.width + GAP * 2);
    mainHeight = Math.max(mainHeight, boxY + s.height);
  });

  // Groups below the star.
  let gx = 0;
  const groupsY = main.length ? mainHeight + GAP * 3 : 0;

  for (const item of by(['group'])) {
    place(item, gx, groupsY);
    gx += size(item).width + GAP;
  }

  // Border column right: hostnames, addresses, outside peers.
  let borderY = 0;
  const borderX = Math.max(x, gx) + GAP * 3;

  for (const item of [...by(['hostname']), ...by(['address']), ...by(['external'])]) {
    place(item, borderX, borderY);
    borderY += size(item).height + GAP / 2;
  }

  return boxes;
}

/**
 * Cytoscape preset positions of the visible items: the centers of the leaves (compounds follow their children); with
 * a layout of more items than are visible, a collapsed compound sits in the middle of its expanded area.
 */
export function workspacePositions(
  model: WorkspaceModel,
  boxes: ReadonlyMap<string, WorkspaceBox>,
  visible: ReadonlySet<string>,
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};

  for (const [id, b] of boxes) {
    if (!visible.has(id)) continue;

    const item = model.byId.get(id);
    const hasVisibleChildren = !!item?.children.some((c) => visible.has(c));

    if (!hasVisibleChildren) out[id] = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }

  return out;
}

/** Cache key of a layout: the visible ids (sorted) — the layout is a pure function of model + visible set. */
export function workspaceLayoutKey(visible: ReadonlySet<string>): string {
  let hash = 2166136261;

  for (const id of [...visible].sort())
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

  return `${visible.size}:${(hash >>> 0).toString(36)}`;
}
