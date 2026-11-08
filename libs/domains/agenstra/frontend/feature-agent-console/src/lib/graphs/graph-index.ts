/**
 * Spatial index and level-of-detail pyramid of the viewer (pure typed arrays, built in the layout worker).
 *
 * Level 0 is a uniform grid over the drawn nodes (`order` lists them sorted by cell, so a cell is a contiguous range).
 * Every further level merges 2 × 2 cells of the level below. Each non-empty cell keeps the facts the overview needs to
 * stay meaningful when individual nodes are too many to draw: exact node count, centroid, type composition (heaviest
 * first), the representative (highest degree) node and the aggregated edges to other cells (weight = number of
 * underlying edges, heaviest first). Drawing and hit-testing only touch the cells in view, so the cost of a frame is
 * bounded by the screen size, not by the graph size.
 */

/** Base cell edge in world units (node spacing is ~20, so a base cell holds a handful of nodes). */
export const BASE_CELL_SIZE = 24;
/** Cells per axis at most (larger layouts get larger base cells). */
const MAX_GRID_DIM = 2048;
/** Aggregated edge pairs per level at most (above it the level borrows the edges of a coarser level). */
const MAX_LEVEL_EDGE_PAIRS = 2_000_000;

export interface IndexLevel {
  level: number;
  cellSize: number;
  gridW: number;
  gridH: number;
  /** Row-major keys (`y * gridW + x`) of the non-empty cells, ascending. */
  cells: Int32Array;
  /** First cell of each row (`gridH + 1` entries). */
  rowStart: Int32Array;
  count: Uint32Array;
  cx: Float32Array;
  cy: Float32Array;
  /** Highest degree node of the cell (labels, single-node cells). */
  rep: Int32Array;
  /** Type composition per cell (CSR, heaviest first). */
  typeStart: Int32Array;
  typeCode: Uint16Array;
  typeCount: Uint32Array;
  /** Level 0: first entry of the cell in {@link SceneIndex.order}. */
  nodeStart: Int32Array | null;
  /** Aggregated edges per cell (CSR, both directions, heaviest first); `null` when borrowed from a coarser level. */
  edgeStart: Int32Array | null;
  edgeOther: Int32Array | null;
  edgeWeight: Uint32Array | null;
  maxEdgeWeight: number;
}

export interface SceneIndex {
  originX: number;
  originY: number;
  /** Bounds of the indexed nodes including their radii (`null` when empty). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** Indexed (drawn) nodes sorted by level-0 cell. */
  order: Int32Array;
  /** Edges between indexed nodes. */
  edgeCount: number;
  levels: IndexLevel[];
}

export interface IndexInput {
  count: number;
  positions: Float32Array;
  /** Drawn subset (`1` = indexed); `null` indexes every node. */
  mask: Uint8Array | null;
  types: Uint16Array;
  typeTotal: number;
  degree: Uint32Array;
  radius: Float32Array;
  edgeSource: Int32Array;
  edgeTarget: Int32Array;
}

const EMPTY_LEVEL_ARRAYS = {
  edgeStart: null,
  edgeOther: null,
  edgeWeight: null,
  maxEdgeWeight: 0,
};

/** Builds the pyramid for the masked nodes in O(n log n + L · E log E). */
export function buildSceneIndex(input: IndexInput): SceneIndex {
  const { count, positions, mask, typeTotal, degree } = input;
  let size = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  for (let i = 0; i < count; i++) {
    if (mask && !mask[i]) {
      continue;
    }

    const x = positions[i * 2];
    const y = positions[i * 2 + 1];
    const r = input.radius[i] ?? 0;

    size++;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    bounds.minX = Math.min(bounds.minX, x - r);
    bounds.minY = Math.min(bounds.minY, y - r);
    bounds.maxX = Math.max(bounds.maxX, x + r);
    bounds.maxY = Math.max(bounds.maxY, y + r);
  }

  if (size === 0) {
    return { originX: 0, originY: 0, bounds: null, order: new Int32Array(0), edgeCount: 0, levels: [] };
  }

  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const cellSize = Math.max(BASE_CELL_SIZE, extent / (MAX_GRID_DIM - 1));
  const gridW = Math.floor((maxX - minX) / cellSize) + 1;
  const gridH = Math.floor((maxY - minY) / cellSize) + 1;
  const packed = new Float64Array(size);
  let p = 0;

  for (let i = 0; i < count; i++) {
    if (mask && !mask[i]) {
      continue;
    }

    const x = Math.min(gridW - 1, Math.floor((positions[i * 2] - minX) / cellSize));
    const y = Math.min(gridH - 1, Math.floor((positions[i * 2 + 1] - minY) / cellSize));

    packed[p++] = (y * gridW + x) * count + i;
  }

  packed.sort();

  const order = new Int32Array(size);
  const nodeCell = new Int32Array(count).fill(-1);
  const cellKeys: number[] = [];
  const nodeStarts: number[] = [];

  for (let k = 0; k < size; k++) {
    const key = Math.floor(packed[k] / count);
    const node = packed[k] - key * count;

    order[k] = node;

    if (k === 0 || key !== cellKeys[cellKeys.length - 1]) {
      cellKeys.push(key);
      nodeStarts.push(k);
    }

    nodeCell[node] = cellKeys.length - 1;
  }

  const base = baseLevel(input, order, cellKeys, nodeStarts, gridW, gridH, cellSize, typeTotal);
  const levels: IndexLevel[] = [base];
  const cellMaps: Int32Array[] = [];

  while (levels[levels.length - 1].gridW > 1 || levels[levels.length - 1].gridH > 1) {
    const { level, childToParent } = parentLevel(levels[levels.length - 1], degree, typeTotal);

    levels.push(level);
    cellMaps.push(childToParent);
  }

  const edgeCount = aggregateEdges(input, levels, cellMaps, nodeCell);

  return { originX: minX, originY: minY, bounds, order, edgeCount, levels };
}

function rowStarts(cells: ArrayLike<number>, gridW: number, gridH: number): Int32Array {
  const rowStart = new Int32Array(gridH + 1);
  let c = 0;

  for (let row = 0; row <= gridH; row++) {
    while (c < cells.length && Math.floor(cells[c] / gridW) < row) {
      c++;
    }

    rowStart[row] = c;
  }

  return rowStart;
}

/** Collects the type histogram of a cell (dense scratch) into CSR arrays, heaviest first. */
class TypeAccumulator {
  private readonly scratch: Uint32Array;
  private readonly touched: number[] = [];
  readonly starts: number[] = [0];
  readonly codes: number[] = [];
  readonly counts: number[] = [];

  constructor(typeTotal: number) {
    this.scratch = new Uint32Array(Math.max(1, typeTotal));
  }

  add(code: number, amount: number): void {
    if (this.scratch[code] === 0) {
      this.touched.push(code);
    }

    this.scratch[code] += amount;
  }

  flush(): void {
    this.touched.sort((a, b) => this.scratch[b] - this.scratch[a] || a - b);

    for (const code of this.touched) {
      this.codes.push(code);
      this.counts.push(this.scratch[code]);
      this.scratch[code] = 0;
    }

    this.touched.length = 0;
    this.starts.push(this.codes.length);
  }
}

function baseLevel(
  input: IndexInput,
  order: Int32Array,
  cellKeys: number[],
  nodeStarts: number[],
  gridW: number,
  gridH: number,
  cellSize: number,
  typeTotal: number,
): IndexLevel {
  const { positions, types, degree } = input;
  const cellTotal = cellKeys.length;
  const count = new Uint32Array(cellTotal);
  const cx = new Float32Array(cellTotal);
  const cy = new Float32Array(cellTotal);
  const rep = new Int32Array(cellTotal);
  const nodeStart = new Int32Array(cellTotal + 1);
  const typeAcc = new TypeAccumulator(typeTotal);

  for (let c = 0; c < cellTotal; c++) {
    const start = nodeStarts[c];
    const end = c + 1 < cellTotal ? nodeStarts[c + 1] : order.length;
    let sx = 0;
    let sy = 0;
    let best = order[start];

    for (let k = start; k < end; k++) {
      const node = order[k];

      sx += positions[node * 2];
      sy += positions[node * 2 + 1];
      typeAcc.add(types[node], 1);

      if (degree[node] > degree[best] || (degree[node] === degree[best] && node < best)) {
        best = node;
      }
    }

    typeAcc.flush();
    count[c] = end - start;
    cx[c] = sx / (end - start);
    cy[c] = sy / (end - start);
    rep[c] = best;
    nodeStart[c] = start;
  }

  nodeStart[cellTotal] = order.length;

  const cells = Int32Array.from(cellKeys);

  return {
    level: 0,
    cellSize,
    gridW,
    gridH,
    cells,
    rowStart: rowStarts(cells, gridW, gridH),
    count,
    cx,
    cy,
    rep,
    typeStart: Int32Array.from(typeAcc.starts),
    typeCode: Uint16Array.from(typeAcc.codes),
    typeCount: Uint32Array.from(typeAcc.counts),
    nodeStart,
    ...EMPTY_LEVEL_ARRAYS,
  };
}

function parentLevel(
  child: IndexLevel,
  degree: Uint32Array,
  typeTotal: number,
): { level: IndexLevel; childToParent: Int32Array } {
  const gridW = Math.ceil(child.gridW / 2);
  const gridH = Math.ceil(child.gridH / 2);
  const childTotal = child.cells.length;
  const packed = new Float64Array(childTotal);

  for (let c = 0; c < childTotal; c++) {
    const key = child.cells[c];
    const x = key % child.gridW;
    const y = Math.floor(key / child.gridW);

    packed[c] = ((y >> 1) * gridW + (x >> 1)) * childTotal + c;
  }

  packed.sort();

  const childToParent = new Int32Array(childTotal);
  const keys: number[] = [];
  const counts: number[] = [];
  const cxs: number[] = [];
  const cys: number[] = [];
  const reps: number[] = [];
  const typeAcc = new TypeAccumulator(typeTotal);
  let current = -1;
  let total = 0;
  let sx = 0;
  let sy = 0;
  let best = -1;
  const flush = () => {
    if (current < 0) {
      return;
    }

    keys.push(current);
    counts.push(total);
    cxs.push(sx / total);
    cys.push(sy / total);
    reps.push(best);
    typeAcc.flush();
  };

  for (let k = 0; k < childTotal; k++) {
    const key = Math.floor(packed[k] / childTotal);
    const c = packed[k] - key * childTotal;

    if (key !== current) {
      flush();
      current = key;
      total = 0;
      sx = 0;
      sy = 0;
      best = -1;
    }

    const n = child.count[c];

    childToParent[c] = keys.length;
    total += n;
    sx += child.cx[c] * n;
    sy += child.cy[c] * n;

    const candidate = child.rep[c];

    if (best < 0 || degree[candidate] > degree[best] || (degree[candidate] === degree[best] && candidate < best)) {
      best = candidate;
    }

    for (let t = child.typeStart[c]; t < child.typeStart[c + 1]; t++) {
      typeAcc.add(child.typeCode[t], child.typeCount[t]);
    }
  }

  flush();

  const cells = Int32Array.from(keys);

  return {
    level: {
      level: child.level + 1,
      cellSize: child.cellSize * 2,
      gridW,
      gridH,
      cells,
      rowStart: rowStarts(cells, gridW, gridH),
      count: Uint32Array.from(counts),
      cx: Float32Array.from(cxs),
      cy: Float32Array.from(cys),
      rep: Int32Array.from(reps),
      typeStart: Int32Array.from(typeAcc.starts),
      typeCode: Uint16Array.from(typeAcc.codes),
      typeCount: Uint32Array.from(typeAcc.counts),
      nodeStart: null,
      ...EMPTY_LEVEL_ARRAYS,
    },
    childToParent,
  };
}

/** Aggregates the edges between indexed nodes per level; returns how many edges were indexed. */
function aggregateEdges(input: IndexInput, levels: IndexLevel[], cellMaps: Int32Array[], nodeCell: Int32Array): number {
  const { edgeSource, edgeTarget } = input;
  const edges: number[] = [];

  for (let e = 0; e < edgeSource.length; e++) {
    if (nodeCell[edgeSource[e]] >= 0 && nodeCell[edgeTarget[e]] >= 0) {
      edges.push(e);
    }
  }

  // Cell of each endpoint at the current level (walks up the pyramid).
  const sourceCell = new Int32Array(edges.length);
  const targetCell = new Int32Array(edges.length);

  for (let k = 0; k < edges.length; k++) {
    sourceCell[k] = nodeCell[edgeSource[edges[k]]];
    targetCell[k] = nodeCell[edgeTarget[edges[k]]];
  }

  for (let l = 0; l < levels.length; l++) {
    if (l > 0) {
      const map = cellMaps[l - 1];

      for (let k = 0; k < edges.length; k++) {
        sourceCell[k] = map[sourceCell[k]];
        targetCell[k] = map[targetCell[k]];
      }
    }

    const level = levels[l];
    const cellTotal = level.cells.length;
    const keys = new Float64Array(edges.length);
    let used = 0;

    for (let k = 0; k < edges.length; k++) {
      const a = sourceCell[k];
      const b = targetCell[k];

      if (a !== b) {
        keys[used++] = a < b ? a * cellTotal + b : b * cellTotal + a;
      }
    }

    const sorted = keys.subarray(0, used).sort();
    // Unique pairs with weights.
    const pairA: number[] = [];
    const pairB: number[] = [];
    const pairW: number[] = [];

    for (let k = 0; k < used; k++) {
      if (k > 0 && sorted[k] === sorted[k - 1]) {
        pairW[pairW.length - 1]++;
        continue;
      }

      const a = Math.floor(sorted[k] / cellTotal);

      pairA.push(a);
      pairB.push(sorted[k] - a * cellTotal);
      pairW.push(1);
    }

    if (pairA.length > MAX_LEVEL_EDGE_PAIRS) {
      continue;
    }

    const edgeStart = new Int32Array(cellTotal + 1);

    for (let k = 0; k < pairA.length; k++) {
      edgeStart[pairA[k] + 1]++;
      edgeStart[pairB[k] + 1]++;
    }

    for (let c = 0; c < cellTotal; c++) {
      edgeStart[c + 1] += edgeStart[c];
    }

    const edgeOther = new Int32Array(edgeStart[cellTotal]);
    const edgeWeight = new Uint32Array(edgeStart[cellTotal]);
    const fill = edgeStart.slice(0, cellTotal);
    let maxWeight = 0;

    for (let k = 0; k < pairA.length; k++) {
      edgeOther[fill[pairA[k]]] = pairB[k];
      edgeWeight[fill[pairA[k]]++] = pairW[k];
      edgeOther[fill[pairB[k]]] = pairA[k];
      edgeWeight[fill[pairB[k]]++] = pairW[k];
      maxWeight = Math.max(maxWeight, pairW[k]);
    }

    sortSegmentsByWeight(edgeStart, edgeOther, edgeWeight);
    level.edgeStart = edgeStart;
    level.edgeOther = edgeOther;
    level.edgeWeight = edgeWeight;
    level.maxEdgeWeight = maxWeight;
  }

  return edges.length;
}

/** Sorts every cell's edge segment by weight (heaviest first, then by other cell). */
function sortSegmentsByWeight(start: Int32Array, other: Int32Array, weight: Uint32Array): void {
  const indices: number[] = [];

  for (let c = 0; c + 1 < start.length; c++) {
    const from = start[c];
    const to = start[c + 1];

    if (to - from < 2) {
      continue;
    }

    indices.length = 0;

    for (let k = from; k < to; k++) {
      indices.push(k);
    }

    indices.sort((a, b) => weight[b] - weight[a] || other[a] - other[b]);

    const others = indices.map((k) => other[k]);
    const weights = indices.map((k) => weight[k]);

    for (let k = 0; k < others.length; k++) {
      other[from + k] = others[k];
      weight[from + k] = weights[k];
    }
  }
}

/** Every buffer of an index (transfer list for `postMessage`). */
export function sceneIndexBuffers(index: SceneIndex): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>([index.order.buffer as ArrayBuffer]);

  for (const level of index.levels) {
    for (const array of [
      level.cells,
      level.rowStart,
      level.count,
      level.cx,
      level.cy,
      level.rep,
      level.typeStart,
      level.typeCode,
      level.typeCount,
      level.nodeStart,
      level.edgeStart,
      level.edgeOther,
      level.edgeWeight,
    ]) {
      if (array) {
        buffers.add(array.buffer as ArrayBuffer);
      }
    }
  }

  return [...buffers];
}

/** Level whose cells are at least `minCellPx` wide on screen at zoom `k` (the coarsest one if none is). */
export function levelForZoom(index: SceneIndex, k: number, minCellPx: number): IndexLevel | null {
  for (const level of index.levels) {
    if (level.cellSize * k >= minCellPx) {
      return level;
    }
  }

  return index.levels[index.levels.length - 1] ?? null;
}

/**
 * Visits the non-empty cells of `level` that intersect the world rectangle (row by row, binary search per row).
 * Stops early when `visit` returns `false`.
 */
export function forEachCellInRect(
  index: SceneIndex,
  level: IndexLevel,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (cell: number) => boolean | void,
): void {
  const size = level.cellSize;
  const cx0 = Math.max(0, Math.floor((x0 - index.originX) / size));
  const cy0 = Math.max(0, Math.floor((y0 - index.originY) / size));
  const cx1 = Math.min(level.gridW - 1, Math.floor((x1 - index.originX) / size));
  const cy1 = Math.min(level.gridH - 1, Math.floor((y1 - index.originY) / size));

  if (cx0 > cx1 || cy0 > cy1) {
    return;
  }

  const { cells, rowStart, gridW } = level;

  for (let row = cy0; row <= cy1; row++) {
    let lo = rowStart[row];
    let hi = rowStart[row + 1];
    const first = row * gridW + cx0;
    const last = row * gridW + cx1;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;

      if (cells[mid] < first) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    for (let c = lo; c < rowStart[row + 1] && cells[c] <= last; c++) {
      if (visit(c) === false) {
        return;
      }
    }
  }
}

/** Cell of `level` that contains the world point, `-1` when that cell is empty. */
export function cellAt(index: SceneIndex, level: IndexLevel, x: number, y: number): number {
  let hit = -1;

  forEachCellInRect(index, level, x, y, x, y, (cell) => {
    hit = cell;

    return false;
  });

  return hit;
}

/** World rectangle of a cell. */
export function cellBounds(
  index: SceneIndex,
  level: IndexLevel,
  cell: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const key = level.cells[cell];
  const x = key % level.gridW;
  const y = Math.floor(key / level.gridW);
  const minX = index.originX + x * level.cellSize;
  const minY = index.originY + y * level.cellSize;

  return { minX, minY, maxX: minX + level.cellSize, maxY: minY + level.cellSize };
}
