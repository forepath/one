/**
 * Shared layout math of the graph viewer (ported from the repo's `tools/graph` HTML viewer): node sizes, community
 * star rings, iteration budgets, view transforms and the client-side node search. The typed-array layout itself lives
 * in `graph-engine.ts`, the spatial index in `graph-index.ts`.
 *
 * Nothing here touches the DOM.
 */

export interface GraphLayoutInputNode {
  id: string;
  type: string;
  label?: string;
  path?: string;
  community?: number;
  attrs?: Record<string, unknown>;
}

export interface GraphLayoutInputEdge {
  from: string;
  to: string;
  type: string;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

export type RandomFn = () => number;

/** Node types that anchor a community star when the document carries no community ids (priority order). */
export const GRAPH_HUB_TYPES: readonly string[] = [
  'instance',
  'workspace',
  'environment',
  'module',
  'prompt',
  'mount',
  'session',
];

const BASE_RADIUS: Record<string, number> = {
  workspace: 12,
  environment: 11,
  module: 8,
  language: 7,
  prompt: 7,
  session: 6,
  mount: 7,
  'knowledge-folder': 6,
  directory: 5,
  package: 5,
  file: 4.5,
  doc: 4.5,
  instruction: 5,
  symbol: 3.5,
};

const FIRST_RING = 46;
const RING_GAP = 30;
const NODE_SPACING = 20;

/** Deterministic PRNG (mulberry32) so a document always gets the same layout. */
export function seededRandom(seed: number): RandomFn {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;

    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable seed for a set of node ids. */
export function hashSeed(values: readonly string[]): number {
  let hash = 2166136261;

  for (const value of values) {
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }

  return hash >>> 0;
}

export function nodeRadius(type: string, degree: number): number {
  return (BASE_RADIUS[type] ?? 4) + Math.min(4, Math.log2(1 + Math.max(0, degree)) * 0.7);
}

/** Radius of ring `ring` (0-based) and how many nodes fit on it. */
export function ringCapacity(ring: number): { radius: number; capacity: number } {
  const radius = FIRST_RING + ring * RING_GAP;

  return { radius, capacity: Math.max(6, Math.floor((2 * Math.PI * radius) / NODE_SPACING)) };
}

/** Outer radius of a star with `count` nodes around its center. */
export function ringExtent(count: number): number {
  if (count <= 0) {
    return FIRST_RING / 2;
  }

  let remaining = count;
  let ring = 0;

  while (remaining > 0) {
    remaining -= ringCapacity(ring).capacity;
    ring++;
  }

  return ringCapacity(ring - 1).radius + RING_GAP / 2;
}

/** Default iteration budget by graph size. */
export function defaultIterations(nodeCount: number): number {
  if (nodeCount > 200_000) {
    return 40;
  }

  if (nodeCount > 3000) {
    return 70;
  }

  if (nodeCount > 1500) {
    return 100;
  }

  if (nodeCount > 400) {
    return 150;
  }

  return 220;
}

/** Transform that fits `bounds` into a `width` × `height` viewport (screen = world * k + offset). */
export function fitTransform(
  bounds: LayoutBounds | null,
  width: number,
  height: number,
  options: { padding?: number; maxScale?: number; minScale?: number } = {},
): ViewTransform {
  const padding = options.padding ?? 40;
  const maxScale = options.maxScale ?? 2;
  const minScale = options.minScale ?? 0.02;

  if (!bounds || width <= 0 || height <= 0) {
    return { x: width / 2, y: height / 2, k: 1 };
  }

  const bw = Math.max(40, bounds.maxX - bounds.minX);
  const bh = Math.max(40, bounds.maxY - bounds.minY);
  const k = Math.min(
    maxScale,
    Math.max(minScale, Math.min((width - padding * 2) / bw, (height - padding * 2) / bh) || 1),
  );
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;

  return { x: width / 2 - cx * k, y: height / 2 - cy * k, k };
}

/** Zooms by `factor` around a screen point (that point stays under the cursor). */
export function zoomAt(transform: ViewTransform, sx: number, sy: number, factor: number): ViewTransform {
  const k = Math.min(8, Math.max(0.01, transform.k * factor));
  const wx = (sx - transform.x) / transform.k;
  const wy = (sy - transform.y) / transform.k;

  return { x: sx - wx * k, y: sy - wy * k, k };
}

export function screenToWorld(transform: ViewTransform, sx: number, sy: number): LayoutPoint {
  return { x: (sx - transform.x) / transform.k, y: (sy - transform.y) / transform.k };
}

/** Drawn radius in screen pixels: readable when zoomed out, capped when zoomed in. */
export function screenRadiusPx(radius: number, k: number): number {
  return Math.min(18, Math.max(2, radius * k));
}

/**
 * Client-side search over loaded nodes (label, path, id; case-insensitive). Label prefix matches rank first, then
 * label matches, then path / id matches.
 */
export function matchNodes(nodes: readonly GraphLayoutInputNode[], query: string, limit = 500): string[] {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return [];
  }

  const ranked: { id: string; rank: number }[] = [];

  for (const node of nodes) {
    const label = (node.label ?? '').toLowerCase();
    let rank = -1;

    if (label.startsWith(needle)) {
      rank = 0;
    } else if (label.includes(needle)) {
      rank = 1;
    } else if ((node.path ?? '').toLowerCase().includes(needle) || node.id.toLowerCase().includes(needle)) {
      rank = 2;
    }

    if (rank >= 0) {
      ranked.push({ id: node.id, rank });
    }
  }

  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((entry) => entry.id);
}
