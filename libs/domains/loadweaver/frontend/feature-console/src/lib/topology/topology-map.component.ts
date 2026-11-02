import { CommonModule, NgTemplateOutlet } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  OnInit,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleNodesFacade,
  ConsolePlansFacade,
  ConsolePoliciesFacade,
  ConsoleResourcesFacade,
  ConsoleTopologyFacade,
  ConsoleVirtualMachinesFacade,
  type GroupMember,
  type GroupMembers,
  type Plan,
  type TopologyChange,
  type TopologyTraceStep,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcDropdownComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcGraphCanvasComponent,
  FpcKeyValueListComponent,
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcListToolbarComponent,
  FpcLoadingOverlayComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
  type FpcBadgeTone,
  type FpcFilterChip,
  type FpcGraphEdgeSelectEvent,
  type FpcGraphElementHoverEvent,
  type FpcGraphElementSelectEvent,
  type FpcKeyValueItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { debounceTime, filter, interval, Subject, take } from 'rxjs';

import { parseSearch, searchChips } from '../list-search';
import { isoToLocalInput } from '../logs/logs-format';
import { removeContentsTerm } from '../objects/object-contents';
import { objectRoute, type ObjectRoute } from '../objects/object-route';
import { RESOURCE_SEARCH_FIELDS } from '../objects/resource-tree';
import { PLAN_STATUS_BADGE_TONE, planStatusLabel } from '../plans/plan-format';
import { injectSectionScope } from '../section/section-scope';
import { ResourcesContextService } from '../objects/resources-context.service';
import { mayDraft, type WorkspaceAction } from '../workspace/workspace-actions';
import { workspaceCanvas } from '../workspace/workspace-canvas';
import { draftChanges, draftOpKey, draftOpOf, resourceDocument } from '../workspace/workspace-draft';
import { workspaceHealthLabel, workspaceHealthTone, workspaceKindIcon } from '../workspace/workspace-format';
import {
  dropTarget,
  migrationEdges,
  movable,
  needsPinReason,
  withPlacement,
  type PlacementTarget,
} from '../workspace/workspace-gestures';
import {
  WORKSPACE_LAYOUT_ASPECT,
  workspaceLayout,
  workspaceLayoutKey,
  workspaceVisibleItems,
  workspaceZoomLevel,
  type WorkspaceBox,
  type WorkspaceZoomLevel,
} from '../workspace/workspace-layout';
import { WorkspaceLayoutWorker } from '../workspace/workspace-layout.worker';
import {
  workspaceItemChange,
  workspaceStatus,
  type WorkspaceItem,
  type WorkspaceModel,
} from '../workspace/workspace-model';
import {
  formatRate,
  TOPOLOGY_MAP_LAYERS,
  topologyDetails,
  topologyEdgeLinks,
  topologyHiddenKinds,
  topologyHighlight,
  topologyEdgeKindLabel,
  topologyLayerLabel,
  type TopologyLink,
  topologyTraceKindLabel,
  type TopologyMapLayer,
} from './topology-format';
import {
  parseTopologyUrl,
  topologyMatches,
  topologyScopeIds,
  topologyUrlParams,
  withinScope,
  type TopologyMode,
  type TopologyScope,
} from './topology-view';
import { type SavedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

/** Structure re-poll while live and no socket announces changes (3.36 B3). */
const STRUCTURE_REFRESH_MS = 60_000;
/** The timeline slider covers the last day, in minutes. */
const TIMELINE_MINUTES = 24 * 60;
const MINUTE_MS = 60_000;
/** Drawn items from which the map starts far out (L1) and lays out in a worker. */
const LARGE_MAP = 1500;
/** Search hits kept visible at every zoom level up to this many. */
const KEEP_MATCHES = 200;
/** Cached layouts (by key) per page. */
const LAYOUT_CACHE = 8;

/**
 * Observe › Topology (3.37, view-first): the cluster map (sites ⊃ nodes ⊃ services / VMs / volumes, edge layers, worker
 * layout, semantic zoom) with a one-row toolbar (mode live / timeline / plan, layers ▾, time or plan, path trace, "Edit
 * on map"), the shared `SearchSyntax` search and a 360 px inspector (Workbench). Overlays: live traffic, a past minute,
 * a pending plan (with live progress and migration arrows) and the app-wide draft (its ops + the dry-run preview).
 * Drag-to-place only while "Edit on map" is on; it writes into the app-wide draft (new policies come from the top-bar
 * Create ▾ / the Policies tables, 2026-10-29: no drawing on the map).
 *
 * With a `scope` (Site / Project object pages' Topology tab) it shows that part of the map, live only, and keeps its
 * state out of the URL; the full page is one click away. Inside the object page's scoped section (deployment Network
 * tab) it selects the scope's `select` element instead of reading `?select=`.
 */
@Component({
  selector: 'loadweaver-topology-map',
  imports: [
    LoadweaverSavedViewsComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcDropdownComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcGraphCanvasComponent,
    FpcKeyValueListComponent,
    FpcLaneHeaderComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcListToolbarComponent,
    FpcLoadingOverlayComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
    NgTemplateOutlet,
  ],
  templateUrl: './topology-map.component.html',
  styleUrl: './topology-map.component.scss',
  // A routed page (`.fpc-page`: flex column, top edge; embedded in an object tab the edge goes away).
  host: { class: 'lw-topology fpc-page min-w-0' },
  standalone: true,
})
export class LoadweaverTopologyMapComponent implements OnInit, OnDestroy {
  private readonly facade = inject(ConsoleTopologyFacade);
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly plansFacade = inject(ConsolePlansFacade);
  private readonly accessFacade = inject(ConsoleAccessFacade);
  private readonly resourcesFacade = inject(ConsoleResourcesFacade);
  private readonly nodesFacade = inject(ConsoleNodesFacade);
  private readonly vmsFacade = inject(ConsoleVirtualMachinesFacade);
  private readonly policiesFacade = inject(ConsolePoliciesFacade);
  private readonly endpoints = inject(ConsoleEndpointService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  /** Model, access, action registry + runner and the draft (provided by the Resources shell or the route). */
  readonly context = inject(ResourcesContextService);
  private readonly timeline$ = new Subject<string>();
  private readonly layoutWorker = new WorkspaceLayoutWorker();
  private readonly layoutCache = new Map<string, ReadonlyMap<string, WorkspaceBox>>();
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  /** The object page's section scope (deployment Network tab: `{ project, select }`), if any. */
  private readonly sectionScope = injectSectionScope();

  /** A Site / Project page's part of the map (null: Observe › Topology, the whole cluster with modes and URL). */
  readonly scope = input<TopologyScope | null>(null);

  readonly canvas = viewChild(FpcGraphCanvasComponent);

  readonly graph = toSignal(this.facade.graph$, { initialValue: null });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly at = toSignal(this.facade.at$, { initialValue: null });
  readonly overlay = toSignal(this.facade.overlay$, { initialValue: null });
  readonly liveConnected = toSignal(this.facade.liveConnected$, { initialValue: false });
  readonly liveError = toSignal(this.facade.liveError$, { initialValue: null });
  readonly traceHost = toSignal(this.facade.traceHost$, { initialValue: null });
  readonly traceSteps = toSignal(this.facade.traceSteps$, { initialValue: [] as TopologyTraceStep[] });
  readonly traceLoading = toSignal(this.facade.traceLoading$, { initialValue: false });
  readonly traceError = toSignal(this.facade.traceError$, { initialValue: null });
  readonly plans = toSignal(this.plansFacade.plans$, { initialValue: [] as Plan[] });
  readonly plansLoading = toSignal(this.plansFacade.loading$, { initialValue: false });
  readonly clusterRole = toSignal(this.accessFacade.seesInfrastructure$, { initialValue: false });
  readonly groupMembers = toSignal(this.policiesFacade.members$, { initialValue: null as GroupMembers | null });
  readonly vmActionError = toSignal(this.vmsFacade.actionError$, { initialValue: null });
  readonly nodeActionError = toSignal(this.nodesFacade.actionError$, { initialValue: null });

  readonly embedded = computed(() => this.scope() !== null);
  readonly mode = signal<TopologyMode>('live');
  readonly layers = signal<ReadonlySet<TopologyMapLayer>>(new Set(TOPOLOGY_MAP_LAYERS));
  readonly query = signal('');
  readonly selectedId = signal<string | null>(null);
  /** "Views ▾" (3.37): saved search + layers of the map, per user (the URL follows through `syncUrl`). */
  readonly views: SavedViewBinding = {
    state: computed(() => ({ query: this.query(), layers: [...this.layers()].sort() })),
    apply: (state) => {
      const layers = Array.isArray(state['layers'])
        ? TOPOLOGY_MAP_LAYERS.filter((layer) => (state['layers'] as unknown[]).includes(layer))
        : TOPOLOGY_MAP_LAYERS;

      this.query.set(typeof state['query'] === 'string' ? state['query'] : '');
      this.layers.set(new Set(layers));
    },
  };
  readonly hover = signal<FpcGraphElementHoverEvent | null>(null);
  /** Timeline: minutes before now on the slider, and the chosen time. */
  readonly minutesBack = signal(60);
  readonly timelineAt = signal<string>(new Date(Date.now() - 60 * MINUTE_MS).toISOString());
  readonly planId = signal<string | null>(null);
  readonly hostInput = signal('');
  readonly layersOpen = signal(false);
  /** "Edit on map": drag-to-place writes into the app-wide draft. */
  readonly editing = signal(false);
  /** Drag-to-place waiting for its pin reason (node pins, 3.12). */
  readonly pendingMove = signal<{ item: WorkspaceItem; target: PlacementTarget } | null>(null);
  readonly pinReason = signal('');
  /** Semantic zoom (3.36 P5): L0 sites … L3 replicas; large clusters start far out. */
  readonly zoomLevel = signal<WorkspaceZoomLevel | null>(null);
  readonly layoutBoxes = signal<ReadonlyMap<string, WorkspaceBox> | null>(null);

  readonly model = computed<WorkspaceModel>(() => this.context.model());
  readonly scopeIds = computed(() => topologyScopeIds(this.model(), this.scope()));
  readonly pendingPlans = computed(() => this.plans().filter((p) => p.status === 'pending'));
  readonly selectedPlan = computed(() => this.plans().find((p) => p.id === this.planId()) ?? null);
  readonly hiddenKinds = computed(() => topologyHiddenKinds(this.layers()));
  readonly offLayers = computed(
    () =>
      TOPOLOGY_MAP_LAYERS.filter((layer) => !this.layers().has(layer) && (layer !== 'traffic' || this.clusterRole()))
        .length,
  );
  readonly tracedIds = computed(() => this.traceSteps().map((s) => s.id));
  readonly parsedQuery = computed(() => parseSearch(this.query(), RESOURCE_SEARCH_FIELDS));
  readonly chips = computed<FpcFilterChip[]>(() => searchChips(this.parsedQuery()));
  readonly matching = computed(() => {
    const matches = topologyMatches(this.model(), this.query());

    return matches ? withinScope(matches, this.scopeIds()) : null;
  });
  /** What the active draft changes: its ops, plus the dry-run preview's overlay once previewed. */
  readonly draftOverlay = computed<Record<string, TopologyChange> | null>(() => {
    const draft = this.context.draft;
    const active = draft?.active() ?? null;

    if (!active) return null;

    const existing = new Set(
      this.context
        .resources()
        .map((r) => draftOpKey({ kind: r.kind, name: r.metadata.name, project: r.metadata.project ?? null })),
    );

    return { ...(draft?.preview()?.topology.overlay ?? {}), ...draftChanges(active, existing) };
  });
  readonly effectiveLevel = computed<WorkspaceZoomLevel>(
    () => this.zoomLevel() ?? (this.allDrawn().size > LARGE_MAP ? 1 : 3),
  );
  /** Kept in at every level: the selection, search hits and the traced path (their containers come along). */
  readonly keep = computed<string[]>(() => {
    const matching = this.matching();
    const selected = this.selectedId();

    return [
      ...(selected ? [selected] : []),
      ...(matching && matching.size <= KEEP_MATCHES ? [...matching] : []),
      ...this.tracedIds(),
    ];
  });
  /** Every drawn item of the scope: the layout covers all of them, so nothing jumps between zoom levels. */
  readonly allDrawn = computed(() => withinScope(workspaceVisibleItems(this.model(), 3), this.scopeIds()));
  readonly visible = computed(() =>
    withinScope(workspaceVisibleItems(this.model(), this.effectiveLevel(), this.keep()), this.scopeIds()),
  );
  readonly highlight = computed(() =>
    topologyHighlight(this.mode() === 'plan' ? this.overlay() : this.draftOverlay(), this.tracedIds()),
  );
  /** Migration arrows: the plan's (plan mode) or the draft preview's computed moves. */
  readonly migrations = computed(() =>
    migrationEdges(
      this.model(),
      this.visible(),
      this.mode() === 'plan'
        ? this.selectedPlan()?.workloadChanges
        : this.context.draft?.preview()?.plan.workloadChanges,
    ),
  );
  readonly canvasData = computed(() =>
    workspaceCanvas(this.model(), this.visible(), {
      animated: this.mode() === 'live',
      overlay: this.highlight(),
      matching: this.matching(),
      edges: [...this.model().edges, ...this.migrations()],
      boxes: this.layoutBoxes() ?? undefined,
    }),
  );
  readonly flowTotals = computed(() => {
    const flows = (this.graph()?.edges ?? []).filter((e) => e.kind === 'flow');

    return {
      count: flows.length,
      denied: flows.filter((e) => e.data['decision'] === 'denied').length,
      bytesPerSecond: flows.reduce((sum, e) => sum + Number(e.data['bytesPerSecond'] ?? 0), 0),
    };
  });
  readonly selectedItem = computed<WorkspaceItem | null>(() => {
    const id = this.selectedId();

    return id ? (this.model().byId.get(id) ?? null) : null;
  });
  readonly selectedEdge = computed(() => {
    const id = this.selectedId();

    return id && !this.selectedItem() ? (this.canvasData().edges.find((e) => e.id === id) ?? null) : null;
  });
  readonly hoverItem = computed(() => {
    const h = this.hover();

    return h ? (this.model().byId.get(h.id) ?? null) : null;
  });
  /** May the caller put anything into a draft (a project role ≥ developer or a cluster write role)? */
  readonly mayEdit = computed(() => {
    const access = this.context.access();

    return (
      !access.readOnly &&
      (access.clusterRole === 'cluster-admin' ||
        access.clusterRole === 'infra-operator' ||
        Object.values(access.projects).some((r) => r !== 'viewer'))
    );
  });
  readonly inspectorOpen = computed(() => !!this.selectedId() || !!this.traceHost());

  readonly allLayers = TOPOLOGY_MAP_LAYERS;
  readonly layerLabel = topologyLayerLabel;
  readonly formatRate = formatRate;
  readonly timelineMinutes = TIMELINE_MINUTES;
  readonly kindIcon = workspaceKindIcon;
  readonly healthLabel = workspaceHealthLabel;
  readonly statusOf = workspaceStatus;

  readonly modeLabel = $localize`:@@lwConsoleTopology-mode:View`;
  readonly liveLabel = $localize`:@@lwConsoleTopology-live:Live`;
  readonly timelineLabel = $localize`:@@lwConsoleTopology-timeline:Timeline`;
  readonly planLabel = $localize`:@@lwConsoleTopology-plan:Plan`;
  readonly refreshLabel = $localize`:@@lwConsoleTopology-refresh:Refresh`;
  /** The canvas has no fit button: right-click on the background or F / 0 fits the map (read by screen readers). */
  readonly fitHint = $localize`:@@lwConsoleTopology-fitHint:Right-click the background or press F to fit the map to the view.`;
  readonly layersLabel = $localize`:@@lwConsoleTopology-layers:Layers`;
  readonly mapLabel = $localize`:@@lwConsoleTopology-mapLabel:Cluster topology map`;
  readonly traceLabel = $localize`:@@lwConsoleTopology-trace:Path trace`;
  readonly edgeKindLabel = topologyEdgeKindLabel;
  /** Trace steps in path order (the step number is the order, not an id). */
  readonly traceRows = computed(() => this.traceSteps().map((step, i) => ({ ...step, step: i + 1 })));
  /** 3.38 D1: step · kind · what. */
  readonly traceColumns: FpcTableColumn<TopologyTraceStep & { step: number }>[] = [
    {
      id: 'step',
      label: $localize`:@@lwConsoleTopology-colStep:Step`,
      value: (s) => s.step,
      align: 'end',
      width: '4rem',
      priority: 1,
    },
    {
      id: 'kind',
      label: $localize`:@@lwConsoleTopology-colKind:Kind`,
      value: (s) => topologyTraceKindLabel(s.kind),
      priority: 1,
    },
    {
      id: 'label',
      label: $localize`:@@lwConsoleTopology-colWhat:What`,
      value: (s) => s.label,
      required: true,
      priority: 1,
    },
  ];
  readonly tracePlaceholder = $localize`:@@lwConsoleTopology-tracePlaceholder:Hostname, e.g. shop.example.com`;
  readonly sliderLabel = $localize`:@@lwConsoleTopology-slider:Time (last 24 hours)`;
  readonly atLabel = $localize`:@@lwConsoleTopology-at:Time`;
  readonly planSelectLabel = $localize`:@@lwConsoleTopology-planSelect:Pending plan`;
  readonly detailsTitle = $localize`:@@lwConsoleTopology-details:Details`;
  readonly closeLabel = $localize`:@@lwConsoleTopology-close:Close`;
  readonly actionsLabel = $localize`:@@lwConsoleTopology-actions:Actions`;
  readonly title = $localize`:@@lwConsoleObserve-topologyTitle:Topology`;
  readonly searchLabel = $localize`:@@lwConsoleTopology-search:Search the map`;
  readonly searchHint = $localize`:@@lwConsoleTopology-searchHint:Filter with kind:, project:, status:, node: or site:`;
  readonly loadingLabel = $localize`:@@lwConsoleTopology-loading:Loading the map`;
  readonly traceLoadingLabel = $localize`:@@lwConsoleTopology-traceLoading:Tracing the path`;
  readonly planTone = PLAN_STATUS_BADGE_TONE;
  readonly planStatusLabel = planStatusLabel;
  readonly editLabel = $localize`:@@lwConsoleTopology-editOnMap:Edit on map`;
  readonly openObjectLabel = $localize`:@@lwConsoleTopology-openObject:Open object page`;
  readonly openFullLabel = $localize`:@@lwConsoleTopology-openFull:Open in Observe › Topology`;
  readonly allLayersLabel = $localize`:@@lwConsoleTopology-allLayers:Show all layers`;
  readonly revertLabel = $localize`:@@lwConsoleWorkspace-revert:Undo in draft`;
  readonly cancelLabel = $localize`:@@lwConsoleWorkspace-cancel:Cancel`;
  readonly confirmTitle = $localize`:@@lwConsoleWorkspace-confirmTitle:Run this action?`;
  readonly pinTitle = $localize`:@@lwConsoleWorkspace-pinTitle:Pin to this node?`;
  readonly pinReasonLabel = $localize`:@@lwConsoleWorkspace-pinReason:Why must it run on this node?`;
  readonly pinConfirm = $localize`:@@lwConsoleWorkspace-pinConfirm:Pin in the draft`;
  readonly chipsLabel = $localize`:@@lwConsoleTopology-chips:Active filters`;

  constructor() {
    // Layout: sync for small maps, in the worker for large ones; cached by its key (same items = same layout).
    effect(() => {
      const model = this.model();
      const all = this.allDrawn();

      untracked(() => void this.relayoutMap(model, all));
    });

    // Fit on load and whenever the data brings a new layout (topology round 2): the canvas only fits its first layout
    // run, which happens before the boxes arrive, so groups were clipped right / bottom. Live updates of the same items
    // keep their layout (cached by key) and so keep the user's zoom.
    effect((onCleanup) => {
      const boxes = this.layoutBoxes();
      const canvas = this.canvas();

      if (!boxes || !canvas) return;

      const timer = setTimeout(() => canvas.fit(), 0);

      onCleanup(() => clearTimeout(timer));
    });

    // Plan mode follows the plan live (progress, approvals) through `socket/plans`.
    effect(() => {
      const planMode = this.mode() === 'plan';

      untracked(() => (planMode ? this.plansFacade.connectLive() : this.plansFacade.disconnectLive()));
    });

    // The full page keeps its state in the URL (deep links); a scoped tab doesn't.
    effect(() => {
      this.query();
      this.selectedId();
      this.layers();
      this.mode();
      this.planId();
      this.timelineAt();
      untracked(() => this.syncUrl());
    });
  }

  ngOnInit(): void {
    this.policiesFacade.load();
    this.timeline$
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.loadTimeline(value));

    if (this.embedded()) {
      // The scoped section (deployment Network tab) names the element to select; the URL stays the object page's.
      const select = this.sectionScope?.params()['select'];

      if (select) this.select(select);

      // The Resources shell loads structure + resources and keeps them fresh; traffic comes on top for cluster roles.
      this.context.start();
      this.accessFacade.settled$
        .pipe(
          filter((settled) => settled),
          take(1),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe(() => {
          if (this.clusterRole()) this.facade.load({ flows: true }, true);
        });

      return;
    }

    const params = this.route.snapshot.queryParamMap;
    const state = parseTopologyUrl(Object.fromEntries(params.keys.map((k) => [k, params.get(k)])));

    this.query.set(state.q);
    this.layers.set(new Set(state.layers));
    this.planId.set(state.plan);

    if (state.at) {
      this.timelineAt.set(state.at);
      this.minutesBack.set(
        Math.min(TIMELINE_MINUTES, Math.max(0, Math.round((Date.now() - Date.parse(state.at)) / MINUTE_MS))),
      );
    }

    if (state.select) this.select(state.select);

    this.resourcesFacade.load();
    this.resourcesFacade.loadKinds();
    this.nodesFacade.load(true);

    // The view depends on the caller's role (traffic for cluster roles only): wait until access is known.
    this.accessFacade.settled$
      .pipe(
        filter((settled) => settled),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.setMode(state.mode, true));

    interval(STRUCTURE_REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.mode() === 'live' && !this.liveConnected()) this.facade.load({ flows: this.clusterRole() }, true);
      });
  }

  ngOnDestroy(): void {
    this.layoutWorker.terminate();
    this.plansFacade.disconnectLive();

    if (this.hoverTimer) clearTimeout(this.hoverTimer);

    // A scoped tab shares the Resources shell's live connection.
    if (!this.embedded()) this.facade.disconnectLive();
  }

  // ------------------------------------------------------------------------------------------------- modes / time

  /** `initial`: the mode from the URL on load (keeps `?select=`); a switch clears the selection. */
  setMode(mode: TopologyMode, initial = false): void {
    // Timeline is about traffic, which only cluster roles see; scoped tabs are live only.
    const next = this.embedded() || (mode === 'timeline' && !this.clusterRole()) ? 'live' : mode;

    this.mode.set(next);

    if (!initial) this.select(null);
    this.facade.disconnectLive();

    if (next === 'live') {
      this.facade.load({ flows: this.clusterRole() });
      // Live for everyone (3.36 B3): structure changes reach project members too; flows stay with cluster roles.
      this.facade.connectLive();
    } else if (next === 'timeline') {
      this.loadTimeline(this.timelineAt());
    } else {
      this.plansFacade.load({ status: 'pending' });
      this.loadPlan();
    }
  }

  refresh(): void {
    if (this.embedded()) {
      this.context.reload();

      if (this.clusterRole()) this.facade.load({ flows: true }, true);

      return;
    }

    this.resourcesFacade.load(true);
    this.nodesFacade.load(true);

    switch (this.mode()) {
      case 'live':
        this.facade.load({ flows: this.clusterRole() });
        break;
      case 'timeline':
        this.loadTimeline(this.timelineAt());
        break;
      default:
        this.plansFacade.load({ status: 'pending' });
        this.loadPlan();
    }
  }

  toggleLayer(layer: TopologyMapLayer, on: boolean): void {
    const next = new Set(this.layers());

    if (on) next.add(layer);
    else next.delete(layer);

    this.layers.set(next);
  }

  resetLayers(): void {
    this.layers.set(new Set(TOPOLOGY_MAP_LAYERS));
  }

  onSlider(value: number | string): void {
    const minutes = Number(value);

    this.minutesBack.set(minutes);
    this.timeline$.next(new Date(Date.now() - minutes * MINUTE_MS).toISOString());
  }

  /** `datetime-local` value (local time, no zone). */
  onAtInput(value: string): void {
    const time = Date.parse(value);

    if (Number.isNaN(time)) return;

    this.minutesBack.set(Math.min(TIMELINE_MINUTES, Math.max(0, Math.round((Date.now() - time) / MINUTE_MS))));
    this.timeline$.next(new Date(time).toISOString());
  }

  localAt(): string {
    return isoToLocalInput(this.timelineAt());
  }

  onPlanChange(id: string | null): void {
    this.planId.set(id || null);
    this.loadPlan();
  }

  planName(plan: Plan): string {
    const names = plan.changes.filter((c) => c.action !== 'unchanged').map((c) => `${c.kind} ${c.name}`);

    return `${plan.id.slice(0, 8)} (${names.slice(0, 3).join(', ')}${names.length > 3 ? ' …' : ''})`;
  }

  // ---------------------------------------------------------------------------------------------- search / trace

  removeChip(chip: FpcFilterChip): void {
    this.query.set(removeContentsTerm(this.query(), chip.id));
  }

  trace(host = this.hostInput()): void {
    const value = host.trim().toLowerCase();

    this.hostInput.set(value);

    if (value) this.facade.trace(value);
  }

  clearTrace(): void {
    this.hostInput.set('');
    this.facade.clearTrace();
  }

  focus(step: TopologyTraceStep): void {
    this.select(step.id);
    this.canvas()?.center(step.id);
  }

  // ------------------------------------------------------------------------------------------ selection / inspector

  select(id: string | null): void {
    const item = id ? this.model().byId.get(id) : undefined;

    // A VM's power actions come with its detail.
    if (item?.kind === 'vm' && item.project) this.vmsFacade.open(item.project, item.label, true);

    this.selectedId.set(id);
    this.hover.set(null);
  }

  clearSelection(): void {
    this.select(null);
  }

  onElementSelect(event: FpcGraphElementSelectEvent): void {
    this.select(event.id);
  }

  onEdgeSelect(event: FpcGraphEdgeSelectEvent): void {
    this.selectedId.set(event.id);
  }

  /** Semantic zoom: only a level change re-instantiates items. */
  onZoom(zoom: number): void {
    const level = workspaceZoomLevel(zoom);

    if (level !== this.effectiveLevel()) this.zoomLevel.set(level);
  }

  onHover(event: FpcGraphElementHoverEvent | null): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);

    this.hoverTimer = null;

    if (event) this.hover.set(event);
    else this.hoverTimer = setTimeout(() => this.hover.set(null), 400);
  }

  /** The popover stays while the pointer moves onto it (its actions are clickable). */
  keepPopover(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);

    this.hoverTimer = null;
  }

  objectRouteOf(item: WorkspaceItem): ObjectRoute | null {
    return objectRoute(item);
  }

  actsOf(item: WorkspaceItem): WorkspaceAction[] {
    return this.context.actionsOf(item).filter((a) => a.group === 'act');
  }

  draftActsOf(item: WorkspaceItem): WorkspaceAction[] {
    return this.context.actionsOf(item).filter((a) => a.group === 'draft');
  }

  linksOf(item: WorkspaceItem): WorkspaceAction[] {
    return this.context.actionsOf(item).filter((a) => a.group === 'link');
  }

  /** The popover's buttons: act now, then the draft's edit / delete. */
  popoverActions(item: WorkspaceItem): WorkspaceAction[] {
    return this.context.actionsOf(item).filter((a) => a.group !== 'link');
  }

  run(action: WorkspaceAction, item: WorkspaceItem | null = null): void {
    this.hover.set(null);
    this.context.run(action, item ?? this.selectedItem());
  }

  inDraft(item: WorkspaceItem): boolean {
    return !!draftOpOf(this.context.draft?.active() ?? null, item.resource);
  }

  async revert(item: WorkspaceItem): Promise<void> {
    if (item.resource) await this.context.draft?.revert(item.resource);
  }

  /** Tinted status badge of a health / runtime status (3.38 R10). */
  healthBadgeTone(status: string): FpcBadgeTone {
    const tone = workspaceHealthTone(status);

    return tone === 'secondary' ? 'neutral' : tone;
  }

  change(item: WorkspaceItem): string | null {
    return workspaceItemChange(item, this.highlight());
  }

  membersOf(item: WorkspaceItem): GroupMember[] | null {
    const members = this.groupMembers();

    return item.kind === 'group' && members ? (members[`${item.project ?? ''}/${item.label}`] ?? []) : null;
  }

  /** Inspector facts for `fpc-key-value-list` (values monospace). */
  facts(rows: readonly { key: string; value: string }[]): FpcKeyValueItem[] {
    return rows.map((row) => ({ key: row.key, label: row.key, value: row.value, mono: true }));
  }

  details(item: WorkspaceItem): { key: string; value: string }[] {
    return topologyDetails({
      kind: item.typeName,
      project: item.project,
      placement: item.placement,
      health: item.health,
      status: item.status,
      ...Object.fromEntries(Object.entries(item.data).filter(([k]) => k !== 'spec' && k !== 'labels')),
    });
  }

  edgeDetails(): { key: string; value: string }[] {
    const edge = this.selectedEdge();

    return edge ? topologyDetails({ id: edge.id, ...(edge.data ?? {}) }) : [];
  }

  edgeLinks(): TopologyLink[] {
    const id = this.selectedId();
    const edge = id ? this.graph()?.edges.find((e) => e.id === id) : null;

    return edge ? topologyEdgeLinks(edge, this.at()) : [];
  }

  // ------------------------------------------------------------------------------------- "Edit on map" gestures

  setEditing(on: boolean): void {
    this.editing.set(on && this.mayEdit());
  }

  /** Drag-to-place: a service stack / VM dropped on a node or site edits its placement in the draft. */
  onDrop(event: { id: string; position: { x: number; y: number } }): void {
    const item = this.model().byId.get(event.id);
    const target =
      this.editing() && movable(item)
        ? dropTarget(this.model(), this.canvasData().boxes, event.position, event.id)
        : null;

    // The map always snaps back: placement changes show as marks / arrows, not as moved boxes.
    this.canvas()?.relayout();

    if (!item || !target || !mayDraft(item, this.context.access())) return;

    if (target.node && item.parent === `node:${target.node}`) return;

    if (needsPinReason(target)) {
      this.pinReason.set('');
      this.pendingMove.set({ item, target });

      return;
    }

    void this.place(item, target, null);
  }

  confirmPin(): void {
    const move = this.pendingMove();
    const reason = this.pinReason().trim();

    if (!move || reason.length < 3) return;

    this.pendingMove.set(null);
    void this.place(move.item, move.target, reason);
  }

  private async place(item: WorkspaceItem, target: PlacementTarget, reason: string | null): Promise<void> {
    const owner =
      item.kind === 'stack' || item.kind === 'service'
        ? this.model().byId.get(`deployment:${item.project}/${item.data['deployment']}`)
        : item;
    const document = owner ? resourceDocument(owner, this.context.draft?.active() ?? null) : null;

    if (!document) return;

    await this.context.draft?.upsert(withPlacement(document, item, target, reason));
  }

  /** `Escape` clears the selection; on the full page `e` / `Del` edit / delete the selection. */
  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;

    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

    if (event.key === 'Escape') {
      this.select(null);
    } else if (!this.embedded() && (event.key === 'e' || event.key === 'Delete')) {
      const item = this.selectedItem();
      const action = item && this.draftActsOf(item).find((a) => a.shortcut === event.key);

      if (item && action) this.run(action, item);
    }
  }

  // ----------------------------------------------------------------------------------------------------- private

  private loadTimeline(at: string): void {
    this.timelineAt.set(at);
    this.facade.load({ flows: true, at });
  }

  private loadPlan(): void {
    const plan = this.planId();

    this.facade.load(plan ? { plan } : {});
  }

  /** Deep links: `?select=&q=&layers=&mode=&plan=&at=` (merged: `?draft=` and others stay). */
  private syncUrl(): void {
    if (this.embedded()) return;

    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParamsHandling: 'merge',
      queryParams: topologyUrlParams({
        select: this.selectedId(),
        q: this.query(),
        layers: TOPOLOGY_MAP_LAYERS.filter((l) => this.layers().has(l)),
        mode: this.mode(),
        plan: this.planId(),
        at: this.timelineAt(),
      }),
    });
  }

  /** Positions are kept per user + cluster: the last layout in local storage, for maps up to 5,000 boxes. */
  private layoutStorageKey(): string {
    return `lw-workspace-layout:${this.endpoints.activeClusterId?.() ?? 'local'}:${this.context.me()?.userId ?? 'anonymous'}`;
  }

  private storedLayout(key: string): ReadonlyMap<string, WorkspaceBox> | undefined {
    try {
      const stored = JSON.parse(localStorage.getItem(this.layoutStorageKey()) ?? 'null') as {
        key: string;
        boxes: [string, WorkspaceBox][];
      } | null;

      return stored?.key === key ? new Map(stored.boxes) : undefined;
    } catch {
      return undefined;
    }
  }

  private storeLayout(key: string, boxes: ReadonlyMap<string, WorkspaceBox>): void {
    if (boxes.size > 5000) return;

    try {
      localStorage.setItem(this.layoutStorageKey(), JSON.stringify({ key, boxes: [...boxes] }));
    } catch {
      // Storage full or unavailable: the in-memory cache still works.
    }
  }

  /**
   * Width / height of the map area for the star of sites, in steps of 0.25 (0.5 … 3) so small resizes keep the cached
   * layout; the default when the map has no size yet (first render, tests).
   */
  private layoutAspect(): number {
    const el = this.hostElement.nativeElement;
    const width = el?.clientWidth ?? 0;
    const height = el?.clientHeight ?? 0;

    if (!width || !height) return WORKSPACE_LAYOUT_ASPECT;

    return Math.min(3, Math.max(0.5, Math.round((width / height) * 4) / 4));
  }

  private async relayoutMap(model: WorkspaceModel, all: ReadonlySet<string>): Promise<void> {
    const aspect = this.layoutAspect();
    const key = `${workspaceLayoutKey(all)}@${aspect}`;
    const cached = this.layoutCache.get(key) ?? this.storedLayout(key);

    if (cached) {
      this.layoutBoxes.set(cached);

      return;
    }

    const boxes =
      all.size > LARGE_MAP && this.layoutWorker.running
        ? await this.layoutWorker.layout(model, all, key, aspect)
        : workspaceLayout(model, all, aspect);

    if (this.layoutCache.size >= LAYOUT_CACHE) this.layoutCache.delete(this.layoutCache.keys().next().value as string);

    this.layoutCache.set(key, boxes);
    this.storeLayout(key, boxes);

    // A newer model may have been laid out meanwhile.
    if (`${workspaceLayoutKey(this.allDrawn())}@${aspect}` === key) this.layoutBoxes.set(boxes);
  }
}
