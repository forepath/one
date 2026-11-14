/**
 * Canvas 2D renderer of the graph viewer with level of detail. A frame draws either
 *
 * - **detail**: the individual nodes in view (within the node budget), their edges, rings and labels, or
 * - **overview**: the cells of the index level that fits the zoom. Each cell shows how many nodes it holds (disk size
 *   relative to the largest cell in view), what they are (type slices, heaviest first) and how strongly it connects to
 *   other cells (aggregated edges: opacity by the number of underlying edges). Hovering a cell lists its composition,
 *   clicking zooms into it.
 *
 * A frame only touches what is in view, draws in screen space with lines clipped to the viewport, and stays within
 * budgets. The grouping (node budget, overview level) depends on zoom and data only; the edge and label budgets adapt
 * to the measured frame time of the device and are restored by a complete frame once the view rests. So a frame costs about the same
 * for a thousand or millions of nodes, on fast and slow machines. Selection, search matches and the hovered node are
 * always drawn at their real position.
 */
import type { GraphTopology } from './graph-engine';
import { cellBounds, forEachCellInRect, levelForZoom, type IndexLevel, type SceneIndex } from './graph-index';
import { screenRadiusPx, type ViewTransform } from './graph-layout';
import type { GraphSnapshot } from './graph-model';

/** Individual nodes drawn per frame at most; more in view switches to the overview (fixed: never adapted). */
export const NODE_BUDGET = 12_000;
/** A view this many times over the node budget switches to the overview even while panning. */
const SAFETY_FACTOR = 4;

/** Overview cells are at least this wide on screen. */
export const OVERVIEW_CELL_PX = 12;
/** Lines drawn per frame at most (at budget scale 1). */
export const EDGE_DRAW_BUDGET = 30_000;
/** On-screen line length drawn per frame at most (CSS pixels at budget scale 1): raster cost grows with length. */
export const EDGE_PIXEL_BUDGET = 3_000_000;
/** Edge entries inspected per frame at most (keeps hubs with huge degrees bounded). */
export const EDGE_SCAN_BUDGET = 250_000;
/** Up to this many indexed edges, detail frames test every edge against the view (also edges just passing through). */
export const FULL_EDGE_SCAN_LIMIT = 200_000;
/** Most labels drawn per frame (at budget scale 1). */
export const MAX_LABELS = 400;
/** Frame time the adaptive budgets aim for (milliseconds). */
export const TARGET_FRAME_MS = 14;
/** Budget scale range (1 = the budgets above). */
const MIN_BUDGET_SCALE = 0.1;
const MAX_BUDGET_SCALE = 2;
/** Overview labels (representatives of the largest cells). */
const MAX_OVERVIEW_LABELS = 60;
/** Type slices per overview cell at most (the rest is one neutral slice). */
const MAX_SLICES = 4;
/** Disks up to this radius (px) are drawn as squares (indistinguishable at that size, much cheaper). */
const SQUARE_RADIUS_PX = 2.5;
/** Overview cells get type slices from this radius (px) on. */
const SLICE_RADIUS_PX = 6;
/** Opacity of the four aggregated edge weight classes. */
const OVERVIEW_EDGE_ALPHA = [0.1, 0.2, 0.34, 0.55];
const LABEL_FONT = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
const FULL = Math.PI * 2;

/** Everything a frame is drawn from (swapped atomically when a layout / index finishes). */
export interface GraphScene {
  snapshot: GraphSnapshot;
  positions: Float32Array;
  topology: GraphTopology;
  /** Index over every node. */
  index: SceneIndex;
}

export interface GraphPalette {
  background: string;
  text: string;
  edge: string;
  emphasis: string;
  selection: string;
  match: string;
  /** Neutral color (unknown types, rest slices). */
  fallback: string;
  /** Color per type code of the scene snapshot. */
  types: readonly string[];
}

export type HoverTarget = { kind: 'node'; index: number } | { kind: 'cell'; level: number; cell: number };

export interface RenderState {
  /** Index drawn from: built for the drawn subset ({@link visible}), or the scene index while that one is pending. */
  index: SceneIndex;
  transform: ViewTransform;
  width: number;
  height: number;
  dpr: number;
  palette: GraphPalette;
  /** Drawn subset (type filters and selection neighborhood); `null` draws every node. */
  visible: Uint8Array | null;
  /** A selection neighborhood is shown (its edges are emphasized). */
  focusActive: boolean;
  /** Size of the selection neighborhood (labels for all of it when small). */
  focusSize: number;
  focus: Uint8Array | null;
  selected: number;
  hover: HoverTarget | null;
  highlighted: readonly number[];
  showLabels: boolean;
  /** Nodes moved (dragged) since the index was built; drawn from their positions, not from their old cell. */
  moved: readonly number[];
  movedMask: Uint8Array | null;
}

export interface FrameInfo {
  mode: 'empty' | 'detail' | 'overview';
  /** Index level of an overview frame. */
  level: number;
  nodes: number;
  cells: number;
  edges: number;
  labels: number;
  /** Largest cell count in view (overview disk scale). */
  maxCount: number;
  /** Budget scale the frame was drawn with. */
  budgetScale: number;
  /** Milliseconds the frame commands took. */
  ms: number;
}

/** Overview disk radius in screen pixels. */
export function overviewRadius(count: number, maxCount: number, cellPx: number): number {
  const max = Math.max(3, cellPx * 0.6);
  const min = Math.min(max, 2.5);

  return min + (max - min) * Math.sqrt(count / Math.max(1, maxCount));
}

/**
 * Clips the segment to the rectangle (Liang–Barsky). Writes the clipped end points to `out` and returns `false` when
 * nothing of it is inside.
 */
export function clipSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  out: Float64Array,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;

  // One boundary at a time: p = direction towards the outside, q = distance to the boundary.
  for (let side = 0; side < 4; side++) {
    const p = side === 0 ? -dx : side === 1 ? dx : side === 2 ? -dy : dy;
    const q = side === 0 ? ax - x0 : side === 1 ? x1 - ax : side === 2 ? ay - y0 : y1 - ay;

    if (p === 0) {
      if (q < 0) {
        return false;
      }

      continue;
    }

    const t = q / p;

    if (p < 0) {
      if (t > t1) {
        return false;
      }

      t0 = Math.max(t0, t);
    } else {
      if (t < t0) {
        return false;
      }

      t1 = Math.min(t1, t);
    }
  }

  out[0] = ax + t0 * dx;
  out[1] = ay + t0 * dy;
  out[2] = ax + t1 * dx;
  out[3] = ay + t1 * dy;

  return true;
}

interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const EMPTY_FRAME: FrameInfo = {
  mode: 'empty',
  level: 0,
  nodes: 0,
  cells: 0,
  edges: 0,
  labels: 0,
  maxCount: 0,
  budgetScale: 1,
  ms: 0,
};

export class GraphRenderer {
  private nodeBuffer = new Int32Array(1024);
  private inView = new Uint8Array(0);
  private readonly clip = new Float64Array(4);
  private frame: FrameInfo = EMPTY_FRAME;
  /** Adaptive budget scale (feedback from the measured frame time; edges and labels only). */
  private scale = 1;
  /** View of the previous frame (frames of an unchanged view are drawn complete). */
  private lastView: (ViewTransform & { width: number; height: number }) | null = null;
  /** Mode chosen for the current zoom / index / subset (kept while panning). */
  private decision: { index: SceneIndex; k: number; visible: Uint8Array | null; mode: 'detail' | 'overview' } | null =
    null;

  /** @param adaptive Scale the budgets by the measured frame time (off in tests for deterministic frames). */
  constructor(private readonly adaptive = true) {}

  get lastFrame(): FrameInfo {
    return this.frame;
  }

  get budgetScale(): number {
    return this.scale;
  }

  /**
   * @param latencyMs Time from requesting this frame to drawing it: includes raster / compositing of the previous
   *   frames, which the canvas does after `draw` returns (the budgets adapt to the larger of both).
   * @param refine Idle refinement: draws with at least the full budgets and does not adapt (the view rests, so one
   *   complete frame is worth its cost after interaction frames were drawn with reduced budgets).
   */
  draw(
    ctx: CanvasRenderingContext2D,
    scene: GraphScene | null,
    state: RenderState,
    latencyMs = 0,
    refine = false,
  ): FrameInfo {
    const started = now();
    const adapted = this.scale;
    const { palette, dpr, width, height } = state;
    const previous = this.lastView;
    const moving =
      !previous ||
      previous.x !== state.transform.x ||
      previous.y !== state.transform.y ||
      previous.k !== state.transform.k ||
      previous.width !== width ||
      previous.height !== height;

    this.lastView = { ...state.transform, width, height };

    // Only frames of a moving view may thin edges and labels: a redraw of a resting view (selection, filters, new
    // data) is always complete, so nothing appears or disappears without the view changing.
    if (refine || !moving) {
      refine = true;
      this.scale = Math.max(1, adapted);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, Math.ceil(width * dpr), Math.ceil(height * dpr));

    if (!scene || state.index.levels.length === 0) {
      this.frame = EMPTY_FRAME;
      this.scale = adapted;

      return this.frame;
    }

    // Everything is drawn in screen space (CSS pixels).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { x: tx, y: ty, k } = state.transform;
    const margin = 20 / k;
    const rect: ViewRect = {
      x0: -tx / k - margin,
      y0: -ty / k - margin,
      x1: (width - tx) / k + margin,
      y1: (height - ty) / k + margin,
    };
    // What is grouped depends on zoom and data only (never on the adaptive budgets): the overview level and the
    // switch between nodes and cells stay put while the view does. The hysteresis keeps the switch from flickering
    // around the threshold while zooming.
    const level = levelForZoom(state.index, k, OVERVIEW_CELL_PX) as IndexLevel;
    const limit = this.frame.mode === 'overview' ? NODE_BUDGET * 0.8 : NODE_BUDGET * 1.2;
    const decided = this.decision;
    const sameView = !!decided && decided.index === state.index && decided.k === k && decided.visible === state.visible;
    let estimate = 0;

    forEachCellInRect(state.index, level, rect.x0, rect.y0, rect.x1, rect.y1, (cell) => {
      estimate += level.count[cell];

      return estimate <= NODE_BUDGET * SAFETY_FACTOR;
    });

    // Panning keeps the mode chosen for this zoom (only a view far over the budget forces the overview).
    const detail =
      decided && sameView && estimate <= NODE_BUDGET * SAFETY_FACTOR ? decided.mode === 'detail' : estimate <= limit;

    this.decision = { index: state.index, k, visible: state.visible, mode: detail ? 'detail' : 'overview' };

    const frame = detail ? this.drawDetail(ctx, scene, state, rect) : this.drawOverview(ctx, scene, state, rect, level);

    this.drawMarks(ctx, scene, state, rect, frame.mode === 'overview');

    const ms = now() - started;

    this.frame = { ...frame, budgetScale: this.scale, ms };

    if (refine) {
      this.scale = adapted;
    } else {
      // A frame request waits one display refresh anyway.
      this.adapt(Math.max(ms, latencyMs - 17));
    }

    return this.frame;
  }

  /** Closest node (detail frames) or cell (overview frames) under a screen point. */
  hitTest(scene: GraphScene | null, state: RenderState, sx: number, sy: number, minPx = 6): HoverTarget | null {
    const index = state.index;

    if (!scene || index.levels.length === 0) {
      return null;
    }

    const { x: tx, y: ty, k } = state.transform;
    const wx = (sx - tx) / k;
    const wy = (sy - ty) / k;

    if (this.frame.mode === 'overview') {
      const level = index.levels[Math.min(this.frame.level, index.levels.length - 1)];
      const cellPx = level.cellSize * k;
      const reach = (cellPx * 0.6 + 4) / k;
      let best: HoverTarget | null = null;
      let bestD2 = Infinity;

      forEachCellInRect(index, level, wx - reach, wy - reach, wx + reach, wy + reach, (cell) => {
        const dx = (level.cx[cell] - wx) * k;
        const dy = (level.cy[cell] - wy) * k;
        const d2 = dx * dx + dy * dy;
        const r = Math.max(minPx, overviewRadius(level.count[cell], this.frame.maxCount, cellPx) + 2);

        if (d2 <= r * r && d2 < bestD2) {
          bestD2 = d2;
          best =
            level.count[cell] === 1
              ? { kind: 'node', index: level.rep[cell] }
              : { kind: 'cell', level: level.level, cell };
        }
      });

      return best;
    }

    const { positions, topology } = scene;
    const reach = (18 + 2 + minPx) / k;
    let hit = -1;
    let bestD2 = Infinity;
    const consider = (node: number) => {
      if (state.visible && !state.visible[node]) {
        return;
      }

      const dx = (positions[node * 2] - wx) * k;
      const dy = (positions[node * 2 + 1] - wy) * k;
      const d2 = dx * dx + dy * dy;
      const r = Math.max(minPx, screenRadiusPx(topology.radius[node], k) + 2);

      if (d2 <= r * r && d2 < bestD2) {
        bestD2 = d2;
        hit = node;
      }
    };
    const level0 = index.levels[0];
    const nodeStart = level0.nodeStart as Int32Array;

    forEachCellInRect(index, level0, wx - reach, wy - reach, wx + reach, wy + reach, (cell) => {
      for (let p = nodeStart[cell]; p < nodeStart[cell + 1]; p++) {
        const node = index.order[p];

        if (!state.movedMask?.[node]) {
          consider(node);
        }
      }
    });
    state.moved.forEach(consider);

    return hit >= 0 ? { kind: 'node', index: hit } : null;
  }

  /**
   * Draws the hovered node or cell on the overlay canvas (above the graph). Hovering never redraws the graph itself,
   * so it cannot change what the graph shows.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, scene: GraphScene | null, state: RenderState): void {
    const { dpr, width, height, hover, palette } = state;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, Math.ceil(width * dpr), Math.ceil(height * dpr));

    if (!scene || !hover || this.frame.mode === 'empty') {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;

    const { x: tx, y: ty, k } = state.transform;

    if (hover.kind === 'cell') {
      const level = state.index.levels[hover.level];

      if (!level || this.frame.mode !== 'overview' || hover.level !== this.frame.level) {
        return;
      }

      ctx.strokeStyle = palette.emphasis;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(
        level.cx[hover.cell] * k + tx,
        level.cy[hover.cell] * k + ty,
        overviewRadius(level.count[hover.cell], this.frame.maxCount, level.cellSize * k) + 3,
        0,
        FULL,
      );
      ctx.stroke();

      return;
    }

    const { positions, topology, snapshot } = scene;
    const node = hover.index;

    if (node < 0 || node >= snapshot.count) {
      return;
    }

    const x = positions[node * 2] * k + tx;
    const y = positions[node * 2 + 1] * k + ty;
    const r = screenRadiusPx(topology.radius[node], k);

    // In the overview the node itself sits inside a cell: draw it on top.
    if (this.frame.mode === 'overview') {
      ctx.fillStyle = palette.types[snapshot.types[node]] ?? palette.fallback;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, FULL);
      ctx.fill();
    }

    ctx.strokeStyle = palette.emphasis;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, FULL);
    ctx.stroke();

    if (state.showLabels) {
      this.drawLabelList(
        ctx,
        state,
        [{ text: nodeLabel(snapshot, node), x: positions[node * 2], y: positions[node * 2 + 1], offset: r + 4 }],
        1,
        1,
      );
    }
  }

  /** World bounds of an overview cell (click to zoom in). */
  cellBounds(index: SceneIndex, level: number, cell: number) {
    return cellBounds(index, index.levels[level], cell);
  }

  /** Node count and type composition of an overview cell. */
  cellSummary(
    snapshot: GraphSnapshot,
    index: SceneIndex,
    level: number,
    cell: number,
  ): { count: number; types: { type: string; count: number }[] } {
    const data = index.levels[level];
    const types: { type: string; count: number }[] = [];

    for (let t = data.typeStart[cell]; t < data.typeStart[cell + 1]; t++) {
      types.push({ type: snapshot.typeNames[data.typeCode[t]] ?? '', count: data.typeCount[t] });
    }

    return { count: data.count[cell], types };
  }

  /** Scales the budgets towards {@link TARGET_FRAME_MS}. */
  private adapt(ms: number): void {
    if (!this.adaptive) {
      return;
    }

    if (ms > TARGET_FRAME_MS * 1.3) {
      this.scale = Math.max(MIN_BUDGET_SCALE, this.scale * Math.max(0.5, TARGET_FRAME_MS / ms));
    } else if (ms < TARGET_FRAME_MS * 0.5) {
      this.scale = Math.min(MAX_BUDGET_SCALE, this.scale * 1.15);
    }
  }

  // Detail frames

  private collectNodes(scene: GraphScene, state: RenderState, rect: ViewRect): number {
    const { positions } = scene;
    const index = state.index;
    const level0 = index.levels[0];
    const nodeStart = level0.nodeStart as Int32Array;
    const visible = state.visible;
    const moved = state.movedMask;
    let total = 0;
    const push = (node: number) => {
      const x = positions[node * 2];
      const y = positions[node * 2 + 1];

      if (x < rect.x0 || x > rect.x1 || y < rect.y0 || y > rect.y1 || (visible && !visible[node])) {
        return;
      }

      if (total === this.nodeBuffer.length) {
        const next = new Int32Array(this.nodeBuffer.length * 2);

        next.set(this.nodeBuffer);
        this.nodeBuffer = next;
      }

      this.nodeBuffer[total++] = node;
    };

    forEachCellInRect(index, level0, rect.x0, rect.y0, rect.x1, rect.y1, (cell) => {
      for (let p = nodeStart[cell]; p < nodeStart[cell + 1]; p++) {
        const node = index.order[p];

        if (!moved?.[node]) {
          push(node);
        }
      }
    });
    state.moved.forEach(push);

    return total;
  }

  private drawDetail(
    ctx: CanvasRenderingContext2D,
    scene: GraphScene,
    state: RenderState,
    rect: ViewRect,
  ): Omit<FrameInfo, 'budgetScale' | 'ms'> {
    const { positions, topology, snapshot } = scene;
    const { palette } = state;
    const { x: tx, y: ty, k } = state.transform;
    const total = this.collectNodes(scene, state, rect);
    const nodes = this.nodeBuffer;

    if (this.inView.length < snapshot.count) {
      this.inView = new Uint8Array(snapshot.count);
    }

    for (let n = 0; n < total; n++) {
      this.inView[nodes[n]] = 1;
    }

    const edges = this.drawDetailEdges(ctx, scene, state, rect, total);
    // Nodes: grouped per type (one path of disks, small ones as squares).
    const byType: number[][] = palette.types.map(() => []);
    const missing: number[] = [];

    for (let n = 0; n < total; n++) {
      const node = nodes[n];

      if (snapshot.missing[node]) {
        missing.push(node);
      } else {
        (byType[snapshot.types[node]] ??= []).push(node);
      }
    }

    ctx.globalAlpha = 1;
    byType.forEach((list, code) => {
      if (list.length > 0) {
        this.fillDisks(
          ctx,
          palette.types[code] ?? palette.fallback,
          list.length,
          (i) => positions[list[i] * 2] * k + tx,
          (i) => positions[list[i] * 2 + 1] * k + ty,
          (i) => screenRadiusPx(topology.radius[list[i]], k),
        );
      }
    });

    // Reference targets that no longer exist (prompt history of deleted files): faded with a dashed outline.
    if (missing.length > 0) {
      ctx.setLineDash([3, 2]);
      ctx.lineWidth = 1;

      for (const node of missing) {
        const color = palette.types[snapshot.types[node]] ?? palette.fallback;
        const x = positions[node * 2] * k + tx;
        const y = positions[node * 2 + 1] * k + ty;
        const r = screenRadiusPx(topology.radius[node], k);

        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, FULL);
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 0.75;
        ctx.stroke();
      }

      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    const labels = state.showLabels ? this.drawDetailLabels(ctx, scene, state, total) : 0;

    for (let n = 0; n < total; n++) {
      this.inView[nodes[n]] = 0;
    }

    return { mode: 'detail', level: 0, nodes: total, cells: 0, edges, labels, maxCount: 0 };
  }

  /** Disks in screen space; radii up to {@link SQUARE_RADIUS_PX} as squares. */
  private fillDisks(
    ctx: CanvasRenderingContext2D,
    color: string,
    count: number,
    x: (i: number) => number,
    y: (i: number) => number,
    r: (i: number) => number,
  ): void {
    ctx.fillStyle = color;
    ctx.beginPath();

    for (let i = 0; i < count; i++) {
      const radius = r(i);
      const cx = x(i);
      const cy = y(i);

      if (radius <= SQUARE_RADIUS_PX) {
        ctx.rect(cx - radius, cy - radius, radius * 2, radius * 2);
      } else {
        ctx.moveTo(cx + radius, cy);
        ctx.arc(cx, cy, radius, 0, FULL);
      }
    }

    ctx.fill();
  }

  private drawDetailEdges(
    ctx: CanvasRenderingContext2D,
    scene: GraphScene,
    state: RenderState,
    rect: ViewRect,
    total: number,
  ): number {
    const { positions, topology, snapshot } = scene;
    const { palette, visible, index, width, height } = state;
    const { x: tx, y: ty, k } = state.transform;
    const source = snapshot.edgeSource;
    const target = snapshot.edgeTarget;
    const budget = Math.max(1000, EDGE_DRAW_BUDGET * this.scale);
    const pixelBudget = Math.max(200_000, EDGE_PIXEL_BUDGET * this.scale);
    const clip = this.clip;
    let drawn = 0;
    let pixels = 0;
    const line = (e: number) => {
      const a = source[e];
      const b = target[e];
      let ax = positions[a * 2] * k + tx;
      let ay = positions[a * 2 + 1] * k + ty;
      let bx = positions[b * 2] * k + tx;
      let by = positions[b * 2 + 1] * k + ty;
      const offset = topology.edgeOffset[e] * k;

      if (offset) {
        const dx = bx - ax;
        const dy = by - ay;
        const length = Math.sqrt(dx * dx + dy * dy) || 1;
        const px = (-dy / length) * offset;
        const py = (dx / length) * offset;

        ax += px;
        ay += py;
        bx += px;
        by += py;
      }

      // Only the visible part: off-screen lengths cost raster time for nothing.
      if (clipSegment(ax, ay, bx, by, -2, -2, width + 2, height + 2, clip)) {
        ctx.moveTo(clip[0], clip[1]);
        ctx.lineTo(clip[2], clip[3]);
        drawn++;
        pixels += Math.abs(clip[2] - clip[0]) + Math.abs(clip[3] - clip[1]);
      }
    };
    const full = () => drawn >= budget || pixels >= pixelBudget;

    ctx.lineWidth = 1;

    if (state.focusActive) {
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = palette.selection;
    } else {
      ctx.globalAlpha = snapshot.count > 2000 ? 0.16 : 0.3;
      ctx.strokeStyle = palette.edge;
    }

    ctx.beginPath();

    if (index.edgeCount <= FULL_EDGE_SCAN_LIMIT) {
      // Edges of the nodes in view first, then edges that only pass through the view (cut first by the budgets).
      const inView = this.inView;

      for (let e = 0; e < source.length && !full(); e++) {
        const a = source[e];
        const b = target[e];

        if ((inView[a] || inView[b]) && (!visible || (visible[a] && visible[b]))) {
          line(e);
        }
      }

      for (let e = 0; e < source.length && !full(); e++) {
        const a = source[e];
        const b = target[e];

        if (inView[a] || inView[b] || (visible && (!visible[a] || !visible[b]))) {
          continue;
        }

        const ax = positions[a * 2];
        const ay = positions[a * 2 + 1];
        const bx = positions[b * 2];
        const by = positions[b * 2 + 1];

        if (
          (ax < rect.x0 && bx < rect.x0) ||
          (ax > rect.x1 && bx > rect.x1) ||
          (ay < rect.y0 && by < rect.y0) ||
          (ay > rect.y1 && by > rect.y1)
        ) {
          continue;
        }

        line(e);
      }
    } else {
      // Edges touching the nodes in view (each once).
      const nodes = this.nodeBuffer;
      let scanned = 0;

      for (let n = 0; n < total && !full() && scanned < EDGE_SCAN_BUDGET; n++) {
        const node = nodes[n];

        for (let p = topology.incidentStart[node]; p < topology.incidentStart[node + 1]; p++) {
          const e = topology.incident[p];
          const other = source[e] === node ? target[e] : source[e];

          scanned++;

          if ((visible && !visible[other]) || (this.inView[other] && other < node)) {
            continue;
          }

          line(e);
        }
      }
    }

    ctx.stroke();
    ctx.globalAlpha = 1;

    return drawn;
  }

  private drawDetailLabels(
    ctx: CanvasRenderingContext2D,
    scene: GraphScene,
    state: RenderState,
    total: number,
  ): number {
    const { snapshot, topology } = scene;
    const k = state.transform.k;
    const candidates: number[] = [];
    const seen = new Set<number>();
    const add = (node: number) => {
      if (node >= 0 && !seen.has(node) && this.inView[node]) {
        seen.add(node);
        candidates.push(node);
      }
    };

    add(state.selected);

    state.highlighted.forEach(add);

    if (state.focus && state.focusSize <= 150) {
      for (let n = 0; n < total; n++) {
        if (state.focus[this.nodeBuffer[n]]) {
          add(this.nodeBuffer[n]);
        }
      }
    }

    const pinned = candidates.length;

    if (k >= 0.35 || snapshot.count <= 60) {
      const all = k >= 0.9 || snapshot.count <= 60;
      const rest: number[] = [];

      for (let n = 0; n < total; n++) {
        const node = this.nodeBuffer[n];

        if (all || topology.degree[node] >= 8) {
          rest.push(node);
        }
      }

      rest.sort((a, b) => topology.degree[b] - topology.degree[a] || a - b);
      rest.forEach(add);
    }

    return this.drawLabelList(
      ctx,
      state,
      candidates.map((node) => ({
        text: nodeLabel(snapshot, node),
        x: scene.positions[node * 2],
        y: scene.positions[node * 2 + 1],
        offset: screenRadiusPx(topology.radius[node], k) + 4,
      })),
      pinned,
      Math.max(pinned, Math.round(MAX_LABELS * Math.min(1, this.scale))),
    );
  }

  /**
   * Draws labels in screen space, skipping those that would overlap one already drawn (the first `pinned` ones are
   * always drawn).
   */
  private drawLabelList(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
    labels: { text: string; x: number; y: number; offset: number }[],
    pinned: number,
    max: number,
  ): number {
    if (labels.length === 0) {
      return 0;
    }

    const { x: tx, y: ty, k } = state.transform;
    const taken: number[] = [];
    const overlaps = (x0: number, y0: number, x1: number, y1: number) => {
      for (let i = 0; i < taken.length; i += 4) {
        if (x0 < taken[i + 2] && x1 > taken[i] && y0 < taken[i + 3] && y1 > taken[i + 1]) {
          return true;
        }
      }

      return false;
    };

    ctx.globalAlpha = 1;
    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = state.palette.background;
    ctx.fillStyle = state.palette.text;

    let drawn = 0;

    for (let i = 0; i < labels.length && drawn < max; i++) {
      const label = labels[i];
      const text = label.text.length > 40 ? `${label.text.slice(0, 38)}…` : label.text;
      const sx = label.x * k + tx + label.offset;
      const sy = label.y * k + ty;

      if (sx > state.width || sy < -8 || sy > state.height + 8) {
        continue;
      }

      const w = text.length * 6.6;

      if (i >= pinned && overlaps(sx - 2, sy - 8, sx + w + 2, sy + 8)) {
        continue;
      }

      // Overlap tests are linear: keep the taken list bounded.
      if (taken.length < 4 * 1200) {
        taken.push(sx - 2, sy - 8, sx + w + 2, sy + 8);
      }

      ctx.strokeText(text, sx, sy);
      ctx.fillText(text, sx, sy);
      drawn++;
    }

    return drawn;
  }

  // Overview frames

  private drawOverview(
    ctx: CanvasRenderingContext2D,
    scene: GraphScene,
    state: RenderState,
    rect: ViewRect,
    level: IndexLevel,
  ): Omit<FrameInfo, 'budgetScale' | 'ms'> {
    const { snapshot } = scene;
    const { palette, index } = state;
    const { x: tx, y: ty, k } = state.transform;
    const cellPx = level.cellSize * k;
    const cells: number[] = [];
    let maxCount = 1;
    const pad = level.cellSize;

    forEachCellInRect(index, level, rect.x0 - pad, rect.y0 - pad, rect.x1 + pad, rect.y1 + pad, (cell) => {
      cells.push(cell);
      maxCount = Math.max(maxCount, level.count[cell]);
    });

    const edges = this.drawOverviewEdges(ctx, state, rect, level);
    // Cells: type slices (heaviest first) batched per type; single-node cells as the node itself.
    const whole: number[][] = palette.types.map(() => []);
    const slices: number[][] = palette.types.map(() => []);
    const rest: number[] = [];

    for (const cell of cells) {
      const count = level.count[cell];
      const r =
        count === 1
          ? screenRadiusPx(scene.topology.radius[level.rep[cell]], k)
          : overviewRadius(count, maxCount, cellPx);
      const x = level.cx[cell] * k + tx;
      const y = level.cy[cell] * k + ty;
      const from = level.typeStart[cell];
      const to = level.typeStart[cell + 1];

      if (to - from === 1 || r < SLICE_RADIUS_PX) {
        (whole[level.typeCode[from]] ??= []).push(x, y, r);
        continue;
      }

      let angle = -Math.PI / 2;

      for (let t = from; t < to; t++) {
        if (t - from === MAX_SLICES - 1 && to - from > MAX_SLICES) {
          rest.push(x, y, r, angle, -Math.PI / 2 + FULL);
          break;
        }

        const sweep = (level.typeCount[t] / count) * FULL;

        (slices[level.typeCode[t]] ??= []).push(x, y, r, angle, angle + sweep);
        angle += sweep;
      }
    }

    const fillSlices = (list: number[], color: string) => {
      if (list.length === 0) {
        return;
      }

      ctx.fillStyle = color;
      ctx.beginPath();

      for (let i = 0; i < list.length; i += 5) {
        ctx.moveTo(list[i], list[i + 1]);
        ctx.arc(list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4]);
        ctx.closePath();
      }

      ctx.fill();
    };

    ctx.globalAlpha = 0.92;
    whole.forEach((list, code) => {
      if (list.length > 0) {
        this.fillDisks(
          ctx,
          palette.types[code] ?? palette.fallback,
          list.length / 3,
          (i) => list[i * 3],
          (i) => list[i * 3 + 1],
          (i) => list[i * 3 + 2],
        );
      }
    });
    slices.forEach((list, code) => fillSlices(list, palette.types[code] ?? palette.fallback));
    fillSlices(rest, palette.fallback);
    ctx.globalAlpha = 1;

    let labels = 0;

    if (state.showLabels) {
      const ranked = cells
        .filter((cell) => level.count[cell] > 1)
        .sort((a, b) => level.count[b] - level.count[a] || a - b)
        .slice(0, MAX_OVERVIEW_LABELS * 4);

      labels = this.drawLabelList(
        ctx,
        state,
        ranked.map((cell) => ({
          text: `${nodeLabel(snapshot, level.rep[cell])} · ${level.count[cell].toLocaleString()}`,
          x: level.cx[cell],
          y: level.cy[cell],
          offset: overviewRadius(level.count[cell], maxCount, cellPx) + 4,
        })),
        0,
        Math.round(MAX_OVERVIEW_LABELS * Math.min(1, this.scale * 2)),
      );
    }

    return { mode: 'overview', level: level.level, nodes: 0, cells: cells.length, edges, labels, maxCount };
  }

  private drawOverviewEdges(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
    rect: ViewRect,
    nodeLevel: IndexLevel,
  ): number {
    const { index, width, height } = state;
    // Levels with too many edge pairs borrow the edges of the next coarser level.
    const level = index.levels.slice(nodeLevel.level).find((candidate) => candidate.edgeStart) ?? null;

    if (!level || !level.edgeStart || !level.edgeOther || !level.edgeWeight || level.maxEdgeWeight === 0) {
      return 0;
    }

    const { edgeStart, edgeOther, edgeWeight, cx, cy, cells, gridW } = level;
    const { x: tx, y: ty, k } = state.transform;
    const size = level.cellSize;
    const budget = Math.max(1000, EDGE_DRAW_BUDGET * this.scale);
    const pixelBudget = Math.max(200_000, EDGE_PIXEL_BUDGET * this.scale);
    const clip = this.clip;
    let pixels = 0;
    const inRect = (cell: number) => {
      const key = cells[cell];
      const x = index.originX + (key % gridW) * size;
      const y = index.originY + Math.floor(key / gridW) * size;

      return x + size >= rect.x0 && x <= rect.x1 && y + size >= rect.y0 && y <= rect.y1;
    };
    // Four weight classes (log scale): opacity grows with the number of underlying edges.
    const buckets: number[][] = [[], [], [], []];
    const logMax = Math.log(1 + level.maxEdgeWeight);
    let scanned = 0;
    let drawn = 0;

    forEachCellInRect(index, level, rect.x0, rect.y0, rect.x1, rect.y1, (cell) => {
      for (let p = edgeStart[cell]; p < edgeStart[cell + 1]; p++) {
        if (++scanned > EDGE_SCAN_BUDGET || drawn >= budget || pixels >= pixelBudget) {
          return false;
        }

        const other = edgeOther[p];

        if (other < cell && inRect(other)) {
          continue;
        }

        if (
          !clipSegment(
            cx[cell] * k + tx,
            cy[cell] * k + ty,
            cx[other] * k + tx,
            cy[other] * k + ty,
            -2,
            -2,
            width + 2,
            height + 2,
            clip,
          )
        ) {
          continue;
        }

        const bucket = Math.min(3, Math.floor((Math.log(1 + edgeWeight[p]) / logMax) * 4));

        buckets[bucket].push(clip[0], clip[1], clip[2], clip[3]);
        drawn++;
        pixels += Math.abs(clip[2] - clip[0]) + Math.abs(clip[3] - clip[1]);
      }

      return true;
    });

    ctx.strokeStyle = state.focusActive ? state.palette.selection : state.palette.edge;
    ctx.lineWidth = 1;
    buckets.forEach((list, bucket) => {
      if (list.length === 0) {
        return;
      }

      ctx.globalAlpha = OVERVIEW_EDGE_ALPHA[bucket];
      ctx.beginPath();

      for (let i = 0; i < list.length; i += 4) {
        ctx.moveTo(list[i], list[i + 1]);
        ctx.lineTo(list[i + 2], list[i + 3]);
      }

      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    return drawn;
  }

  // Always drawn: search matches, selection

  private drawMarks(
    ctx: CanvasRenderingContext2D,
    scene: GraphScene,
    state: RenderState,
    rect: ViewRect,
    overview: boolean,
  ): void {
    const { positions, topology, snapshot } = scene;
    const { palette } = state;
    const { x: tx, y: ty, k } = state.transform;
    const inRect = (node: number) => {
      const x = positions[node * 2];
      const y = positions[node * 2 + 1];

      return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
    };
    const shown = (node: number) =>
      node >= 0 && node < snapshot.count && (!state.visible || state.visible[node] === 1) && inRect(node);
    const sx = (node: number) => positions[node * 2] * k + tx;
    const sy = (node: number) => positions[node * 2 + 1] * k + ty;
    const marked: number[] = [...state.highlighted];

    if (state.selected >= 0) {
      marked.push(state.selected);
    }

    // In the overview the marked nodes are drawn on top of the cells (they stay findable).
    if (overview) {
      ctx.globalAlpha = 1;

      for (const node of marked) {
        if (shown(node)) {
          ctx.fillStyle = palette.types[snapshot.types[node]] ?? palette.fallback;
          ctx.beginPath();
          ctx.arc(sx(node), sy(node), screenRadiusPx(topology.radius[node], k), 0, FULL);
          ctx.fill();
        }
      }
    }

    ctx.globalAlpha = 1;

    if (state.highlighted.length > 0) {
      ctx.strokeStyle = palette.match;
      ctx.lineWidth = 2.5;
      ctx.beginPath();

      for (const node of state.highlighted) {
        if (shown(node)) {
          const r = screenRadiusPx(topology.radius[node], k) + 3;

          ctx.moveTo(sx(node) + r, sy(node));
          ctx.arc(sx(node), sy(node), r, 0, FULL);
        }
      }

      ctx.stroke();
    }

    if (shown(state.selected)) {
      const node = state.selected;

      ctx.strokeStyle = palette.emphasis;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx(node), sy(node), screenRadiusPx(topology.radius[node], k) + 4, 0, FULL);
      ctx.stroke();
    }

    if (overview && state.showLabels) {
      const labels = marked.filter(shown).map((node) => ({
        text: nodeLabel(snapshot, node),
        x: positions[node * 2],
        y: positions[node * 2 + 1],
        offset: screenRadiusPx(topology.radius[node], k) + 4,
      }));

      this.drawLabelList(ctx, state, labels.slice(-3).reverse(), 3, 3);
    }
  }
}

export function nodeLabel(snapshot: GraphSnapshot, node: number): string {
  return snapshot.nodes[node]?.label || snapshot.ids[node] || '';
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
