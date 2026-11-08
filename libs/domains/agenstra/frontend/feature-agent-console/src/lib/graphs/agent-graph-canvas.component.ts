import { DOCUMENT } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  LOCALE_ID,
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
import type { AgentGraphDocument } from '@forepath/agenstra/shared/util-opencode-config';

import { GraphJobSlot, type GraphJobResponse, type LayoutResult } from './graph-compute';
import { neighborhoodMask } from './graph-engine';
import { buildSceneIndex, type SceneIndex } from './graph-index';
import {
  agentGraphNodeColorCss,
  agentGraphNodeColorToken,
  agentGraphNodeTypeLabel,
  GRAPH_FALLBACK_COLOR,
} from './graph-labels';
import { fitTransform, hashSeed, screenToWorld, zoomAt, type ViewTransform } from './graph-layout';
import { GraphModelBuilder, type GraphSnapshot } from './graph-model';
import {
  GraphRenderer,
  nodeLabel,
  type GraphPalette,
  type GraphScene,
  type HoverTarget,
  type RenderState,
} from './graph-renderer';
import { graphWorkerFactory } from './graph-worker.factory';

/** Drawn subsets up to this size are indexed right away on the main thread (larger ones in the worker). */
const SYNC_INDEX_NODES = 5000;
/** A fresh layout that takes longer than this shows its seeded (community star) positions meanwhile. */
const SEED_PREVIEW_DELAY_MS = 600;
/** Main-thread time per slice while a document is taken into the model. */
const INGEST_SLICE_MS = 8;
/** After this idle time (ms), a frame drawn with reduced budgets is redrawn complete. */
const REFINE_DELAY_MS = 200;
/** Types listed in the tooltip of an overview cell. */
const CLUSTER_TOOLTIP_TYPES = 4;

type HoverInfo =
  | { kind: 'node'; label: string; type: string; x: number; y: number }
  | {
      kind: 'cell';
      count: string;
      types: { type: string; count: string }[];
      more: number;
      x: number;
      y: number;
    };

interface LayoutJob {
  job: number;
  snapshot: GraphSnapshot;
  fresh: boolean;
}

/**
 * 2D canvas graph viewer (in-house renderer, no chart library). The layout (community-star seeding plus a force
 * settle) and the spatial index run in a Web Worker; the main thread only draws what is in view: individual nodes
 * when few enough are visible, otherwise an overview of aggregated cells (counts, type composition, aggregated
 * edges) that drills down on click. Pan / zoom (wheel, drag, keyboard), node drag, neighborhood highlight around the
 * selection, search highlight and a type legend. Colors come from Bootstrap tokens and follow the light / dark theme.
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
      <!-- Hover marks: redrawn alone, so hovering never redraws (or changes) the graph below. -->
      <canvas #overlay class="graph-canvas__overlay" aria-hidden="true"></canvas>
      <span class="visually-hidden" [id]="hintId">{{ keyboardHint }}</span>
      @if (hover(); as info) {
        <div
          class="graph-canvas__tooltip shadow-sm"
          aria-hidden="true"
          [style.left.px]="info.x"
          [style.top.px]="info.y"
        >
          @if (info.kind === 'node') {
            <span class="graph-canvas__swatch" [style.background]="colorCss(info.type)"></span>
            <span class="fw-semibold">{{ info.label }}</span>
            <span class="text-body-secondary small ms-1">{{ typeLabel(info.type) }}</span>
          } @else {
            <div class="fw-semibold" i18n="@@featureAgentGraphs-clusterNodes">{{ info.count }} nodes</div>
            @for (entry of info.types; track entry.type) {
              <div class="d-flex align-items-center small">
                <span class="graph-canvas__swatch" [style.background]="colorCss(entry.type)"></span>
                <span>{{ typeLabel(entry.type) }}</span>
                <span class="text-body-secondary ms-auto ps-2">{{ entry.count }}</span>
              </div>
            }
            @if (info.more > 0) {
              <div class="small text-body-secondary" i18n="@@featureAgentGraphs-clusterMoreTypes">
                +{{ info.more }} more types
              </div>
            }
            <div class="small text-body-secondary" i18n="@@featureAgentGraphs-clusterZoomHint">Click to zoom in</div>
          }
        </div>
      }
      @if (loading()) {
        <div class="graph-canvas__progress small text-body-secondary" role="status">
          <span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
          <span i18n="@@featureAgentGraphs-loading">Loading graph…</span>
        </div>
      } @else if (layoutRunning()) {
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
  /**
   * More pages of the document are still arriving: nothing is laid out or drawn until the document is complete (a
   * half-loaded graph would be misleading, and every page would cost a layout).
   */
  readonly loading = input(false);
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
  private readonly locale = inject(LOCALE_ID);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly overlayRef = viewChild.required<ElementRef<HTMLCanvasElement>>('overlay');
  private readonly wrapRef = viewChild.required<ElementRef<HTMLDivElement>>('wrap');

  private ctx: CanvasRenderingContext2D | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  /** The pending frame redraws the graph (not only the hover overlay). */
  private baseDirty = false;
  private readonly renderer = new GraphRenderer();
  private readonly builder = new GraphModelBuilder();
  private readonly layoutSlot: GraphJobSlot;
  private readonly indexSlot: GraphJobSlot;
  /** What is drawn (swapped when a layout finishes). */
  private scene: GraphScene | null = null;
  /** A fresh layout replaces the graph: nothing is drawn until it settled (or its seed preview shows). */
  private sceneHidden = false;
  /** The drawn scene is a settled layout (not a seed preview): its positions seed the next document. */
  private sceneSettled = false;
  private layoutJob: LayoutJob | null = null;
  /** Newer document that extends the one being laid out (laid out next). */
  private queued: GraphSnapshot | null = null;
  private seedTimer: ReturnType<typeof setTimeout> | null = null;
  /** Index of the drawn subset (type filters / selection neighborhood) and the mask it was built for. */
  private subset: { mask: Uint8Array; index: SceneIndex } | null = null;
  private subsetJob = 0;
  private drawFrame = 0;
  /** When the pending frame was requested (frame latency feeds the renderer's adaptive budgets). */
  private drawRequestedAt = 0;
  private refineTimer: ReturnType<typeof setTimeout> | null = null;
  /** Document being taken into the model (time-sliced). */
  private ingestTimer: ReturnType<typeof setTimeout> | null = null;
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
    fallback: GRAPH_FALLBACK_COLOR,
    types: [],
  };
  private typeColors = new Map<string, string>();
  private selectedIndex = -1;
  private focus: { mask: Uint8Array; size: number } | null = null;
  private visible: Uint8Array | null = null;
  private highlighted: number[] = [];
  private hoverTarget: HoverTarget | null = null;
  private moved: number[] = [];
  private movedMask: Uint8Array | null = null;
  private viewReady = false;

  constructor() {
    const factory = graphWorkerFactory();

    this.layoutSlot = new GraphJobSlot(factory, (response) => this.onLayoutResponse(response));
    this.indexSlot = new GraphJobSlot(factory, (response) => this.onIndexResponse(response));

    effect(() => {
      const document = this.document();
      const loading = this.loading();

      untracked(() => (loading ? this.waitForDocument() : this.loadDocument(document)));
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
      cancelAnimationFrame(this.drawFrame);
      this.clearSeedTimer();
      this.clearRefineTimer();
      this.cancelIngest();
      this.layoutSlot.destroy();
      this.indexSlot.destroy();
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef().nativeElement;
    const wrap = this.wrapRef().nativeElement;

    try {
      this.ctx = canvas.getContext('2d');
      this.overlayCtx = this.overlayRef().nativeElement.getContext('2d');
    } catch {
      this.ctx = null;
      this.overlayCtx = null;
    }

    this.viewReady = true;
    this.readPalette();
    this.zone.runOutsideAngular(() => this.bindEvents(canvas, wrap));
    this.resize();

    if (this.scene) {
      this.fit();
    }

    this.requestDraw();
  }

  /** Right click: clears the selection (the whole graph shows again) and fits the graph. */
  private resetView(): void {
    const hadSelection = this.selectedIndex >= 0 || !!this.selectedId();

    this.selectedIndex = -1;
    this.setFocus(null);
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
    const scene = this.scene;
    const index = scene ? scene.snapshot.indexOf(id) : -1;

    if (!scene || index < 0) {
      return;
    }

    const k = Math.max(this.transform.k, 1.1);

    this.transform = {
      x: this.width / 2 - scene.positions[index * 2] * k,
      y: this.height / 2 - scene.positions[index * 2 + 1] * k,
      k,
    };
    this.userMoved = true;
    this.requestDraw();
  }

  // Documents and layout jobs

  /** Pages are still arriving: stop any layout and draw nothing until the complete document is there. */
  private waitForDocument(): void {
    this.cancelIngest();
    this.layoutSlot.cancel();
    this.clearSeedTimer();
    this.layoutJob = null;
    this.queued = null;
    this.sceneHidden = true;
    this.setHover(null);
    this.layoutRunning.set(false);
    this.requestDraw();
  }

  private loadDocument(document: AgentGraphDocument | null): void {
    this.setHover(null);
    this.cancelIngest();

    if (!document || document.nodes.length === 0) {
      this.layoutSlot.cancel();
      this.indexSlot.cancel();
      this.clearSeedTimer();
      this.layoutJob = null;
      this.queued = null;
      this.scene = null;
      this.sceneSettled = false;
      this.subset = null;
      this.layoutRunning.set(false);
      this.requestDraw();

      return;
    }

    // The document is taken into the typed model in slices (millions of nodes never block the UI).
    const ingest = this.builder.begin(document);
    const run = () => {
      this.ingestTimer = null;

      if (!ingest.step(INGEST_SLICE_MS)) {
        this.ingestTimer = setTimeout(run, 0);

        return;
      }

      const snapshot = this.builder.snapshot();

      // Merged documents (neighbors) keep coming: let the running layout finish, then settle the newest one.
      if (ingest.extended && this.layoutJob && this.layoutSlot.busy) {
        this.queued = snapshot;

        return;
      }

      this.startLayout(snapshot);
    };

    this.layoutRunning.set(true);
    this.zone.runOutsideAngular(run);
  }

  private cancelIngest(): void {
    if (this.ingestTimer) {
      clearTimeout(this.ingestTimer);
      this.ingestTimer = null;
    }
  }

  private startLayout(snapshot: GraphSnapshot): void {
    this.queued = null;
    this.clearSeedTimer();

    const count = snapshot.count;
    const positions = new Float32Array(count * 2);
    const known = new Uint8Array(count);
    let knownCount = 0;
    const previous = this.sceneSettled ? this.scene : null;

    if (previous) {
      const old = previous.snapshot;

      for (let i = 0; i < count; i++) {
        const j = i < old.count && old.ids[i] === snapshot.ids[i] ? i : old.indexOf(snapshot.ids[i]);

        if (j >= 0) {
          positions[i * 2] = previous.positions[j * 2];
          positions[i * 2 + 1] = previous.positions[j * 2 + 1];
          known[i] = 1;
          knownCount++;
        }
      }
    }

    const fresh = knownCount < count * 0.5;
    const seed = hashSeed([String(count), ...snapshot.ids.slice(0, Math.min(200, count))]);
    const job = this.layoutSlot.run({
      kind: 'layout',
      input: {
        count,
        types: snapshot.types.slice(),
        typeNames: snapshot.typeNames,
        community: snapshot.community.slice(),
        edgeSource: snapshot.edgeSource.slice(),
        edgeTarget: snapshot.edgeTarget.slice(),
        positions,
        known,
        knownCount,
        seed,
      },
      mask: null,
    });

    this.layoutJob = { job, snapshot, fresh };
    this.zone.run(() => this.layoutRunning.set(true));

    if (fresh) {
      this.userMoved = false;
      this.sceneHidden = true;
      this.requestDraw();
    }
  }

  private onLayoutResponse(response: GraphJobResponse): void {
    const job = this.layoutJob;

    if (!job || response.job !== job.job) {
      return;
    }

    if (response.kind === 'seeded') {
      // Long fresh layouts show the seeded stars instead of an empty canvas.
      this.seedTimer = setTimeout(() => {
        this.seedTimer = null;

        if (this.layoutJob === job && this.layoutSlot.busy) {
          this.showScene(job.snapshot, response, false);
        }
      }, SEED_PREVIEW_DELAY_MS);

      return;
    }

    if (response.kind === 'progress') {
      return;
    }

    this.clearSeedTimer();

    if (response.kind === 'layout') {
      this.showScene(job.snapshot, response, true);
    } else if (response.kind === 'error') {
      this.sceneHidden = false;
    }

    this.layoutJob = null;

    if (this.queued) {
      this.startLayout(this.queued);
    } else {
      this.zone.run(() => this.layoutRunning.set(false));
      this.requestDraw();
    }
  }

  private showScene(snapshot: GraphSnapshot, result: LayoutResult, settled: boolean): void {
    this.scene = { snapshot, positions: result.positions, topology: result.topology, index: result.index };
    this.sceneHidden = false;
    this.sceneSettled = settled;
    this.subset = null;
    this.moved = [];
    this.movedMask = null;
    this.hoverTarget = null;
    this.readPalette();
    this.updateFocus(this.selectedId(), this.hops(), this.highlightIds(), false);

    if (!this.userMoved) {
      this.fit();
    }

    this.requestDraw();
  }

  private clearSeedTimer(): void {
    if (this.seedTimer) {
      clearTimeout(this.seedTimer);
      this.seedTimer = null;
    }
  }

  // Selection, filters and the drawn subset

  private updateFocus(selectedId: string | null, hops: number, highlightIds: readonly string[], reveal = true): void {
    const scene = this.scene;
    const previous = this.selectedIndex;

    if (!scene) {
      this.selectedIndex = -1;
      this.highlighted = [];
      this.setFocus(null);

      return;
    }

    const { snapshot, positions } = scene;

    this.selectedIndex = selectedId ? snapshot.indexOf(selectedId) : -1;
    this.highlighted = highlightIds.map((id) => snapshot.indexOf(id)).filter((index) => index >= 0);
    this.setFocus(
      this.selectedIndex >= 0 && hops > 0
        ? neighborhoodMask(scene.topology, snapshot.count, [this.selectedIndex], hops)
        : null,
    );

    // A selection made outside the canvas (panel, search) is brought into view.
    if (reveal && this.selectedIndex >= 0 && this.selectedIndex !== previous && this.viewReady) {
      const x = positions[this.selectedIndex * 2];
      const y = positions[this.selectedIndex * 2 + 1];
      const sx = x * this.transform.k + this.transform.x;
      const sy = y * this.transform.k + this.transform.y;

      if (sx < 0 || sy < 0 || sx > this.width || sy > this.height) {
        this.transform = {
          ...this.transform,
          x: this.width / 2 - x * this.transform.k,
          y: this.height / 2 - y * this.transform.k,
        };
      }
    }

    this.requestDraw();
  }

  /** Recomputes the drawn subset (type filters and focus) and its index. */
  private setFocus(focus: { mask: Uint8Array; size: number } | null): void {
    this.focus = focus;

    const scene = this.scene;

    if (!scene) {
      this.visible = null;
      this.subset = null;

      return;
    }

    const { snapshot } = scene;
    const hidden = this.hiddenTypes();
    const hiddenCodes = snapshot.typeNames.map((name) => hidden.has(name));

    if (!focus && !hiddenCodes.some(Boolean)) {
      this.visible = null;
      this.subset = null;
      this.indexSlot.cancel();
      this.requestDraw();

      return;
    }

    const visible = new Uint8Array(snapshot.count);
    let size = 0;

    for (let i = 0; i < snapshot.count; i++) {
      if (!hiddenCodes[snapshot.types[i]] && (!focus || focus.mask[i])) {
        visible[i] = 1;
        size++;
      }
    }

    this.visible = visible;

    const input = {
      count: snapshot.count,
      positions: scene.positions,
      mask: visible,
      types: snapshot.types,
      typeTotal: snapshot.typeNames.length,
      degree: scene.topology.degree,
      radius: scene.topology.radius,
      edgeSource: snapshot.edgeSource,
      edgeTarget: snapshot.edgeTarget,
    };

    if (size <= SYNC_INDEX_NODES) {
      this.indexSlot.cancel();
      this.subset = { mask: visible, index: buildSceneIndex(input) };
    } else {
      // Until the worker delivers, the previous index draws (filtered by `visible`). The worker gets copies.
      this.subsetJob = this.indexSlot.run({
        kind: 'index',
        input: {
          ...input,
          positions: input.positions.slice(),
          mask: visible.slice(),
          types: input.types.slice(),
          degree: input.degree.slice(),
          radius: input.radius.slice(),
          edgeSource: input.edgeSource.slice(),
          edgeTarget: input.edgeTarget.slice(),
        },
      });
    }

    this.requestDraw();
  }

  private onIndexResponse(response: GraphJobResponse): void {
    if (response.kind !== 'index' || response.job !== this.subsetJob || !this.visible) {
      return;
    }

    this.subset = { mask: this.visible, index: response.index };
    this.requestDraw();
  }

  /** Index of what is drawn now. */
  private currentIndex(): SceneIndex | null {
    return this.subset?.index ?? this.scene?.index ?? null;
  }

  private fit(): void {
    const index = this.currentIndex();

    if (!index || this.width === 0) {
      return;
    }

    this.transform = fitTransform(index.bounds, this.width, this.height);
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
    const typeNames = this.scene?.snapshot.typeNames ?? [];

    this.typeColors = new Map(
      typeNames.map((type) => [type, read(agentGraphNodeColorToken(type), GRAPH_FALLBACK_COLOR)]),
    );
    this.palette = {
      background: read('--bs-body-bg', '#fff'),
      text: read('--bs-body-color', '#212529'),
      edge: read('--bs-secondary-color', '#6c757d'),
      emphasis: read('--bs-emphasis-color', '#000'),
      selection: read('--bs-primary', '#0d6efd'),
      match: read('--bs-warning', '#ffc107'),
      fallback: read('--bs-secondary-color', GRAPH_FALLBACK_COLOR),
      types: typeNames.map((type) => this.typeColors.get(type) ?? GRAPH_FALLBACK_COLOR),
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

  /** @param base Redraw the graph; `false` only redraws the hover overlay. */
  private requestDraw(base = true): void {
    this.baseDirty ||= base;

    if (this.drawFrame) {
      return;
    }

    this.drawRequestedAt = performance.now();
    this.zone.runOutsideAngular(() => {
      this.drawFrame = requestAnimationFrame(() => {
        this.drawFrame = 0;

        if (this.baseDirty) {
          this.draw(performance.now() - this.drawRequestedAt);
        } else {
          this.drawOverlay();
        }
      });
    });
  }

  private drawOverlay(): void {
    const ctx = this.overlayCtx;

    if (!ctx || !this.viewReady) {
      return;
    }

    this.syncCanvasSize(this.overlayRef().nativeElement);

    const index = this.currentIndex();
    const scene = this.sceneHidden ? null : this.scene;

    this.renderer.drawOverlay(ctx, index ? scene : null, this.renderState(index ?? emptyIndex()));
  }

  private renderState(index: SceneIndex): RenderState {
    const canvas = this.canvasRef().nativeElement;

    return {
      index,
      transform: this.transform,
      width: this.width,
      height: this.height,
      dpr: canvas.width / Math.max(1, this.width),
      palette: this.palette,
      visible: this.visible,
      focusActive: !!this.focus,
      focusSize: this.focus?.size ?? 0,
      focus: this.focus?.mask ?? null,
      selected: this.selectedIndex,
      hover: this.hoverTarget,
      highlighted: this.highlighted,
      showLabels: this.showLabels(),
      moved: this.moved,
      movedMask: this.movedMask,
    };
  }

  private clearRefineTimer(): void {
    if (this.refineTimer) {
      clearTimeout(this.refineTimer);
      this.refineTimer = null;
    }
  }

  private draw(latencyMs = 0, refine = false): void {
    const ctx = this.ctx;
    const canvas = this.viewReady ? this.canvasRef().nativeElement : null;

    if (!ctx || !canvas) {
      return;
    }

    this.syncCanvasSize(canvas);
    this.baseDirty = false;

    const index = this.currentIndex();
    const scene = this.sceneHidden ? null : this.scene;

    this.clearRefineTimer();

    const frame = this.renderer.draw(
      ctx,
      index ? scene : null,
      this.renderState(index ?? emptyIndex()),
      latencyMs,
      refine,
    );

    this.drawOverlay();

    // Interaction frames may have dropped detail to stay fluid: once the view rests, draw it complete.
    if (!refine && frame.mode !== 'empty' && frame.budgetScale < 1) {
      this.zone.runOutsideAngular(() => {
        this.refineTimer = setTimeout(() => {
          this.refineTimer = null;

          if (!this.drawFrame) {
            this.draw(0, true);
          }
        }, REFINE_DELAY_MS);
      });
    }
  }

  // Pointer, wheel and keyboard

  private hitTest(sx: number, sy: number): HoverTarget | null {
    const index = this.currentIndex();

    if (!this.scene || this.sceneHidden || !index) {
      return null;
    }

    return this.renderer.hitTest(this.scene, this.renderState(index), sx, sy);
  }

  private zoomIntoCell(level: number, cell: number): void {
    const index = this.currentIndex();

    if (!index) {
      return;
    }

    const bounds = this.renderer.cellBounds(index, level, cell);

    this.transform = fitTransform(bounds, this.width, this.height, { maxScale: 8 });
    this.userMoved = true;
    this.setHover(null);
    this.requestDraw();
  }

  private moveNode(node: number, x: number, y: number): void {
    const scene = this.scene;

    if (!scene) {
      return;
    }

    scene.positions[node * 2] = x;
    scene.positions[node * 2 + 1] = y;

    if (!this.movedMask || this.movedMask.length !== scene.snapshot.count) {
      this.movedMask = new Uint8Array(scene.snapshot.count);
    }

    if (!this.movedMask[node]) {
      this.movedMask[node] = 1;
      this.moved = [...this.moved, node];
    }
  }

  private bindEvents(canvas: HTMLCanvasElement, wrap: HTMLElement): void {
    let dragIndex = -1;
    let dragCell: { level: number; cell: number } | null = null;
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

    // No browser menu on the canvas: the secondary button drags like the primary one, and a right click without
    // movement resets the view (see `end`). Handled on release, as some platforms fire `contextmenu` on press.
    listen('contextmenu', (event) => event.preventDefault());

    listen('pointerdown', (event) => {
      if (!this.scene || (event.button !== 0 && event.button !== 2)) {
        return;
      }

      button = event.button;
      canvas.setPointerCapture?.(event.pointerId);
      down = last = position(event);
      moved = false;

      const target = this.hitTest(down.x, down.y);

      dragIndex = target?.kind === 'node' ? target.index : -1;
      dragCell = target?.kind === 'cell' ? { level: target.level, cell: target.cell } : null;
      // Cells pan like the background (a click without movement zooms into them).
      panning = dragIndex < 0;
      this.setHover(null);
    });

    listen('pointermove', (event) => {
      if (!this.scene) {
        return;
      }

      const point = position(event);

      if (Math.abs(point.x - down.x) > 4 || Math.abs(point.y - down.y) > 4) {
        moved = true;
      }

      if (dragIndex >= 0 && moved) {
        const world = screenToWorld(this.transform, point.x, point.y);

        this.moveNode(dragIndex, world.x, world.y);
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
        this.setHover(this.hitTest(point.x, point.y), point);
      }

      last = point;
    });

    const end = () => {
      if (!this.scene) {
        return;
      }

      if (!moved && button === 2 && (dragIndex >= 0 || panning)) {
        this.resetView();
      } else if (!moved && dragCell) {
        this.zoomIntoCell(dragCell.level, dragCell.cell);
      } else if (!moved && (dragIndex >= 0 || panning)) {
        const id = dragIndex >= 0 ? this.scene.snapshot.ids[dragIndex] : null;

        this.zone.run(() => this.nodeSelected.emit(id));
      }

      dragIndex = -1;
      dragCell = null;
      panning = false;
      this.requestDraw();
    };

    listen('pointerup', end);
    listen('pointercancel', () => {
      moved = true;
      end();
    });
    listen('pointerleave', () => this.setHover(null));
    listen(
      'wheel',
      (event) => {
        event.preventDefault();

        const point = position(event);

        this.transform = zoomAt(this.transform, point.x, point.y, Math.exp(-event.deltaY * 0.0015));
        this.userMoved = true;
        this.setHover(null);
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

  private setHover(target: HoverTarget | null, point?: { x: number; y: number }): void {
    // The tooltip stays where the hover started (no change detection per pointer move).
    if (sameTarget(target, this.hoverTarget)) {
      return;
    }

    this.hoverTarget = target;

    const scene = this.scene;
    const index = this.currentIndex();
    let info: HoverInfo | null = null;

    if (scene && index && target && point) {
      const x = Math.min(point.x + 14, Math.max(0, this.width - 260));
      const y = Math.min(point.y + 14, Math.max(0, this.height - 40));

      if (target.kind === 'node') {
        info = {
          kind: 'node',
          label: nodeLabel(scene.snapshot, target.index),
          type: scene.snapshot.typeNames[scene.snapshot.types[target.index]] ?? '',
          x,
          y,
        };
      } else {
        const summary = this.renderer.cellSummary(scene.snapshot, index, target.level, target.cell);
        const format = (value: number) => value.toLocaleString(this.locale);

        info = {
          kind: 'cell',
          count: format(summary.count),
          types: summary.types
            .slice(0, CLUSTER_TOOLTIP_TYPES)
            .map((entry) => ({ type: entry.type, count: format(entry.count) })),
          more: Math.max(0, summary.types.length - CLUSTER_TOOLTIP_TYPES),
          x,
          y: Math.min(point.y + 14, Math.max(0, this.height - 140)),
        };
      }
    }

    this.zone.run(() => this.hover.set(info));
    this.requestDraw(false);
  }
}

function sameTarget(a: HoverTarget | null, b: HoverTarget | null): boolean {
  if (!a || !b) {
    return a === b;
  }

  return a.kind === 'node'
    ? b.kind === 'node' && a.index === b.index
    : b.kind === 'cell' && a.level === b.level && a.cell === b.cell;
}

function emptyIndex(): SceneIndex {
  return { originX: 0, originY: 0, bounds: null, order: new Int32Array(0), edgeCount: 0, levels: [] };
}
