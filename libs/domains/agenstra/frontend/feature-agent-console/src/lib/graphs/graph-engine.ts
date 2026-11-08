/**
 * Typed-array graph engine of the viewer: topology (degrees, unique neighbors, parallel edge offsets), community-star
 * seeding, the force-directed settle and placement of new nodes next to known neighbors. Everything works on flat
 * typed arrays (no per-node objects), so the same code scales to millions of nodes and runs unchanged inside the
 * layout Web Worker or (fallback) on the main thread in time slices.
 *
 * Nothing here touches the DOM.
 */
import {
  GRAPH_HUB_TYPES,
  defaultIterations,
  nodeRadius,
  ringCapacity,
  ringExtent,
  seededRandom,
  type RandomFn,
} from './graph-layout';

const MAX_HUBS = 80;
const GROUP_GAP = 70;
const PARALLEL_EDGE_GAP = 6;

/** Graph structure as flat arrays (indices are document order). */
export interface GraphTopologyInput {
  count: number;
  /** Type code per node (index into `typeNames`). */
  types: Uint16Array;
  typeNames: readonly string[];
  /** Community id per node, `-1` when the document has none for it. */
  community: Int32Array;
  edgeSource: Int32Array;
  edgeTarget: Int32Array;
}

/** Derived structure (computed once per document, shared by layout, index and drawing). */
export interface GraphTopology {
  /** Unique undirected neighbors per node (CSR: `adjacency.subarray(adjacencyStart[i], adjacencyStart[i + 1])`). */
  adjacencyStart: Int32Array;
  adjacency: Int32Array;
  degree: Uint32Array;
  /** World radius per node. */
  radius: Float32Array;
  /** Perpendicular draw offset per edge so parallel edges of one pair do not overlay. */
  edgeOffset: Float32Array;
  /** Edges touching each node (CSR, both directions). */
  incidentStart: Int32Array;
  incident: Int32Array;
}

/** Builds degrees, unique adjacency, radii, incident edge lists and parallel edge offsets in O(E log E). */
export function buildTopology(input: GraphTopologyInput): GraphTopology {
  const { count, edgeSource, edgeTarget } = input;
  const edgeCount = edgeSource.length;
  // Undirected pair keys (min * count + max) sorted: duplicates are parallel edges.
  const keys = new Float64Array(edgeCount);

  for (let e = 0; e < edgeCount; e++) {
    const a = edgeSource[e];
    const b = edgeTarget[e];

    keys[e] = a < b ? a * count + b : b * count + a;
  }

  const sorted = keys.slice().sort();
  const neighborCount = new Uint32Array(count);
  const repeated = new Map<number, { total: number; seen: number }>();

  for (let i = 0; i < sorted.length; i++) {
    const key = sorted[i];

    if (i > 0 && sorted[i - 1] === key) {
      const entry = repeated.get(key);

      if (entry) {
        entry.total++;
      } else {
        repeated.set(key, { total: 2, seen: 0 });
      }

      continue;
    }

    const a = Math.floor(key / count);
    const b = key - a * count;

    neighborCount[a]++;
    neighborCount[b]++;
  }

  const adjacencyStart = new Int32Array(count + 1);

  for (let i = 0; i < count; i++) {
    adjacencyStart[i + 1] = adjacencyStart[i] + neighborCount[i];
  }

  const adjacency = new Int32Array(adjacencyStart[count]);
  const fill = adjacencyStart.slice(0, count);

  for (let i = 0; i < sorted.length; i++) {
    const key = sorted[i];

    if (i > 0 && sorted[i - 1] === key) {
      continue;
    }

    const a = Math.floor(key / count);
    const b = key - a * count;

    adjacency[fill[a]++] = b;
    adjacency[fill[b]++] = a;
  }

  const edgeOffset = new Float32Array(edgeCount);

  if (repeated.size > 0) {
    for (let e = 0; e < edgeCount; e++) {
      const entry = repeated.get(keys[e]);

      if (entry) {
        edgeOffset[e] = (entry.seen - (entry.total - 1) / 2) * PARALLEL_EDGE_GAP;
        entry.seen++;
      }
    }
  }

  const incidentStart = new Int32Array(count + 1);

  for (let e = 0; e < edgeCount; e++) {
    incidentStart[edgeSource[e] + 1]++;
    incidentStart[edgeTarget[e] + 1]++;
  }

  for (let i = 0; i < count; i++) {
    incidentStart[i + 1] += incidentStart[i];
  }

  const incident = new Int32Array(incidentStart[count]);
  const incidentFill = incidentStart.slice(0, count);

  for (let e = 0; e < edgeCount; e++) {
    incident[incidentFill[edgeSource[e]]++] = e;
    incident[incidentFill[edgeTarget[e]]++] = e;
  }

  const radius = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    radius[i] = nodeRadius(input.typeNames[input.types[i]] ?? '', neighborCount[i]);
  }

  return { adjacencyStart, adjacency, degree: neighborCount, radius, edgeOffset, incidentStart, incident };
}

/** Nodes within `hops` (undirected) of the seeds, seeds included, as a membership mask. */
export function neighborhoodMask(
  topology: Pick<GraphTopology, 'adjacencyStart' | 'adjacency'>,
  count: number,
  seeds: readonly number[],
  hops: number,
): { mask: Uint8Array; size: number } {
  const mask = new Uint8Array(count);
  let frontier: number[] = [];
  let size = 0;

  for (const seed of seeds) {
    if (seed >= 0 && seed < count && !mask[seed]) {
      mask[seed] = 1;
      frontier.push(seed);
      size++;
    }
  }

  for (let hop = 0; hop < hops && frontier.length > 0; hop++) {
    const next: number[] = [];

    for (const index of frontier) {
      for (let p = topology.adjacencyStart[index]; p < topology.adjacencyStart[index + 1]; p++) {
        const neighbor = topology.adjacency[p];

        if (!mask[neighbor]) {
          mask[neighbor] = 1;
          next.push(neighbor);
          size++;
        }
      }
    }

    frontier = next;
  }

  return { mask, size };
}

export interface CommunityGroupArrays {
  /** Center node index, `-1` for the group of loose (unconnected) nodes. */
  hub: number;
  members: number[];
}

/**
 * Groups nodes into stars: by `community` when the document has community ids, else around hub types
 * ({@link GRAPH_HUB_TYPES}) by breadth-first ownership. Components without a hub become their own star; tiny groups
 * (< 3 nodes) are collected in one loose group. Ties break on document order (deterministic).
 */
export function groupCommunityArrays(input: GraphTopologyInput, topology: GraphTopology): CommunityGroupArrays[] {
  const { count, types, typeNames, community } = input;
  const { adjacencyStart, adjacency, degree } = topology;
  const owner = new Int32Array(count).fill(-1);
  const groups: number[][] = [];
  const typeRank = typeNames.map((name) => GRAPH_HUB_TYPES.indexOf(name));
  let hasCommunities = false;

  for (let i = 0; i < count; i++) {
    if (community[i] >= 0) {
      hasCommunities = true;
      break;
    }
  }

  if (hasCommunities) {
    const byCommunity = new Map<number, number>();

    for (let i = 0; i < count; i++) {
      if (community[i] < 0) {
        continue;
      }

      let group = byCommunity.get(community[i]);

      if (group === undefined) {
        group = groups.length;
        byCommunity.set(community[i], group);
        groups.push([]);
      }

      groups[group].push(i);
      owner[i] = group;
    }
  } else {
    let hubs: number[] = [];

    for (let i = 0; i < count; i++) {
      if (typeRank[types[i]] >= 0) {
        hubs.push(i);
      }
    }

    hubs = hubs
      .sort((a, b) => typeRank[types[a]] - typeRank[types[b]] || degree[b] - degree[a] || a - b)
      .slice(0, MAX_HUBS);

    if (hubs.length === 0) {
      const wanted = Math.max(1, Math.round(Math.sqrt(count) / 2));

      for (let i = 0; i < count; i++) {
        if (degree[i] >= 2) {
          hubs.push(i);
        }
      }

      hubs = hubs.sort((a, b) => degree[b] - degree[a] || a - b).slice(0, wanted);
    }

    const queue = new Int32Array(count);
    let tail = 0;

    for (const hub of hubs) {
      owner[hub] = groups.length;
      groups.push([hub]);
      queue[tail++] = hub;
    }

    for (let head = 0; head < tail; head++) {
      const index = queue[head];

      for (let p = adjacencyStart[index]; p < adjacencyStart[index + 1]; p++) {
        const neighbor = adjacency[p];

        if (owner[neighbor] === -1) {
          owner[neighbor] = owner[index];
          groups[owner[index]].push(neighbor);
          queue[tail++] = neighbor;
        }
      }
    }
  }

  // Nodes without a group: join a neighbor's group, else form groups per connected component.
  const queue = new Int32Array(count);

  for (let i = 0; i < count; i++) {
    if (owner[i] !== -1) {
      continue;
    }

    let neighborGroup = -1;

    for (let p = adjacencyStart[i]; p < adjacencyStart[i + 1]; p++) {
      if (owner[adjacency[p]] !== -1) {
        neighborGroup = owner[adjacency[p]];
        break;
      }
    }

    if (neighborGroup !== -1) {
      owner[i] = neighborGroup;
      groups[neighborGroup].push(i);
      continue;
    }

    const group = groups.length;
    let tail = 0;

    groups.push([]);
    owner[i] = group;
    queue[tail++] = i;

    for (let head = 0; head < tail; head++) {
      const index = queue[head];

      groups[group].push(index);

      for (let p = adjacencyStart[index]; p < adjacencyStart[index + 1]; p++) {
        const neighbor = adjacency[p];

        if (owner[neighbor] === -1) {
          owner[neighbor] = group;
          queue[tail++] = neighbor;
        }
      }
    }
  }

  const result: CommunityGroupArrays[] = [];
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
    let typed = -1;

    for (const member of members) {
      if (degree[member] > degree[hub]) {
        hub = member;
      }

      if (typed === -1 && typeRank[types[member]] >= 0) {
        typed = member;
      }
    }

    result.push({ hub: typed === -1 ? hub : typed, members });
  }

  if (loose.length > 0) {
    result.push({ hub: -1, members: loose });
  }

  return result;
}

/**
 * Seeds positions as community stars packed in rows (largest first, centered on the origin): the hub in the middle,
 * members on concentric rings grouped by type and degree. Returns the hubs (kept pinned while the layout settles).
 */
export function seedStarPositions(
  input: GraphTopologyInput,
  topology: GraphTopology,
  positions: Float32Array,
  random: RandomFn,
): number[] {
  const { types, typeNames } = input;
  const { degree } = topology;
  const groups = groupCommunityArrays(input, topology)
    .map((group) => ({ group, extent: ringExtent(group.members.length - (group.hub >= 0 ? 1 : 0)) }))
    .sort((a, b) => b.extent - a.extent);

  if (groups.length === 0) {
    return [];
  }

  const area = groups.reduce((sum, { extent }) => sum + (2 * extent + GROUP_GAP) ** 2, 0);
  const rowWidth = Math.max(2 * groups[0].extent + GROUP_GAP, Math.sqrt(area) * 1.15);
  const placements: { group: CommunityGroupArrays; x: number; y: number }[] = [];
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
    const { group } = placement;
    const cx = placement.x - width / 2;
    const cy = placement.y - height / 2;

    if (group.hub >= 0) {
      positions[group.hub * 2] = cx;
      positions[group.hub * 2 + 1] = cy;
      hubs.push(group.hub);
    }

    const members = group.members
      .filter((member) => member !== group.hub)
      .sort(
        (a, b) =>
          (typeNames[types[a]] ?? '').localeCompare(typeNames[types[b]] ?? '') || degree[b] - degree[a] || a - b,
      );
    let offset = 0;

    for (let ring = 0; offset < members.length; ring++) {
      const { radius, capacity } = ringCapacity(ring);
      const sliceLength = Math.min(capacity, members.length - offset);
      const jitter = (Math.PI * 2) / Math.max(sliceLength * 4, 16);

      for (let i = 0; i < sliceLength; i++) {
        const member = members[offset + i];
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / sliceLength + (random() - 0.5) * jitter;
        const r = radius + (random() - 0.5) * 8;

        positions[member * 2] = cx + Math.cos(angle) * r;
        positions[member * 2 + 1] = cy + Math.sin(angle) * r;
      }

      offset += sliceLength;
    }
  }

  return hubs;
}

/**
 * Places nodes without a known position next to a positioned neighbor (two passes so chains of new nodes still end
 * up near the known part of the graph; the rest around the origin).
 */
export function placeUnknownNodes(
  count: number,
  topology: Pick<GraphTopology, 'adjacencyStart' | 'adjacency'>,
  positions: Float32Array,
  known: Uint8Array,
  random: RandomFn,
): void {
  const placed = known.slice(0, count);

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < count; i++) {
      if (placed[i]) {
        continue;
      }

      let anchor = -1;

      for (let p = topology.adjacencyStart[i]; p < topology.adjacencyStart[i + 1]; p++) {
        if (placed[topology.adjacency[p]]) {
          anchor = topology.adjacency[p];
          break;
        }
      }

      if (anchor !== -1 || pass === 1) {
        const bx = anchor !== -1 ? positions[anchor * 2] : 0;
        const by = anchor !== -1 ? positions[anchor * 2 + 1] : 0;
        const angle = random() * Math.PI * 2;
        const distance = 30 + random() * 40;

        positions[i * 2] = bx + Math.cos(angle) * distance;
        positions[i * 2 + 1] = by + Math.sin(angle) * distance;
        placed[i] = 1;
      }
    }
  }
}

export interface ForceEngineOptions {
  iterations?: number;
  /** Node indices pinned while the layout runs. */
  pinned?: readonly number[];
  random?: RandomFn;
}

const LINK_DISTANCE = 64;
const LINK_STRENGTH = 0.05;
const CHARGE_STRENGTH = -200;
const COLLISION_PADDING = 8;
const CENTER_PULL = 0.0004;
const DAMP = 0.86;
const MAX_STEP = 16;
const CELL_SIZE = 60;
const MAX_REPULSION_DIST2 = CELL_SIZE * CELL_SIZE * 4.5;
const HALF_STENCIL_X = [0, 1, -1, 0, 1];
const HALF_STENCIL_Y = [0, 0, 1, 1, 1];

/**
 * Force-directed settle on typed arrays: linked nodes attract, nearby nodes repel (hashed 60-unit grid, exact cell
 * matching so every pair counts once), overlapping nodes collide. Call {@link ForceEngine.step} until it returns
 * `true`; each tick is O(n + E).
 */
export class ForceEngine {
  readonly iterations: number;
  private iteration = 0;
  private readonly count: number;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly fixed: Uint8Array;
  private readonly springA: Int32Array;
  private readonly springB: Int32Array;
  private readonly random: RandomFn;
  // Hash grid buffers (reused every tick).
  private readonly tableSize: number;
  private readonly bucketStart: Int32Array;
  private readonly bucketNodes: Int32Array;
  private readonly cellX: Int32Array;
  private readonly cellY: Int32Array;

  constructor(
    private readonly positions: Float32Array,
    private readonly radius: Float32Array,
    topology: Pick<GraphTopology, 'adjacencyStart' | 'adjacency'>,
    options: ForceEngineOptions = {},
  ) {
    this.count = radius.length;
    this.iterations = Math.max(0, options.iterations ?? defaultIterations(this.count));
    this.random = options.random ?? seededRandom(1);
    this.vx = new Float32Array(this.count);
    this.vy = new Float32Array(this.count);
    this.fixed = new Uint8Array(this.count);

    for (const index of options.pinned ?? []) {
      if (index >= 0 && index < this.count) {
        this.fixed[index] = 1;
      }
    }

    // Unique undirected springs (each adjacency pair once).
    const springs = topology.adjacency.length / 2;

    this.springA = new Int32Array(springs);
    this.springB = new Int32Array(springs);

    let s = 0;

    for (let i = 0; i < this.count; i++) {
      for (let p = topology.adjacencyStart[i]; p < topology.adjacencyStart[i + 1]; p++) {
        const j = topology.adjacency[p];

        if (i < j) {
          this.springA[s] = i;
          this.springB[s] = j;
          s++;
        }
      }
    }

    let size = 1;

    while (size < this.count * 2) {
      size <<= 1;
    }

    this.tableSize = Math.max(16, size);
    this.bucketStart = new Int32Array(this.tableSize + 1);
    this.bucketNodes = new Int32Array(this.count);
    this.cellX = new Int32Array(this.count);
    this.cellY = new Int32Array(this.count);
  }

  get done(): boolean {
    return this.iteration >= this.iterations || this.count < 2;
  }

  /** 0..1 */
  get progress(): number {
    return this.iterations === 0 ? 1 : Math.min(1, this.iteration / this.iterations);
  }

  /** Runs up to `count` iterations; returns `true` once the layout finished. */
  step(count = 1): boolean {
    for (let i = 0; i < count && !this.done; i++) {
      this.tick();
      this.iteration++;
    }

    return this.done;
  }

  run(): void {
    while (!this.step(10)) {
      // keep stepping
    }
  }

  private hash(cx: number, cy: number): number {
    return (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & (this.tableSize - 1);
  }

  private tick(): void {
    const { positions: pos, vx, vy, count } = this;
    const linear = 1 - this.iteration / Math.max(1, this.iterations);
    const alpha = 0.12 + linear * linear * 0.88;

    vx.fill(0);
    vy.fill(0);
    this.repulsion(alpha);

    const { springA, springB } = this;

    for (let s = 0; s < springA.length; s++) {
      const a = springA[s];
      const b = springB[s];
      const dx = pos[b * 2] - pos[a * 2];
      const dy = pos[b * 2 + 1] - pos[a * 2 + 1];
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const displace = (dist - LINK_DISTANCE) * LINK_STRENGTH * alpha;
      const fx = (dx / dist) * displace;
      const fy = (dy / dist) * displace;

      vx[a] += fx;
      vy[a] += fy;
      vx[b] -= fx;
      vy[b] -= fy;
    }

    for (let i = 0; i < count; i++) {
      if (this.fixed[i]) {
        continue;
      }

      let nx = (vx[i] - pos[i * 2] * CENTER_PULL * alpha) * DAMP;
      let ny = (vy[i] - pos[i * 2 + 1] * CENTER_PULL * alpha) * DAMP;
      const speed = Math.sqrt(nx * nx + ny * ny);

      if (speed > MAX_STEP) {
        nx = (nx / speed) * MAX_STEP;
        ny = (ny / speed) * MAX_STEP;
      }

      pos[i * 2] += nx;
      pos[i * 2 + 1] += ny;
    }
  }

  private repulsion(alpha: number): void {
    const { positions: pos, radius, vx, vy, count, bucketStart, bucketNodes, cellX, cellY } = this;

    bucketStart.fill(0);

    for (let i = 0; i < count; i++) {
      const cx = Math.floor(pos[i * 2] / CELL_SIZE);
      const cy = Math.floor(pos[i * 2 + 1] / CELL_SIZE);

      cellX[i] = cx;
      cellY[i] = cy;
      bucketStart[this.hash(cx, cy) + 1]++;
    }

    for (let b = 0; b < this.tableSize; b++) {
      bucketStart[b + 1] += bucketStart[b];
    }

    const fill = bucketStart.slice(0, this.tableSize);

    for (let i = 0; i < count; i++) {
      bucketNodes[fill[this.hash(cellX[i], cellY[i])]++] = i;
    }

    const charge = CHARGE_STRENGTH * alpha;

    for (let i = 0; i < count; i++) {
      const ax = pos[i * 2];
      const ay = pos[i * 2 + 1];
      const ra = radius[i];
      const cx = cellX[i];
      const cy = cellY[i];

      // Half stencil: the own cell (pairs with j > i) plus 4 forward neighbors, so each pair is visited once.
      for (let s = 0; s < 5; s++) {
        const tx = cx + HALF_STENCIL_X[s];
        const ty = cy + HALF_STENCIL_Y[s];
        const bucket = this.hash(tx, ty);

        {
          for (let p = bucketStart[bucket]; p < bucketStart[bucket + 1]; p++) {
            const j = bucketNodes[p];

            // Colliding hash buckets hold other cells (skipped).
            if ((s === 0 && j <= i) || cellX[j] !== tx || cellY[j] !== ty) {
              continue;
            }

            let dx = pos[j * 2] - ax;
            let dy = pos[j * 2 + 1] - ay;
            let dist2 = dx * dx + dy * dy;

            if (dist2 < 0.01) {
              dx = (this.random() - 0.5) * 0.5;
              dy = (this.random() - 0.5) * 0.5;
              dist2 = dx * dx + dy * dy || 0.01;
            }

            if (dist2 > MAX_REPULSION_DIST2) {
              continue;
            }

            const dist = Math.sqrt(dist2);
            const minDist = ra + radius[j] + COLLISION_PADDING;
            let force = charge / dist2;

            if (dist < minDist) {
              force -= ((minDist - dist) / minDist) * 2.4 * alpha;
            }

            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            vx[i] += fx;
            vy[i] += fy;
            vx[j] -= fx;
            vy[j] -= fy;
          }
        }
      }
    }
  }
}

/** Incremental settle of a mostly known graph (merged pages / neighbors). */
export const INCREMENTAL_ITERATIONS = 40;
/** Share of known positions above which a new document only settles incrementally. */
export const INCREMENTAL_LAYOUT_SHARE = 0.5;

export interface LayoutJobInput extends GraphTopologyInput {
  /** Start positions (x, y interleaved); only entries flagged in `known` are used. */
  positions: Float32Array;
  known: Uint8Array;
  knownCount: number;
  seed: number;
}

/**
 * Prepares a layout: topology, start positions (cached ones kept, new nodes next to known neighbors) or community
 * stars for a mostly unknown graph, and the force engine that settles it.
 */
export function prepareLayout(input: LayoutJobInput): {
  topology: GraphTopology;
  positions: Float32Array;
  engine: ForceEngine;
  fresh: boolean;
} {
  const topology = buildTopology(input);
  const positions = new Float32Array(input.count * 2);
  const random = seededRandom(input.seed);
  const fresh = input.knownCount < input.count * INCREMENTAL_LAYOUT_SHARE;

  if (fresh) {
    const hubs = seedStarPositions(input, topology, positions, random);

    return {
      topology,
      positions,
      engine: new ForceEngine(positions, topology.radius, topology, { pinned: hubs, random }),
      fresh,
    };
  }

  positions.set(input.positions.subarray(0, input.count * 2));
  placeUnknownNodes(input.count, topology, positions, input.known, random);

  return {
    topology,
    positions,
    engine: new ForceEngine(positions, topology.radius, topology, { iterations: INCREMENTAL_ITERATIONS, random }),
    fresh,
  };
}
