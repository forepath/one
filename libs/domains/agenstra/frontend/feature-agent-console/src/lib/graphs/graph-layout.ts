/**
 * Pure layout math of the graph viewer (ported from the repo's `tools/graph` HTML viewer): community stars as seed
 * positions, then a force-directed settle (springs + repulsion + collision) that runs in small steps so the UI never
 * blocks. Large graphs use grid-bucketed repulsion (only nearby nodes push each other).
 *
 * Nothing here touches the DOM; the canvas component owns drawing and scheduling.
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

export interface LayoutNode {
  id: string;
  type: string;
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pinned while a layout runs (community hubs keep clusters apart). */
  fixed: boolean;
  /** Radius in world units. */
  radius: number;
  degree: number;
  community?: number;
  /** A reference target that no longer exists (prompt history of a deleted file); drawn faded. */
  missing?: boolean;
}

export interface LayoutLink {
  source: number;
  target: number;
  type: string;
  /** Perpendicular draw offset so parallel edges between one pair do not overlay. */
  offset: number;
}

export interface GraphLayoutModel {
  nodes: LayoutNode[];
  links: LayoutLink[];
  indexById: Map<string, number>;
  /** Undirected, de-duplicated neighbor indices. */
  adjacency: number[][];
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

const MAX_HUBS = 80;
const FIRST_RING = 46;
const RING_GAP = 30;
const NODE_SPACING = 20;
const GROUP_GAP = 70;
const MAX_LINKS = 24_000;

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

/** Builds indices, adjacency and degrees. Edges to unknown nodes and self loops are skipped. */
export function buildLayoutModel(
  nodes: readonly GraphLayoutInputNode[],
  edges: readonly GraphLayoutInputEdge[],
  options: { maxLinks?: number } = {},
): GraphLayoutModel {
  const maxLinks = options.maxLinks ?? MAX_LINKS;
  const indexById = new Map<string, number>();
  const layoutNodes: LayoutNode[] = [];

  for (const node of nodes) {
    if (indexById.has(node.id)) {
      continue;
    }

    const index = layoutNodes.length;

    indexById.set(node.id, index);
    layoutNodes.push({
      id: node.id,
      type: node.type,
      index,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      fixed: false,
      radius: 0,
      degree: 0,
      ...(node.community !== undefined ? { community: node.community } : {}),
      ...(node.attrs?.['missing'] === true ? { missing: true } : {}),
    });
  }

  const neighborSets: Set<number>[] = layoutNodes.map(() => new Set<number>());
  const links: LayoutLink[] = [];

  for (const edge of edges) {
    if (links.length >= maxLinks) {
      break;
    }

    const source = indexById.get(edge.from);
    const target = indexById.get(edge.to);

    if (source === undefined || target === undefined || source === target) {
      continue;
    }

    links.push({ source, target, type: edge.type, offset: 0 });
    neighborSets[source].add(target);
    neighborSets[target].add(source);
  }

  const adjacency = neighborSets.map((set) => [...set]);

  for (const node of layoutNodes) {
    node.degree = adjacency[node.index].length;
    node.radius = nodeRadius(node.type, node.degree);
  }

  assignLinkOffsets(links);

  return { nodes: layoutNodes, links, indexById, adjacency };
}

/** Spreads parallel edges of one node pair (`(i - (count - 1) / 2) * 6`). */
export function assignLinkOffsets(links: LayoutLink[]): void {
  const groups = new Map<string, LayoutLink[]>();

  for (const link of links) {
    const key = link.source < link.target ? `${link.source}:${link.target}` : `${link.target}:${link.source}`;
    const list = groups.get(key);

    if (list) {
      list.push(link);
    } else {
      groups.set(key, [link]);
    }
  }

  for (const list of groups.values()) {
    const count = list.length;

    list.forEach((link, i) => {
      link.offset = count === 1 ? 0 : (i - (count - 1) / 2) * 6;
    });
  }
}

/** Nodes within `hops` (undirected) of the seeds, seeds included. */
export function neighborhood(adjacency: readonly (readonly number[])[], seeds: readonly number[], hops: number) {
  const keep = new Set<number>(seeds);
  let frontier = [...seeds];

  for (let hop = 0; hop < hops && frontier.length > 0; hop++) {
    const next: number[] = [];

    for (const index of frontier) {
      for (const neighbor of adjacency[index] ?? []) {
        if (!keep.has(neighbor)) {
          keep.add(neighbor);
          next.push(neighbor);
        }
      }
    }

    frontier = next;
  }

  return keep;
}

export interface CommunityGroup {
  /** Center node index, `-1` for the group of loose (unconnected) nodes. */
  hub: number;
  members: number[];
}

/**
 * Groups nodes into stars: by `community` when the document has community ids, else around hub types
 * ({@link GRAPH_HUB_TYPES}) by breadth-first ownership. Components without a hub become their own star; tiny groups
 * (< 3 nodes) are collected in one loose group.
 */
export function groupCommunities(model: GraphLayoutModel): CommunityGroup[] {
  const { nodes, adjacency } = model;
  const owner = new Int32Array(nodes.length).fill(-1);
  const groups: number[][] = [];
  const hasCommunities = nodes.some((node) => node.community !== undefined);

  if (hasCommunities) {
    const byCommunity = new Map<number, number>();

    for (const node of nodes) {
      if (node.community === undefined) {
        continue;
      }

      let group = byCommunity.get(node.community);

      if (group === undefined) {
        group = groups.length;
        byCommunity.set(node.community, group);
        groups.push([]);
      }

      groups[group].push(node.index);
      owner[node.index] = group;
    }
  } else {
    const rank = (type: string) => GRAPH_HUB_TYPES.indexOf(type);
    let hubs = nodes
      .filter((node) => rank(node.type) >= 0)
      .sort((a, b) => rank(a.type) - rank(b.type) || b.degree - a.degree || a.id.localeCompare(b.id))
      .slice(0, MAX_HUBS);

    if (hubs.length === 0) {
      const count = Math.max(1, Math.round(Math.sqrt(nodes.length) / 2));

      hubs = [...nodes]
        .filter((node) => node.degree >= 2)
        .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))
        .slice(0, count);
    }

    const queue: number[] = [];

    for (const hub of hubs) {
      owner[hub.index] = groups.length;
      groups.push([hub.index]);
      queue.push(hub.index);
    }

    for (let head = 0; head < queue.length; head++) {
      const index = queue[head];

      for (const neighbor of adjacency[index]) {
        if (owner[neighbor] === -1) {
          owner[neighbor] = owner[index];
          groups[owner[index]].push(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  // Nodes without a group: join a neighbor's group, else form groups per connected component.
  for (const node of nodes) {
    if (owner[node.index] !== -1) {
      continue;
    }

    const neighborGroup = adjacency[node.index].find((neighbor) => owner[neighbor] !== -1);

    if (neighborGroup !== undefined) {
      owner[node.index] = owner[neighborGroup];
      groups[owner[node.index]].push(node.index);
      continue;
    }

    const group = groups.length;
    const queue = [node.index];

    groups.push([]);
    owner[node.index] = group;

    for (let head = 0; head < queue.length; head++) {
      const index = queue[head];

      groups[group].push(index);

      for (const neighbor of adjacency[index]) {
        if (owner[neighbor] === -1) {
          owner[neighbor] = group;
          queue.push(neighbor);
        }
      }
    }
  }

  const result: CommunityGroup[] = [];
  const loose: number[] = [];

  for (const members of groups) {
    if (members.length === 0) {
      continue;
    }

    if (members.length < 3) {
      loose.push(...members);
      continue;
    }

    let hub = members[0];

    for (const member of members) {
      if (nodes[member].degree > nodes[hub].degree) {
        hub = member;
      }
    }

    // Prefer a hub type as the center when the group has one.
    const typed = members.find((member) => GRAPH_HUB_TYPES.includes(nodes[member].type));

    result.push({ hub: typed ?? hub, members });
  }

  if (loose.length > 0) {
    result.push({ hub: -1, members: loose });
  }

  return result;
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

/**
 * Puts the hub at the center and the members on concentric rings, grouped by type (same types form arcs) and by
 * degree within a type.
 */
export function placeOnRings(
  model: GraphLayoutModel,
  group: CommunityGroup,
  cx: number,
  cy: number,
  random: RandomFn,
): void {
  const { nodes } = model;

  if (group.hub >= 0) {
    nodes[group.hub].x = cx;
    nodes[group.hub].y = cy;
  }

  const members = group.members
    .filter((member) => member !== group.hub)
    .sort(
      (a, b) =>
        nodes[a].type.localeCompare(nodes[b].type) ||
        nodes[b].degree - nodes[a].degree ||
        nodes[a].id.localeCompare(nodes[b].id),
    );
  let offset = 0;

  for (let ring = 0; offset < members.length; ring++) {
    const { radius, capacity } = ringCapacity(ring);
    const slice = members.slice(offset, offset + capacity);
    const jitter = (Math.PI * 2) / Math.max(slice.length * 4, 16);

    slice.forEach((member, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / slice.length + (random() - 0.5) * jitter;
      const r = radius + (random() - 0.5) * 8;

      nodes[member].x = cx + Math.cos(angle) * r;
      nodes[member].y = cy + Math.sin(angle) * r;
      nodes[member].vx = 0;
      nodes[member].vy = 0;
    });

    offset += slice.length;
  }
}

/**
 * Seeds positions as community stars packed in rows (largest first, centered on the origin). Returns the hubs, which
 * the force layout keeps pinned while it settles.
 */
export function seedCommunityStars(model: GraphLayoutModel, random: RandomFn): number[] {
  const groups = groupCommunities(model)
    .map((group) => ({ group, extent: ringExtent(group.members.length - (group.hub >= 0 ? 1 : 0)) }))
    .sort((a, b) => b.extent - a.extent);

  if (groups.length === 0) {
    return [];
  }

  const area = groups.reduce((sum, { extent }) => sum + (2 * extent + GROUP_GAP) ** 2, 0);
  const rowWidth = Math.max(2 * groups[0].extent + GROUP_GAP, Math.sqrt(area) * 1.15);
  const placements: { group: CommunityGroup; x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;

  for (const { group, extent } of groups) {
    const size = 2 * extent + GROUP_GAP;

    if (x > 0 && x + size > rowWidth) {
      y += rowHeight;
      x = 0;
      rowHeight = 0;
    }

    placements.push({ group, x: x + size / 2, y: y + size / 2 });
    x += size;
    width = Math.max(width, x);
    rowHeight = Math.max(rowHeight, size);
  }

  const height = y + rowHeight;
  const hubs: number[] = [];

  for (const placement of placements) {
    placeOnRings(model, placement.group, placement.x - width / 2, placement.y - height / 2, random);

    if (placement.group.hub >= 0) {
      hubs.push(placement.group.hub);
    }
  }

  return hubs;
}

/**
 * Re-uses known positions (e.g. after merging neighbors into a document) and places new nodes next to a positioned
 * neighbor. Returns the number of nodes that kept their position.
 */
export function applyCachedPositions(
  model: GraphLayoutModel,
  positions: ReadonlyMap<string, LayoutPoint>,
  random: RandomFn,
): number {
  let reused = 0;
  const placed = new Uint8Array(model.nodes.length);

  for (const node of model.nodes) {
    const cached = positions.get(node.id);

    if (cached) {
      node.x = cached.x;
      node.y = cached.y;
      placed[node.index] = 1;
      reused++;
    }
  }

  // Two passes so chains of new nodes still end up near the known part of the graph.
  for (let pass = 0; pass < 2; pass++) {
    for (const node of model.nodes) {
      if (placed[node.index]) {
        continue;
      }

      const anchor = model.adjacency[node.index].find((neighbor) => placed[neighbor]);

      if (anchor !== undefined || pass === 1) {
        const base = anchor !== undefined ? model.nodes[anchor] : { x: 0, y: 0 };
        const angle = random() * Math.PI * 2;
        const distance = 30 + random() * 40;

        node.x = base.x + Math.cos(angle) * distance;
        node.y = base.y + Math.sin(angle) * distance;
        placed[node.index] = 1;
      }
    }
  }

  return reused;
}

export interface ForceLayoutOptions {
  iterations?: number;
  /** Node indices pinned while the layout runs (released when it finishes). */
  pinned?: readonly number[];
  random?: RandomFn;
}

/** Default iteration budget by graph size. */
export function defaultIterations(nodeCount: number): number {
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

/**
 * Force-directed settle in steps: call {@link ForceLayout.step} from animation frames until it returns `true`.
 * Linked nodes attract, all nodes repel (grid-bucketed above 350 nodes), overlapping nodes collide.
 */
export class ForceLayout {
  readonly iterations: number;
  private iteration = 0;
  private readonly springs: [number, number][] = [];
  private readonly random: RandomFn;
  private readonly useGrid: boolean;
  private readonly linkDistance = 64;
  private readonly linkStrength = 0.05;
  private readonly chargeStrength = -200;
  private readonly collisionPadding = 8;
  private readonly centerPull = 0.0004;
  private readonly damp = 0.86;
  private readonly maxStep = 16;
  private readonly cellSize = 60;

  constructor(
    private readonly model: GraphLayoutModel,
    options: ForceLayoutOptions = {},
  ) {
    this.iterations = Math.max(0, options.iterations ?? defaultIterations(model.nodes.length));
    this.random = options.random ?? Math.random;
    this.useGrid = model.nodes.length > 350;

    const seen = new Set<string>();

    for (const link of model.links) {
      const key = link.source < link.target ? `${link.source}:${link.target}` : `${link.target}:${link.source}`;

      if (!seen.has(key)) {
        seen.add(key);
        this.springs.push([link.source, link.target]);
      }
    }

    for (const index of options.pinned ?? []) {
      if (model.nodes[index]) {
        model.nodes[index].fixed = true;
      }
    }
  }

  get done(): boolean {
    return this.iteration >= this.iterations || this.model.nodes.length < 2;
  }

  /** 0..1 */
  get progress(): number {
    return this.iterations === 0 ? 1 : Math.min(1, this.iteration / this.iterations);
  }

  /** Runs up to `count` iterations; returns `true` once the layout finished (pins are released then). */
  step(count = 1): boolean {
    for (let i = 0; i < count && !this.done; i++) {
      this.tick();
      this.iteration++;
    }

    if (this.done) {
      this.finish();

      return true;
    }

    return false;
  }

  /** Runs every remaining iteration synchronously (tests, tiny graphs). */
  run(): void {
    while (!this.step(50)) {
      // keep stepping
    }
  }

  /** Stops early and releases pins. */
  finish(): void {
    this.iteration = Math.max(this.iteration, this.iterations);

    for (const node of this.model.nodes) {
      node.fixed = false;
      node.vx = 0;
      node.vy = 0;
    }
  }

  private tick(): void {
    const nodes = this.model.nodes;
    const linear = 1 - this.iteration / Math.max(1, this.iterations);
    const alpha = 0.12 + linear * linear * 0.88;

    for (const node of nodes) {
      node.vx = 0;
      node.vy = 0;
    }

    if (this.useGrid) {
      this.repulsionGrid(alpha);
    } else {
      this.repulsionExact(alpha);
    }

    for (const [a, b] of this.springs) {
      const na = nodes[a];
      const nb = nodes[b];
      const dx = nb.x - na.x;
      const dy = nb.y - na.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const displace = (dist - this.linkDistance) * this.linkStrength * alpha;
      const fx = (dx / dist) * displace;
      const fy = (dy / dist) * displace;

      na.vx += fx;
      na.vy += fy;
      nb.vx -= fx;
      nb.vy -= fy;
    }

    for (const node of nodes) {
      if (node.fixed) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }

      node.vx -= node.x * this.centerPull * alpha;
      node.vy -= node.y * this.centerPull * alpha;
      node.vx *= this.damp;
      node.vy *= this.damp;

      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);

      if (speed > this.maxStep) {
        node.vx = (node.vx / speed) * this.maxStep;
        node.vy = (node.vy / speed) * this.maxStep;
      }

      node.x += node.vx;
      node.y += node.vy;
    }
  }

  private repel(a: LayoutNode, b: LayoutNode, alpha: number, maxDist2: number): void {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let dist2 = dx * dx + dy * dy;

    if (dist2 < 0.01) {
      dx = (this.random() - 0.5) * 0.5;
      dy = (this.random() - 0.5) * 0.5;
      dist2 = dx * dx + dy * dy || 0.01;
    }

    if (dist2 > maxDist2) {
      return;
    }

    const dist = Math.sqrt(dist2);
    const minDist = a.radius + b.radius + this.collisionPadding;
    let force = (this.chargeStrength * alpha) / dist2;

    if (dist < minDist) {
      force -= ((minDist - dist) / minDist) * 2.4 * alpha;
    }

    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;

    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  private repulsionExact(alpha: number): void {
    const nodes = this.model.nodes;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        this.repel(nodes[i], nodes[j], alpha, Infinity);
      }
    }
  }

  private repulsionGrid(alpha: number): void {
    const nodes = this.model.nodes;
    const size = this.cellSize;
    const cells = new Map<number, LayoutNode[]>();
    // Cell coordinates packed into one number (offset keeps them positive for any realistic layout).
    const key = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);

    for (const node of nodes) {
      const k = key(Math.floor(node.x / size), Math.floor(node.y / size));
      const bucket = cells.get(k);

      if (bucket) {
        bucket.push(node);
      } else {
        cells.set(k, [node]);
      }
    }

    const maxDist2 = size * size * 4.5;

    for (const [cellKey, bucket] of cells) {
      const bx = Math.floor(cellKey / 65536) - 32768;
      const by = (cellKey % 65536) - 32768;

      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const other = cells.get(key(bx + ox, by + oy));

          if (!other) {
            continue;
          }

          for (const a of bucket) {
            for (const b of other) {
              if (a.index < b.index) {
                this.repel(a, b, alpha, maxDist2);
              }
            }
          }
        }
      }
    }
  }
}

export function computeBounds(
  nodes: readonly LayoutNode[],
  include: (node: LayoutNode) => boolean = () => true,
): LayoutBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    if (!include(node)) {
      continue;
    }

    minX = Math.min(minX, node.x - node.radius);
    minY = Math.min(minY, node.y - node.radius);
    maxX = Math.max(maxX, node.x + node.radius);
    maxY = Math.max(maxY, node.y + node.radius);
  }

  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
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
export function screenRadius(node: LayoutNode, k: number): number {
  return Math.min(18, Math.max(2, node.radius * k));
}

/**
 * Hit test in screen pixels (never inflated world radii, those cover the whole canvas when zoomed out). Returns the
 * closest visible node index within its radius (at least `minPx`), or `-1`.
 */
export function findNodeAt(
  nodes: readonly LayoutNode[],
  transform: ViewTransform,
  sx: number,
  sy: number,
  visible: (node: LayoutNode) => boolean = () => true,
  minPx = 6,
): number {
  let hit = -1;
  let best = Infinity;

  for (const node of nodes) {
    if (!visible(node)) {
      continue;
    }

    const dx = node.x * transform.k + transform.x - sx;
    const dy = node.y * transform.k + transform.y - sy;
    const d2 = dx * dx + dy * dy;
    const r = Math.max(minPx, screenRadius(node, transform.k) + 2);

    if (d2 <= r * r && d2 < best) {
      best = d2;
      hit = node.index;
    }
  }

  return hit;
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
