import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  NgZone,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import cytoscape from 'cytoscape';

import { fpcObserveBrandChanges, fpcReadBrandPalette } from '../brand-tokens/brand-tokens';
import { fpcGraphKindClass, fpcGraphStylesheet, type FpcGraphStyleOptions } from './graph-canvas.styles';
import type {
  FpcGraphEdge,
  FpcGraphEdgeSelectEvent,
  FpcGraphElement,
  FpcGraphElementHoverEvent,
  FpcGraphElementSelectEvent,
  FpcGraphHiddenKinds,
  FpcGraphHighlight,
  FpcGraphHighlightMap,
  FpcGraphLayout,
  FpcGraphPositions,
} from './graph-canvas.types';

/** Keys the component owns inside Cytoscape element data; user `data` cannot override them. */
const RESERVED_KEYS = ['id', 'parent', 'source', 'target', 'kind', 'label', '_width'] as const;
const ANIMATION_INTERVAL_MS = 50;

interface DesiredNode {
  id: string;
  parent: string | null;
  data: Record<string, unknown>;
  dataKey: string;
  classes: string;
  depth: number;
}

interface DesiredEdge {
  id: string;
  source: string;
  target: string;
  data: Record<string, unknown>;
  dataKey: string;
  classes: string;
}

/** Whether a real canvas renderer is available (false during SSR and in jsdom-based tests). */
function canRender(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  return !/jsdom/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent);
}

function toClassList(classes: string | readonly string[] | null | undefined): string[] {
  if (!classes) {
    return [];
  }

  return (typeof classes === 'string' ? classes.split(/\s+/) : [...classes]).filter(Boolean);
}

function highlightFor(map: FpcGraphHighlightMap | null, id: string): FpcGraphHighlight | undefined {
  if (!map) {
    return undefined;
  }

  return map instanceof Map ? map.get(id) : (map as Readonly<Record<string, FpcGraphHighlight>>)[id];
}

function stripReserved(data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = { ...(data ?? {}) };

  for (const key of RESERVED_KEYS) {
    delete result[key];
  }

  return result;
}

/** Edge width from a relative weight: 1.5 px default, log-scaled and clamped to 1–8 px. */
export function fpcGraphEdgeWidth(weight: number | null | undefined): number {
  if (weight === null || weight === undefined || !Number.isFinite(weight) || weight <= 0) {
    return 1.25;
  }

  // Calm strokes: 1.25 px at rest, log-scaled with traffic, capped at 6 px.
  return Math.min(6, Math.max(1.25, 1 + 0.75 * Math.log2(1 + weight)));
}

/** Stylesheet options from the document (density). */
function graphStyleOptions(): FpcGraphStyleOptions {
  return { compact: typeof document !== 'undefined' && document.body.classList.contains('fpc-density-compact') };
}

/** Default edge id when none is given. */
export function fpcGraphEdgeId(edge: FpcGraphEdge): string {
  return edge.id ?? `${edge.source}->${edge.target}${edge.kind ? `:${edge.kind}` : ''}`;
}

/**
 * Cytoscape.js graph canvas for topology views (sites, nodes, replicas, volumes, network edges).
 *
 * Inputs are applied incrementally: elements are diffed by id (add / remove / update data, move
 * parent) inside one batch, and the layout only re-runs when the structure (ids or parents)
 * changed, so live updates of hundreds of elements stay smooth. Colours come from the active brand
 * (`--bs-*` variables) and are re-read when `data-bs-theme` / `data-fpc-brand` change.
 */
@Component({
  selector: 'fpc-graph-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-graph-canvas' },
  template: `<div
    #container
    class="fpc-graph-canvas__container"
    [attr.aria-label]="ariaLabel()"
    [attr.aria-description]="fitHint() || null"
    role="img"
    tabindex="0"
    (keydown)="onKeydown($event)"
  ></div>`,
  styleUrl: './graph-canvas.component.scss',
})
export class FpcGraphCanvasComponent {
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  readonly elements = input<readonly FpcGraphElement[]>([]);
  readonly edges = input<readonly FpcGraphEdge[]>([]);
  readonly layout = input<FpcGraphLayout>('cose');
  /** Plan overlay: element / edge id → create | update | delete. */
  readonly highlight = input<FpcGraphHighlightMap | null>(null);
  /** Kinds (of elements and edges) that are hidden, i.e. switched-off layers. */
  readonly hiddenKinds = input<FpcGraphHiddenKinds | null>(null);
  /** Id of the selected element or edge (controlled). */
  readonly selectedId = input<string | null>(null);
  readonly ariaLabel = input('Graph');
  /**
   * Accessible description of the fit gesture (there is no fit button): a right-click on the background or `F` / `0`
   * while the canvas has focus fits the graph to the view. Consumers pass a localised text.
   */
  readonly fitHint = input('Right-click the background or press F to fit the graph to the view.');
  /** Minimum / maximum zoom level. */
  readonly minZoom = input(0.2);
  readonly maxZoom = input(3);

  /** Preset layout: leaf positions (model coordinates). */
  readonly positions = input<FpcGraphPositions | null>(null);
  /** Large graphs: texture while panning / zooming, edges hidden during viewport changes. */
  readonly performanceMode = input(false);
  /** Elements may be dragged (drag-to-place gestures); off = elements can't be grabbed, panning still works. */
  readonly draggable = input(true);

  /** Pointer over an element (null when it leaves), for popovers. */
  readonly elementHover = output<FpcGraphElementHoverEvent | null>();
  /** Zoom level after a viewport change (semantic zoom). */
  readonly zoomChange = output<number>();
  /** An element was dragged and released: its id and model position (drag-to-place gestures). */
  readonly elementDrop = output<{ id: string; position: { x: number; y: number } }>();
  readonly elementSelect = output<FpcGraphElementSelectEvent>();
  readonly edgeSelect = output<FpcGraphEdgeSelectEvent>();
  /** Emitted when the background is tapped (clears the selection). */
  readonly selectionClear = output<void>();

  private cy: cytoscape.Core | null = null;
  private readonly dataKeys = new Map<string, string>();
  private layoutRun: cytoscape.Layouts | null = null;
  private appliedLayout: FpcGraphLayout | null = null;
  private appliedPositions: FpcGraphPositions | null = null;
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private dashOffset = 0;
  private resizeObserver: ResizeObserver | null = null;
  private stopBrandObserver: (() => void) | null = null;

  constructor() {
    afterNextRender(() => this.init());

    effect(() => {
      const elements = this.elements();
      const edges = this.edges();
      const highlight = this.highlight();
      const hidden = this.hiddenKinds();
      const layout = this.layout();
      const positions = this.positions();

      untracked(() => {
        const moved = layout === 'preset' && positions !== this.appliedPositions;

        this.appliedPositions = positions;
        this.sync(elements, edges, highlight, hidden, layout, moved);
      });
    });

    effect(() => {
      const draggable = this.draggable();

      untracked(() => this.cy?.autoungrabify(!draggable));
    });

    effect(() => {
      const selectedId = this.selectedId();

      untracked(() => this.applySelection(selectedId));
    });

    this.destroyRef.onDestroy(() => this.teardown());
  }

  /** The underlying Cytoscape instance (null before the first render). Escape hatch for consumers. */
  get instance(): cytoscape.Core | null {
    return this.cy;
  }

  /** Fits all visible elements into the viewport. */
  /** Edges of the hovered / selected nodes come forward (stylesheet `edge.fpc-related`); the rest stays muted. */
  private markRelated(): void {
    const cy = this.cy;

    if (!cy) return;

    cy.edges('.fpc-related').removeClass('fpc-related');
    cy.nodes('.fpc-hover, :selected').connectedEdges().addClass('fpc-related');
  }

  fit(padding = 24): void {
    this.cy?.fit(undefined, padding);
  }

  /** Keyboard equivalent of the background right-click: `F` or `0` (no modifiers) fits the graph to the view. */
  onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'f' || event.key === 'F' || event.key === '0') {
      event.preventDefault();
      this.fit();
    }
  }

  /** Centres the viewport on an element or edge. */
  center(id: string): void {
    const target = this.cy?.getElementById(id);

    if (target && target.nonempty()) {
      this.cy?.center(target);
    }
  }

  /** Rendered bounding box of an element (relative to the container), e.g. for a popover on keyboard focus. */
  boxOf(id: string): FpcGraphElementHoverEvent['box'] | null {
    const target = this.cy?.getElementById(id);

    return target && target.nonempty() && target.isNode() ? this.renderedBox(target) : null;
  }

  /** Current zoom level. */
  zoom(): number {
    return this.cy?.zoom() ?? 1;
  }

  private renderedBox(node: cytoscape.NodeSingular): FpcGraphElementHoverEvent['box'] {
    const b = node.renderedBoundingBox({});

    return { x: b.x1, y: b.y1, width: b.w, height: b.h };
  }

  /** Re-runs the current layout over all elements. */
  relayout(): void {
    this.runLayout(this.layout(), true);
  }

  private init(): void {
    if (this.cy) {
      return;
    }

    const headless = !canRender();

    this.ngZone.runOutsideAngular(() => {
      this.cy = cytoscape({
        container: headless ? undefined : this.container().nativeElement,
        headless,
        styleEnabled: true,
        style: fpcGraphStylesheet(fpcReadBrandPalette(), graphStyleOptions()),
        minZoom: this.minZoom(),
        maxZoom: this.maxZoom(),
        boxSelectionEnabled: false,
        selectionType: 'single',
        textureOnViewport: this.performanceMode(),
        hideEdgesOnViewport: this.performanceMode(),
        pixelRatio: this.performanceMode() ? 1 : 'auto',
        autoungrabify: !this.draggable(),
      });

      this.cy.on('mouseover', 'node', (event) => {
        const node = event.target as cytoscape.NodeSingular;

        // Calm hover mark (stylesheet `node.fpc-hover`): one element at a time.
        this.cy?.nodes('.fpc-hover').removeClass('fpc-hover');
        node.addClass('fpc-hover');
        this.markRelated();
        this.ngZone.run(() =>
          this.elementHover.emit({
            id: node.id(),
            kind: node.data('kind') ?? null,
            data: this.userData(node),
            box: this.renderedBox(node),
          }),
        );
      });

      this.cy.on('select unselect', 'node', () => this.markRelated());
      this.cy.on('mouseout', 'node', (event) => {
        (event.target as cytoscape.NodeSingular).removeClass('fpc-hover');
        this.markRelated();
        this.ngZone.run(() => this.elementHover.emit(null));
      });

      this.cy.on('dragfree', 'node', (event) => {
        const node = event.target as cytoscape.NodeSingular;
        const position = { ...node.position() };

        this.ngZone.run(() => this.elementDrop.emit({ id: node.id(), position }));
      });

      this.cy.on('zoom', () => {
        const zoom = this.cy?.zoom() ?? 1;

        this.ngZone.run(() => this.zoomChange.emit(zoom));
      });

      this.cy.on('tap', 'node', (event) => {
        const node = event.target as cytoscape.NodeSingular;

        this.ngZone.run(() =>
          this.elementSelect.emit({ id: node.id(), kind: node.data('kind') ?? null, data: this.userData(node) }),
        );
      });

      this.cy.on('tap', 'edge', (event) => {
        const edge = event.target as cytoscape.EdgeSingular;

        this.ngZone.run(() =>
          this.edgeSelect.emit({
            id: edge.id(),
            kind: edge.data('kind') ?? null,
            source: edge.source().id(),
            target: edge.target().id(),
            data: this.userData(edge),
          }),
        );
      });

      this.cy.on('tap', (event) => {
        if (event.target === this.cy) {
          this.ngZone.run(() => this.selectionClear.emit());
        }
      });

      // Right-click on the background fits the graph to the view (Cytoscape already suppresses the browser's context
      // menu inside the canvas); right-clicks on elements do nothing, as before.
      this.cy.on('cxttap', (event) => {
        if (event.target === this.cy) this.fit();
      });

      if (!headless && typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.cy?.resize());
        this.resizeObserver.observe(this.container().nativeElement);
      }
    });

    this.stopBrandObserver = fpcObserveBrandChanges(() =>
      this.cy?.style(fpcGraphStylesheet(fpcReadBrandPalette(), graphStyleOptions())),
    );

    this.sync(this.elements(), this.edges(), this.highlight(), this.hiddenKinds(), this.layout());
    this.applySelection(this.selectedId());
  }

  private teardown(): void {
    this.stopAnimation();
    this.layoutRun?.stop();
    this.resizeObserver?.disconnect();
    this.stopBrandObserver?.();
    this.cy?.destroy();
    this.cy = null;
    this.dataKeys.clear();
  }

  private userData(element: cytoscape.SingularElementArgument): Record<string, unknown> {
    const data = { ...(element.data() as Record<string, unknown>) };

    for (const key of RESERVED_KEYS) {
      delete data[key];
    }

    return data;
  }

  private sync(
    elements: readonly FpcGraphElement[],
    edges: readonly FpcGraphEdge[],
    highlight: FpcGraphHighlightMap | null,
    hiddenKinds: FpcGraphHiddenKinds | null,
    layout: FpcGraphLayout,
    moved = false,
  ): void {
    const cy = this.cy;

    if (!cy) {
      return;
    }

    const hidden = hiddenKinds ? new Set(hiddenKinds) : new Set<string>();
    const nodes = this.desiredNodes(elements, highlight, hidden);
    const links = this.desiredEdges(edges, nodes, highlight, hidden);
    let structureChanged = false;

    cy.batch(() => {
      // 1. Add new nodes (parents first) and update existing ones.
      const ordered = [...nodes.values()].sort((a, b) => a.depth - b.depth);

      for (const node of ordered) {
        const existing = cy.getElementById(node.id);

        if (existing.empty()) {
          cy.add({
            group: 'nodes',
            data: { ...node.data, id: node.id, ...(node.parent ? { parent: node.parent } : {}) },
            classes: node.classes,
          });
          this.dataKeys.set(node.id, node.dataKey);
          structureChanged = true;
          continue;
        }

        if (!existing.isNode()) {
          continue;
        }

        const currentParent = (existing.data('parent') as string | undefined) ?? null;

        if (currentParent !== node.parent) {
          existing.move({ parent: node.parent });
          structureChanged = true;
        }

        this.updateElement(cy.getElementById(node.id), node.data, node.dataKey, node.classes);
      }

      // 2. Remove stale edges, then stale nodes (children that survive were moved above).
      const staleEdges = cy.edges().filter((edge) => !links.has(edge.id()));
      const staleNodes = cy.nodes().filter((node) => !nodes.has(node.id()));

      if (staleEdges.nonempty() || staleNodes.nonempty()) {
        structureChanged = true;
      }

      staleEdges.forEach((edge) => {
        this.dataKeys.delete(edge.id());
      });
      staleEdges.remove();
      staleNodes.forEach((node) => {
        this.dataKeys.delete(node.id());
      });
      staleNodes.remove();

      // 3. Add or update edges.
      for (const edge of links.values()) {
        const existing = cy.getElementById(edge.id);

        if (existing.empty()) {
          cy.add({
            group: 'edges',
            data: { ...edge.data, id: edge.id, source: edge.source, target: edge.target },
            classes: edge.classes,
          });
          this.dataKeys.set(edge.id, edge.dataKey);
          structureChanged = true;
          continue;
        }

        if (!existing.isEdge()) {
          continue;
        }

        if (existing.source().id() !== edge.source || existing.target().id() !== edge.target) {
          existing.move({ source: edge.source, target: edge.target });
          structureChanged = true;
        }

        this.updateElement(cy.getElementById(edge.id), edge.data, edge.dataKey, edge.classes);
      }
    });

    if (structureChanged || moved || this.appliedLayout !== layout) {
      this.runLayout(layout, this.appliedLayout !== layout);
    }

    this.updateAnimation();
    this.applySelection(this.selectedId());
  }

  private desiredNodes(
    elements: readonly FpcGraphElement[],
    highlight: FpcGraphHighlightMap | null,
    hidden: ReadonlySet<string>,
  ): Map<string, DesiredNode> {
    const byId = new Map<string, FpcGraphElement>();

    for (const element of elements) {
      byId.set(element.id, element);
    }

    const depthOf = (id: string): number => {
      let depth = 0;
      let current = byId.get(id)?.parent ?? null;
      const seen = new Set<string>([id]);

      while (current && byId.has(current) && !seen.has(current)) {
        seen.add(current);
        depth += 1;
        current = byId.get(current)?.parent ?? null;
      }

      return depth;
    };
    const result = new Map<string, DesiredNode>();

    for (const element of byId.values()) {
      const kind = element.kind ?? null;
      const parent =
        element.parent && element.parent !== element.id && byId.has(element.parent) ? element.parent : null;
      const change = highlightFor(highlight, element.id);
      const classes = [...toClassList(element.classes)];

      if (kind) {
        classes.push(fpcGraphKindClass(kind));
      }

      if (change) {
        classes.push(`fpc-change-${change}`);
      }

      if (element.status) {
        classes.push(`fpc-status-${element.status}`);
      }

      if (kind && hidden.has(kind)) {
        classes.push('fpc-hidden');
      }

      const data = { ...stripReserved(element.data), kind, label: element.label ?? '' };

      result.set(element.id, {
        id: element.id,
        parent,
        data,
        dataKey: JSON.stringify(data),
        classes: classes.join(' '),
        depth: depthOf(element.id),
      });
    }

    // Break parent cycles: an element whose ancestor chain loops back is detached.
    for (const node of result.values()) {
      let current = node.parent;
      const seen = new Set<string>([node.id]);

      while (current) {
        if (seen.has(current)) {
          node.parent = null;
          break;
        }

        seen.add(current);
        current = result.get(current)?.parent ?? null;
      }
    }

    return result;
  }

  private desiredEdges(
    edges: readonly FpcGraphEdge[],
    nodes: ReadonlyMap<string, DesiredNode>,
    highlight: FpcGraphHighlightMap | null,
    hidden: ReadonlySet<string>,
  ): Map<string, DesiredEdge> {
    const result = new Map<string, DesiredEdge>();

    for (const edge of edges) {
      const id = fpcGraphEdgeId(edge);

      if (!nodes.has(edge.source) || !nodes.has(edge.target) || nodes.has(id)) {
        continue;
      }

      const kind = edge.kind ?? null;
      const change = highlightFor(highlight, id);
      const classes = [...toClassList(edge.classes)];

      if (kind) {
        classes.push(fpcGraphKindClass(kind));
      }

      if (edge.animated) {
        classes.push('fpc-edge--animated');
      }

      if (change) {
        classes.push(`fpc-change-${change}`);
      }

      if (kind && hidden.has(kind)) {
        classes.push('fpc-hidden');
      }

      const data = {
        ...stripReserved(edge.data),
        kind,
        label: edge.label ?? '',
        weight: edge.weight ?? null,
        animated: !!edge.animated,
        _width: fpcGraphEdgeWidth(edge.weight),
      };

      result.set(id, {
        id,
        source: edge.source,
        target: edge.target,
        data,
        dataKey: JSON.stringify(data),
        classes: classes.join(' '),
      });
    }

    return result;
  }

  private updateElement(
    element: cytoscape.CollectionReturnValue,
    data: Record<string, unknown>,
    dataKey: string,
    classes: string,
  ): void {
    const id = element.id();

    if (this.dataKeys.get(id) !== dataKey) {
      element.removeData();
      element.data(data);
      this.dataKeys.set(id, dataKey);
    }

    if (element.classes().join(' ') !== classes) {
      element.classes(classes);
    }
  }

  private runLayout(layout: FpcGraphLayout, fit: boolean): void {
    const cy = this.cy;

    if (!cy || cy.elements().empty()) {
      this.appliedLayout = layout;

      return;
    }

    this.layoutRun?.stop();

    const firstRun = this.appliedLayout === null;
    const options = this.layoutOptions(layout, fit || firstRun);

    this.appliedLayout = layout;
    this.ngZone.runOutsideAngular(() => {
      this.layoutRun = cy.elements().layout(options);
      this.layoutRun.run();
    });
  }

  private layoutOptions(layout: FpcGraphLayout, fit: boolean): cytoscape.LayoutOptions {
    const common = { fit, padding: 24, animate: false } as const;

    switch (layout) {
      case 'breadthfirst':
        return { ...common, name: 'breadthfirst', directed: true, spacingFactor: 1.1 };
      case 'grid':
        return { ...common, name: 'grid', avoidOverlap: true };
      case 'concentric':
        return { ...common, name: 'concentric', minNodeSpacing: 24 };
      case 'preset': {
        const positions = this.positions() ?? {};

        return {
          ...common,
          name: 'preset',
          positions: (node: cytoscape.NodeSingular) => positions[node.id()] ?? { x: 0, y: 0 },
        } as cytoscape.LayoutOptions;
      }
      case 'cose':
      default:
        return {
          ...common,
          name: 'cose',
          // Start from current positions on incremental updates so the graph does not jump.
          randomize: fit,
          nodeDimensionsIncludeLabels: true,
          componentSpacing: 60,
          nodeRepulsion: () => 8000,
          idealEdgeLength: () => 60,
        };
    }
  }

  private applySelection(selectedId: string | null): void {
    const cy = this.cy;

    if (!cy) {
      return;
    }

    const selected = cy.$(':selected');

    if (selectedId && selected.length === 1 && selected.id() === selectedId) {
      return;
    }

    cy.batch(() => {
      selected.unselect();

      if (selectedId) {
        cy.getElementById(selectedId).select();
      }
    });
  }

  private updateAnimation(): void {
    const cy = this.cy;
    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!cy || !canRender() || reducedMotion || cy.edges('.fpc-edge--animated').empty()) {
      this.stopAnimation();

      return;
    }

    if (this.animationTimer) {
      return;
    }

    this.ngZone.runOutsideAngular(() => {
      this.animationTimer = setInterval(() => {
        const animated = this.cy?.edges('.fpc-edge--animated:visible');

        if (!animated || animated.empty()) {
          return;
        }

        this.dashOffset = (this.dashOffset - 1) % 1200;
        animated.style('line-dash-offset', this.dashOffset);
      }, ANIMATION_INTERVAL_MS);
    });
  }

  private stopAnimation(): void {
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
  }
}
