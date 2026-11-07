import { DOCUMENT } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { AgentGraphDocument, AgentGraphNode } from '@forepath/agenstra/shared/util-opencode-config';

import {
  agentGraphNodeColorCss,
  agentGraphNodeColorToken,
  agentGraphNodeTypeLabel,
  GRAPH_FALLBACK_COLOR,
} from './graph-labels';
import {
  ForceLayout,
  applyCachedPositions,
  buildLayoutModel,
  computeBounds,
  findNodeAt,
  fitTransform,
  hashSeed,
  neighborhood,
  screenRadius,
  screenToWorld,
  seedCommunityStars,
  seededRandom,
  zoomAt,
  type GraphLayoutModel,
  type LayoutNode,
  type LayoutPoint,
  type ViewTransform,
} from './graph-layout';

/** Milliseconds of layout work per animation frame (keeps the UI responsive). */
const LAYOUT_FRAME_BUDGET_MS = 12;
/** Most labels drawn per frame. */
const MAX_LABELS = 400;
/** Share of known positions above which a new document only settles incrementally (e.g. merged neighbors). */
const INCREMENTAL_LAYOUT_SHARE = 0.5;

interface GraphPalette {
  background: string;
  text: string;
  edge: string;
  emphasis: string;
  selection: string;
  match: string;
  types: Map<string, string>;
}

interface HoverInfo {
  label: string;
  type: string;
  x: number;
  y: number;
}

/**
 * 2D canvas graph viewer (in-house renderer, no chart library): community-star seeding plus a force layout that runs
 * in time-sliced steps, pan / zoom (wheel, drag, keyboard), node drag, neighborhood highlight around the selection,
 * search highlight and a type legend. Colors come from Bootstrap tokens and follow the light / dark theme.
 */
@Component({
  selector: 'framework-agent-graph-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #wrap class="graph-canvas__wrap">
      <canvas
        #canvas
        class="graph-canvas__canvas"
        tabindex="0"
        role="application"
        aria-roledescription="graph"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-describedby]="hintId"
        data-testid="agent-graph-canvas"
      ></canvas>
      <span class="visually-hidden" [id]="hintId">{{ keyboardHint }}</span>
      @if (hover(); as info) {
        <div
          class="graph-canvas__tooltip shadow-sm"
          aria-hidden="true"
          [style.left.px]="info.x"
          [style.top.px]="info.y"
        >
          <span class="graph-canvas__swatch" [style.background]="colorCss(info.type)"></span>
          <span class="fw-semibold">{{ info.label }}</span>
          <span class="text-body-secondary small ms-1">{{ typeLabel(info.type) }}</span>
        </div>
      }
      @if (layoutRunning()) {
        <div class="graph-canvas__progress small text-body-secondary" role="status">
          <span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
          <span i18n="@@featureAgentGraphs-arranging">Arranging graph…</span>
        </div>
      }
      @if (legend().length > 0) {
        <ul class="graph-canvas__legend list-unstyled small mb-0" [attr.aria-label]="legendLabel">
          @for (entry of legend(); track entry.type) {
            <li class="d-flex align-items-center gap-1">
              <span class="graph-canvas__swatch" [style.background]="colorCss(entry.type)" aria-hidden="true"></span>
              <span>{{ typeLabel(entry.type) }}</span>
              <span class="text-body-secondary">{{ entry.count }}</span>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styleUrls: ['./agent-graph-canvas.component.scss'],
})
export class AgentGraphCanvasComponent implements AfterViewInit {
  private static nextId = 0;

  readonly document = input<AgentGraphDocument | null>(null);
  readonly selectedId = input<string | null>(null);
  /** Node types that are not drawn (filter chips). */
  readonly hiddenTypes = input<ReadonlySet<string>>(new Set<string>());
  /** Node ids to highlight (search matches). */
  readonly highlightIds = input<readonly string[]>([]);
  /** Neighborhood hops around the selection that stay emphasized (0: no dimming). */
  readonly hops = input(1);
  /** Draw node labels (off: names only in the hover card). */
  readonly showLabels = input(true);
  readonly ariaLabel = input($localize`:@@featureAgentGraphs-canvasLabel:Graph`);

  readonly nodeSelected = output<string | null>();

  readonly hintId = `agent-graph-canvas-hint-${AgentGraphCanvasComponent.nextId++}`;
  readonly legendLabel = $localize`:@@featureAgentGraphs-legend:Legend`;
  readonly keyboardHint = $localize`:@@featureAgentGraphs-canvasKeyboardHint:Arrow keys pan, plus and minus zoom, 0 fits the graph, Escape clears the selection. Use the search and the details panel to pick nodes with the keyboard.`;
  readonly hover = signal<HoverInfo | null>(null);
  readonly layoutRunning = signal(false);
  readonly legend = computed(() => {
    const hidden = this.hiddenTypes();
    const counts = new Map<string, number>();

    for (const node of this.document()?.nodes ?? []) {
      if (!hidden.has(node.type)) {
        counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([type, count]) => ({ type, count }));
  });

  readonly colorCss = agentGraphNodeColorCss;
  readonly typeLabel = agentGraphNodeTypeLabel;

  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly doc = inject(DOCUMENT);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly wrapRef = viewChild.required<ElementRef<HTMLDivElement>>('wrap');

  private ctx: CanvasRenderingContext2D | null = null;
  private model: GraphLayoutModel | null = null;
  private nodesByIndex: AgentGraphNode[] = [];
  private indicesByType = new Map<string, number[]>();
  private positions = new Map<string, LayoutPoint>();
  private layout: ForceLayout | null = null;
  private layoutFrame = 0;
  /** The running layout replaces the graph (nothing meaningful to show until it settled). */
  private layoutFresh = false;
  private drawFrame = 0;
  private transform: ViewTransform = { x: 0, y: 0, k: 1 };
  private width = 0;
  private height = 0;
  /** The user panned / zoomed: the layout stops auto-fitting. */
  private userMoved = false;
  private palette: GraphPalette = {
    background: '#fff',
    text: '#212529',
    edge: '#6c757d',
    emphasis: '#000',
    selection: '#0d6efd',
    match: '#ffc107',
    types: new Map(),
  };
  private selectedIndex = -1;
  private focus: Set<number> | null = null;
  private highlighted = new Set<number>();
  private hoverIndex = -1;
  private viewReady = false;

  constructor() {
    effect(() => {
      const document = this.document();

      untracked(() => this.loadDocument(document));
    });

    effect(() => {
      const selectedId = this.selectedId();
      const hops = this.hops();
      const highlightIds = this.highlightIds();

      this.hiddenTypes();
      untracked(() => this.updateFocus(selectedId, hops, highlightIds));
    });

    effect(() => {
      this.showLabels();
      untracked(() => this.requestDraw());
    });

    this.destroyRef.onDestroy(() => {
      cancelAnimationFrame(this.layoutFrame);
      cancelAnimationFrame(this.drawFrame);
      this.layout = null;
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef().nativeElement;
    const wrap = this.wrapRef().nativeElement;

    try {
      this.ctx = canvas.getContext('2d');
    } catch {
      this.ctx = null;
    }

    this.viewReady = true;
    this.readPalette();
    this.zone.runOutsideAngular(() => this.bindEvents(canvas, wrap));
    this.resize();

    if (this.model) {
      this.fit();
    }

    this.requestDraw();
  }

  /** Right click: clears the selection (the whole graph shows again) and fits the graph. */
  private resetView(): void {
    const hadSelection = this.selectedIndex >= 0 || !!this.selectedId();

    this.selectedIndex = -1;
    this.focus = null;
    this.zoomToFit();

    if (hadSelection) {
      this.zone.run(() => this.nodeSelected.emit(null));
    }
  }

  /** Fits every visible node into the viewport. */
  zoomToFit(): void {
    this.userMoved = false;
    this.fit();
    this.requestDraw();
  }

  /** Centers a node (and zooms in a bit when far out). */
  focusNode(id: string): void {
    const index = this.model?.indexById.get(id);

    if (index === undefined || !this.model) {
      return;
    }

    const node = this.model.nodes[index];
    const k = Math.max(this.transform.k, 1.1);

    this.transform = { x: this.width / 2 - node.x * k, y: this.height / 2 - node.y * k, k };
    this.userMoved = true;
    this.requestDraw();
  }

  private loadDocument(document: AgentGraphDocument | null): void {
    cancelAnimationFrame(this.layoutFrame);

    if (this.layout && this.model) {
      // Interrupted layout: keep what it reached so the next document can start from there.
      this.rememberPositions();
    }

    this.layout = null;
    this.hoverIndex = -1;
    this.hover.set(null);

    if (!document || document.nodes.length === 0) {
      this.model = null;
      this.nodesByIndex = [];
      this.indicesByType = new Map();
      this.layoutRunning.set(false);
      this.requestDraw();

      return;
    }

    const model = buildLayoutModel(document.nodes, document.edges);
    const nodeById = new Map(document.nodes.map((node) => [node.id, node] as const));

    this.nodesByIndex = model.nodes.map((node) => nodeById.get(node.id) as AgentGraphNode);
    this.indicesByType = new Map();

    for (const node of model.nodes) {
      const list = this.indicesByType.get(node.type);

      if (list) {
        list.push(node.index);
      } else {
        this.indicesByType.set(node.type, [node.index]);
      }
    }

    const random = seededRandom(hashSeed([String(model.nodes.length), ...model.nodes.slice(0, 200).map((n) => n.id)]));
    const reused = this.positions.size > 0 ? applyCachedPositions(model, this.positions, random) : 0;

    this.model = model;
    this.readPalette();
    this.updateFocus(this.selectedId(), this.hops(), this.highlightIds());

    if (reused >= model.nodes.length * INCREMENTAL_LAYOUT_SHARE) {
      // Mostly known graph (merged neighbors / reload): settle the new parts and keep the view.
      this.startLayout(new ForceLayout(model, { iterations: 40, random }), false);
    } else {
      const hubs = seedCommunityStars(model, random);

      this.userMoved = false;
      this.fit();
      this.startLayout(new ForceLayout(model, { pinned: hubs, random }), true);
    }
  }

  /**
   * Settles the layout in time-boxed chunks across animation frames (the UI stays responsive) without drawing the
   * intermediate states: animating large graphs is slow and restless. The settled graph is drawn once at the end; a
   * fresh layout shows an empty canvas with the progress note meanwhile, an incremental one keeps the last frame.
   */
  private startLayout(layout: ForceLayout, fresh: boolean): void {
    this.layout = layout;
    this.layoutFresh = fresh;
    this.layoutRunning.set(!layout.done);

    this.zone.runOutsideAngular(() => {
      const run = () => {
        if (this.layout !== layout) {
          return;
        }

        const started = performance.now();
        let finished = layout.done;

        while (!finished && performance.now() - started < LAYOUT_FRAME_BUDGET_MS) {
          finished = layout.step(1);
        }

        if (finished) {
          layout.finish();
          this.layout = null;

          if (!this.userMoved) {
            this.fit();
          }

          this.draw();
          this.rememberPositions();
          this.zone.run(() => this.layoutRunning.set(false));
        } else {
          this.layoutFrame = requestAnimationFrame(run);
        }
      };

      this.layoutFrame = requestAnimationFrame(run);
    });
  }

  private rememberPositions(): void {
    this.positions = new Map((this.model?.nodes ?? []).map((node) => [node.id, { x: node.x, y: node.y }] as const));
  }

  private updateFocus(selectedId: string | null, hops: number, highlightIds: readonly string[]): void {
    const model = this.model;
    const previous = this.selectedIndex;

    this.selectedIndex = selectedId && model ? (model.indexById.get(selectedId) ?? -1) : -1;
    this.focus =
      model && this.selectedIndex >= 0 && hops > 0 ? neighborhood(model.adjacency, [this.selectedIndex], hops) : null;
    this.highlighted = new Set(
      model ? highlightIds.map((id) => model.indexById.get(id)).filter((i): i is number => i !== undefined) : [],
    );

    // A selection made outside the canvas (panel, search) is brought into view.
    if (model && this.selectedIndex >= 0 && this.selectedIndex !== previous && this.viewReady) {
      const node = model.nodes[this.selectedIndex];
      const sx = node.x * this.transform.k + this.transform.x;
      const sy = node.y * this.transform.k + this.transform.y;

      if (sx < 0 || sy < 0 || sx > this.width || sy > this.height) {
        this.transform = {
          ...this.transform,
          x: this.width / 2 - node.x * this.transform.k,
          y: this.height / 2 - node.y * this.transform.k,
        };
      }
    }

    this.requestDraw();
  }

  /**
   * Drawn and hit-testable: not filtered out by type and, while a node is selected, inside its neighborhood (nodes
   * outside it are left out of the view entirely).
   */
  private isVisible = (node: LayoutNode): boolean =>
    !this.hiddenTypes().has(node.type) && (!this.focus || this.focus.has(node.index));

  private fit(): void {
    if (!this.model || this.width === 0) {
      return;
    }

    this.transform = fitTransform(computeBounds(this.model.nodes, this.isVisible), this.width, this.height);
  }

  private resize(): void {
    const wrap = this.wrapRef().nativeElement;
    const canvas = this.canvasRef().nativeElement;
    const dpr = Math.max(1, this.doc.defaultView?.devicePixelRatio ?? 1);
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;

    if (width === this.width && height === this.height && canvas.width === Math.floor(width * dpr)) {
      return;
    }

    const wasEmpty = this.width === 0;

    this.width = width;
    this.height = height;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));

    if (wasEmpty || !this.userMoved) {
      this.fit();
    }

    this.draw();
  }

  /** Resolves the Bootstrap tokens on the host (re-run on theme changes). */
  private readPalette(): void {
    const view = this.doc.defaultView;

    if (!view || !this.viewReady) {
      return;
    }

    const style = view.getComputedStyle(this.host.nativeElement);
    const read = (token: string, fallback: string) => style.getPropertyValue(token).trim() || fallback;
    const types = new Map<string, string>();

    for (const type of this.indicesByType.keys()) {
      types.set(type, read(agentGraphNodeColorToken(type), GRAPH_FALLBACK_COLOR));
    }

    this.palette = {
      background: read('--bs-body-bg', '#fff'),
      text: read('--bs-body-color', '#212529'),
      edge: read('--bs-secondary-color', '#6c757d'),
      emphasis: read('--bs-emphasis-color', '#000'),
      selection: read('--bs-primary', '#0d6efd'),
      match: read('--bs-warning', '#ffc107'),
      types,
    };
  }

  /** Follows device pixel ratio changes (zoom, moving the window to another screen). */
  private syncCanvasSize(canvas: HTMLCanvasElement): void {
    const dpr = Math.max(1, this.doc.defaultView?.devicePixelRatio ?? 1);
    const width = Math.max(1, Math.floor(this.width * dpr));
    const height = Math.max(1, Math.floor(this.height * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  private requestDraw(): void {
    if (this.drawFrame || this.layout) {
      // A running layout draws every frame anyway.
      return;
    }

    this.zone.runOutsideAngular(() => {
      this.drawFrame = requestAnimationFrame(() => {
        this.drawFrame = 0;
        this.draw();
      });
    });
  }

  private draw(): void {
    const ctx = this.ctx;
    const canvas = this.viewReady ? this.canvasRef().nativeElement : null;

    if (!ctx || !canvas) {
      return;
    }

    this.syncCanvasSize(canvas);

    // While settling, intermediate positions are never shown (see startLayout).
    if (this.layout && !this.layoutFresh) {
      return;
    }

    const dpr = canvas.width / Math.max(1, this.width);
    const { x: tx, y: ty, k } = this.transform;
    const palette = this.palette;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const model = this.model;

    if (!model || this.layout) {
      return;
    }

    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);

    // Visible world rectangle (with a margin for node radii).
    const margin = 20 / k;
    const x0 = -tx / k - margin;
    const y0 = -ty / k - margin;
    const x1 = (this.width - tx) / k + margin;
    const y1 = (this.height - ty) / k + margin;
    const nodes = model.nodes;
    const hidden = this.hiddenTypes();
    const focus = this.focus;
    const inView = (node: LayoutNode) => node.x >= x0 && node.x <= x1 && node.y >= y0 && node.y <= y1;

    // Edges: one batched path at low alpha; with a selection only its neighborhood's edges, emphasized.
    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = palette.edge;
    ctx.globalAlpha = nodes.length > 2000 ? 0.16 : 0.3;
    ctx.beginPath();

    const focusLinks: number[] = [];

    for (let i = 0; i < model.links.length; i++) {
      const link = model.links[i];
      const a = nodes[link.source];
      const b = nodes[link.target];

      if (hidden.has(a.type) || hidden.has(b.type)) {
        continue;
      }

      if ((a.x < x0 && b.x < x0) || (a.x > x1 && b.x > x1) || (a.y < y0 && b.y < y0) || (a.y > y1 && b.y > y1)) {
        continue;
      }

      if (focus) {
        if (focus.has(link.source) && focus.has(link.target)) {
          focusLinks.push(i);
        }

        continue;
      }

      this.lineTo(ctx, a, b, link.offset);
    }

    ctx.stroke();

    if (focusLinks.length > 0) {
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = palette.selection;
      ctx.lineWidth = 1.4 / k;
      ctx.beginPath();

      for (const i of focusLinks) {
        const link = model.links[i];

        this.lineTo(ctx, nodes[link.source], nodes[link.target], link.offset);
      }

      ctx.stroke();
    }

    // Nodes: one path per type (with a selection only its neighborhood).
    {
      ctx.globalAlpha = 1;

      for (const [type, indices] of this.indicesByType) {
        if (hidden.has(type)) {
          continue;
        }

        ctx.fillStyle = palette.types.get(type) ?? GRAPH_FALLBACK_COLOR;
        ctx.beginPath();

        for (const index of indices) {
          const node = nodes[index];

          if ((focus && !focus.has(index)) || !inView(node) || node.missing) {
            continue;
          }

          const r = screenRadius(node, k) / k;

          ctx.moveTo(node.x + r, node.y);
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        }

        ctx.fill();
      }
    }

    // Reference targets that no longer exist (prompt history of deleted files): faded with a dashed outline.
    ctx.setLineDash([3 / k, 2 / k]);
    ctx.lineWidth = 1 / k;

    for (const node of nodes) {
      if (!node.missing || !this.isVisible(node) || !inView(node)) {
        continue;
      }

      const r = screenRadius(node, k) / k;
      const color = palette.types.get(node.type) ?? GRAPH_FALLBACK_COLOR;

      ctx.globalAlpha = 0.3;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = Math.min(1, ctx.globalAlpha * 2.5);
      ctx.stroke();
    }

    ctx.setLineDash([]);

    // Rings: search matches, then the selection.
    ctx.globalAlpha = 1;

    if (this.highlighted.size > 0) {
      ctx.strokeStyle = palette.match;
      ctx.lineWidth = 2.5 / k;
      ctx.beginPath();

      for (const index of this.highlighted) {
        const node = nodes[index];

        if (this.isVisible(node) && inView(node)) {
          const r = screenRadius(node, k) / k + 3 / k;

          ctx.moveTo(node.x + r, node.y);
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        }
      }

      ctx.stroke();
    }

    if (this.selectedIndex >= 0) {
      const node = nodes[this.selectedIndex];
      const r = screenRadius(node, k) / k + 4 / k;

      ctx.strokeStyle = palette.emphasis;
      ctx.lineWidth = 2 / k;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    this.drawLabels(ctx, dpr, inView);
  }

  private lineTo(ctx: CanvasRenderingContext2D, a: LayoutNode, b: LayoutNode, offset: number): void {
    let ax = a.x;
    let ay = a.y;
    let bx = b.x;
    let by = b.y;

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

    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }

  /**
   * Labels in screen space (when enabled): selection, hover, matches and the focus always; others only when zoomed in.
   */
  private drawLabels(ctx: CanvasRenderingContext2D, dpr: number, inView: (node: LayoutNode) => boolean): void {
    const model = this.model;

    if (!model || !this.showLabels()) {
      return;
    }

    const { x: tx, y: ty, k } = this.transform;
    const candidates: number[] = [];
    const seen = new Set<number>();
    const add = (index: number) => {
      if (index >= 0 && !seen.has(index) && candidates.length < MAX_LABELS) {
        const node = model.nodes[index];

        if (this.isVisible(node) && inView(node)) {
          seen.add(index);
          candidates.push(index);
        }
      }
    };

    add(this.selectedIndex);
    add(this.hoverIndex);
    this.highlighted.forEach(add);

    if (this.focus && this.focus.size <= 150) {
      this.focus.forEach(add);
    }

    if (k >= 0.9 || model.nodes.length <= 60) {
      model.nodes.forEach((node) => add(node.index));
    } else if (k >= 0.35) {
      model.nodes.forEach((node) => {
        if (node.degree >= 8) {
          add(node.index);
        }
      });
    }

    if (candidates.length === 0) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.palette.background;
    ctx.fillStyle = this.palette.text;

    for (const index of candidates) {
      const node = model.nodes[index];
      const raw = this.nodesByIndex[index]?.label || node.id;
      const label = raw.length > 40 ? `${raw.slice(0, 38)}…` : raw;
      const sx = node.x * k + tx + screenRadius(node, k) + 4;
      const sy = node.y * k + ty;

      ctx.strokeText(label, sx, sy);
      ctx.fillText(label, sx, sy);
    }
  }

  private bindEvents(canvas: HTMLCanvasElement, wrap: HTMLElement): void {
    let dragIndex = -1;
    let panning = false;
    let moved = false;
    let down = { x: 0, y: 0 };
    /** Button of the current press (0 primary, 2 secondary). */
    let button = 0;
    let last = { x: 0, y: 0 };
    const position = (event: PointerEvent | WheelEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();

      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const listen = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      canvas.addEventListener(type, handler, options);
      this.destroyRef.onDestroy(() => canvas.removeEventListener(type, handler, options));
    };

    // Right click resets the view instead of opening the browser menu: clears the selection (the whole graph shows
    // again) and fits it.
    // No browser menu on the canvas: the secondary button drags like the primary one, and a right click without
    // movement resets the view (see `end`). Handled on release, as some platforms fire `contextmenu` on press.
    listen('contextmenu', (event) => event.preventDefault());

    listen('pointerdown', (event) => {
      if (!this.model || (event.button !== 0 && event.button !== 2)) {
        return;
      }

      button = event.button;
      canvas.setPointerCapture?.(event.pointerId);
      down = last = position(event);
      moved = false;
      dragIndex = findNodeAt(this.model.nodes, this.transform, down.x, down.y, this.isVisible);
      panning = dragIndex < 0;
      this.setHover(-1);

      if (dragIndex >= 0) {
        this.model.nodes[dragIndex].fixed = true;
      }
    });

    listen('pointermove', (event) => {
      if (!this.model) {
        return;
      }

      const point = position(event);

      if (Math.abs(point.x - down.x) > 4 || Math.abs(point.y - down.y) > 4) {
        moved = true;
      }

      if (dragIndex >= 0 && moved) {
        const node = this.model.nodes[dragIndex];
        const world = screenToWorld(this.transform, point.x, point.y);

        node.x = world.x;
        node.y = world.y;
        this.requestDraw();
      } else if (panning && moved) {
        this.transform = {
          ...this.transform,
          x: this.transform.x + point.x - last.x,
          y: this.transform.y + point.y - last.y,
        };
        this.userMoved = true;
        this.requestDraw();
      } else if (dragIndex < 0 && !panning) {
        this.setHover(findNodeAt(this.model.nodes, this.transform, point.x, point.y, this.isVisible), point);
      }

      last = point;
    });

    const end = () => {
      if (!this.model) {
        return;
      }

      if (dragIndex >= 0) {
        const node = this.model.nodes[dragIndex];

        node.fixed = false;
        this.positions.set(node.id, { x: node.x, y: node.y });
      }

      if (!moved && button === 2 && (dragIndex >= 0 || panning)) {
        this.resetView();
      } else if (!moved && (dragIndex >= 0 || panning)) {
        const id = dragIndex >= 0 ? this.model.nodes[dragIndex].id : null;

        this.zone.run(() => this.nodeSelected.emit(id));
      }

      dragIndex = -1;
      panning = false;
      this.requestDraw();
    };

    listen('pointerup', end);
    listen('pointercancel', () => {
      moved = true;
      end();
    });
    listen('pointerleave', () => this.setHover(-1));
    listen(
      'wheel',
      (event) => {
        event.preventDefault();

        const point = position(event);

        this.transform = zoomAt(this.transform, point.x, point.y, Math.exp(-event.deltaY * 0.0015));
        this.userMoved = true;
        this.requestDraw();
      },
      { passive: false },
    );
    listen('dblclick', (event) => {
      const point = position(event);

      this.transform = zoomAt(this.transform, point.x, point.y, 1.6);
      this.userMoved = true;
      this.requestDraw();
    });
    listen('keydown', (event) => {
      const step = 60;
      let handled = true;

      switch (event.key) {
        case 'ArrowLeft':
          this.transform = { ...this.transform, x: this.transform.x + step };
          break;
        case 'ArrowRight':
          this.transform = { ...this.transform, x: this.transform.x - step };
          break;
        case 'ArrowUp':
          this.transform = { ...this.transform, y: this.transform.y + step };
          break;
        case 'ArrowDown':
          this.transform = { ...this.transform, y: this.transform.y - step };
          break;
        case '+':
        case '=':
          this.transform = zoomAt(this.transform, this.width / 2, this.height / 2, 1.25);
          break;
        case '-':
        case '_':
          this.transform = zoomAt(this.transform, this.width / 2, this.height / 2, 0.8);
          break;
        case '0':
          this.zoomToFit();

          return event.preventDefault();
        case 'Escape':
          this.zone.run(() => this.nodeSelected.emit(null));
          break;
        default:
          handled = false;
      }

      if (handled) {
        event.preventDefault();
        this.userMoved = true;
        this.requestDraw();
      }
    });

    const view = this.doc.defaultView;

    if (view && 'ResizeObserver' in view) {
      const observer = new ResizeObserver(() => this.resize());

      observer.observe(wrap);
      this.destroyRef.onDestroy(() => observer.disconnect());
    }

    if (view && 'MutationObserver' in view) {
      // Theme switches toggle `data-bs-theme` on <html>: re-resolve the tokens.
      const observer = new MutationObserver(() => {
        this.readPalette();
        this.requestDraw();
      });

      observer.observe(this.doc.documentElement, { attributes: true, attributeFilter: ['data-bs-theme', 'class'] });
      this.destroyRef.onDestroy(() => observer.disconnect());
    }
  }

  private setHover(index: number, point?: { x: number; y: number }): void {
    // The tooltip stays where the hover started (no change detection per pointer move).
    if (index === this.hoverIndex) {
      return;
    }

    this.hoverIndex = index;

    const node = index >= 0 ? this.model?.nodes[index] : undefined;
    const info =
      node && point
        ? {
            label: this.nodesByIndex[index]?.label || node.id,
            type: node.type,
            x: Math.min(point.x + 14, Math.max(0, this.width - 260)),
            y: Math.min(point.y + 14, Math.max(0, this.height - 40)),
          }
        : null;

    this.zone.run(() => this.hover.set(info));
    this.requestDraw();
  }
}
