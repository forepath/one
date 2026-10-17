import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsolePlansFacade,
  ConsoleTopologyFacade,
  type Plan,
  type TopologyEdge,
  type TopologyElement,
  type TopologyTraceStep,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcGraphCanvasComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
  type FpcGraphEdgeSelectEvent,
  type FpcGraphElementSelectEvent,
} from '@forepath/shared/frontend/ui-components';
import { debounceTime, filter, interval, Subject, take } from 'rxjs';

import { isoToLocalInput } from '../logs/logs-format';
import {
  formatRate,
  TOPOLOGY_MAP_LAYERS,
  topologyCanvas,
  topologyDetails,
  topologyEdgeLinks,
  topologyElementLinks,
  topologyHiddenKinds,
  topologyHighlight,
  topologyLayerLabel,
  type TopologyMapLayer,
} from './topology-format';

/** Live (now, streamed), timeline (flows at a past time) or a pending plan's overlay. */
export type TopologyMode = 'live' | 'timeline' | 'plan';

/** Structure refresh while live (flows come from the socket every 10 s). */
const STRUCTURE_REFRESH_MS = 60_000;
/** The timeline slider covers the last day, in minutes. */
const TIMELINE_MINUTES = 24 * 60;
const MINUTE_MS = 60_000;

type Selection = { type: 'element'; id: string } | { type: 'edge'; id: string };

/**
 * The topology map (3.9): sites ⊃ nodes ⊃ replicas, groups, policies, tunnels, storage, DNS and addressing as layers,
 * traffic live (cluster roles, `socket/topology`) or at a past time, a pending plan's overlay, a path trace for a
 * hostname, and links from every element to its logs, health and policy.
 */
@Component({
  selector: 'loadweaver-topology-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcGraphCanvasComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './topology-page.component.html',
  styleUrl: './topology-page.component.scss',
  standalone: true,
})
export class LoadweaverTopologyPageComponent implements OnInit, OnDestroy {
  private readonly facade = inject(ConsoleTopologyFacade);
  private readonly plansFacade = inject(ConsolePlansFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly timeline$ = new Subject<string>();

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
  readonly clusterRole = toSignal(this.access.seesInfrastructure$, { initialValue: false });

  readonly mode = signal<TopologyMode>('live');
  readonly layers = signal<ReadonlySet<TopologyMapLayer>>(new Set(TOPOLOGY_MAP_LAYERS));
  readonly selection = signal<Selection | null>(null);
  /** Timeline: minutes before now on the slider, and the chosen time. */
  readonly minutesBack = signal(60);
  readonly timelineAt = signal<string>(new Date(Date.now() - 60 * MINUTE_MS).toISOString());
  readonly planId = signal<string | null>(null);
  readonly hostInput = signal('');

  readonly pendingPlans = computed(() => this.plans().filter((p) => p.status === 'pending'));
  readonly canvasInput = computed(() => topologyCanvas(this.graph(), this.mode() === 'live'));
  readonly hiddenKinds = computed(() => topologyHiddenKinds(this.layers()));
  readonly tracedIds = computed(() => this.traceSteps().map((s) => s.id));
  readonly highlight = computed(() =>
    topologyHighlight(this.mode() === 'plan' ? this.overlay() : null, this.tracedIds()),
  );
  readonly selectedElement = computed<TopologyElement | null>(() => {
    const selection = this.selection();

    return selection?.type === 'element' ? (this.graph()?.elements.find((e) => e.id === selection.id) ?? null) : null;
  });
  readonly selectedEdge = computed<TopologyEdge | null>(() => {
    const selection = this.selection();

    return selection?.type === 'edge' ? (this.graph()?.edges.find((e) => e.id === selection.id) ?? null) : null;
  });
  readonly selectedLinks = computed(() => {
    const element = this.selectedElement();
    const edge = this.selectedEdge();

    return element ? topologyElementLinks(element) : edge ? topologyEdgeLinks(edge, this.at()) : [];
  });
  readonly selectedDetails = computed(() => {
    const element = this.selectedElement();
    const edge = this.selectedEdge();

    if (element) return topologyDetails({ id: element.id, project: element.project ?? null, ...element.data });

    return edge ? topologyDetails({ id: edge.id, layer: edge.layer, ...edge.data }) : [];
  });
  readonly flowTotals = computed(() => {
    const flows = (this.graph()?.edges ?? []).filter((e) => e.kind === 'flow');

    return {
      count: flows.length,
      denied: flows.filter((e) => e.data['decision'] === 'denied').length,
      bytesPerSecond: flows.reduce((sum, e) => sum + Number(e.data['bytesPerSecond'] ?? 0), 0),
    };
  });
  readonly sliderAt = computed(() => new Date(Date.now() - this.minutesBack() * MINUTE_MS));

  readonly allLayers = TOPOLOGY_MAP_LAYERS;
  readonly layerLabel = topologyLayerLabel;
  readonly formatRate = formatRate;
  readonly timelineMinutes = TIMELINE_MINUTES;

  readonly title = $localize`:@@lwConsoleTopology-title:Map`;
  readonly modeLabel = $localize`:@@lwConsoleTopology-mode:View`;
  readonly liveLabel = $localize`:@@lwConsoleTopology-live:Live`;
  readonly timelineLabel = $localize`:@@lwConsoleTopology-timeline:Timeline`;
  readonly planLabel = $localize`:@@lwConsoleTopology-plan:Plan`;
  readonly refreshLabel = $localize`:@@lwConsoleTopology-refresh:Refresh`;
  readonly fitLabel = $localize`:@@lwConsoleTopology-fit:Fit to screen`;
  readonly layersLabel = $localize`:@@lwConsoleTopology-layers:Layers`;
  readonly mapLabel = $localize`:@@lwConsoleTopology-mapLabel:Cluster topology map`;
  readonly traceLabel = $localize`:@@lwConsoleTopology-trace:Path trace`;
  readonly tracePlaceholder = $localize`:@@lwConsoleTopology-tracePlaceholder:Hostname, e.g. shop.example.com`;
  readonly sliderLabel = $localize`:@@lwConsoleTopology-slider:Time (last 24 hours)`;
  readonly atLabel = $localize`:@@lwConsoleTopology-at:Time`;
  readonly planSelectLabel = $localize`:@@lwConsoleTopology-planSelect:Pending plan`;
  readonly detailsTitle = $localize`:@@lwConsoleTopology-details:Details`;
  readonly closeLabel = $localize`:@@lwConsoleTopology-close:Close`;

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const mode = params.get('mode');
    const plan = params.get('plan');
    const at = params.get('at');

    if (plan) this.planId.set(plan);

    if (at && !Number.isNaN(Date.parse(at))) {
      this.timelineAt.set(new Date(at).toISOString());
      this.minutesBack.set(
        Math.min(TIMELINE_MINUTES, Math.max(0, Math.round((Date.now() - Date.parse(at)) / MINUTE_MS))),
      );
    }

    const initial: TopologyMode =
      mode === 'timeline' || mode === 'plan' || mode === 'live' ? mode : plan ? 'plan' : at ? 'timeline' : 'live';

    this.timeline$
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.loadTimeline(value));

    // The view depends on the caller's role (traffic for cluster roles only): wait until access is known.
    this.access.settled$
      .pipe(
        filter((settled) => settled),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.setMode(initial));

    interval(STRUCTURE_REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.mode() === 'live') this.facade.load({ flows: this.clusterRole() }, true);
      });
  }

  ngOnDestroy(): void {
    this.facade.disconnectLive();
  }

  setMode(mode: TopologyMode): void {
    // Timeline is about traffic, which only cluster roles see.
    const next = mode === 'timeline' && !this.clusterRole() ? 'live' : mode;

    this.mode.set(next);
    this.selection.set(null);
    this.facade.disconnectLive();

    if (next === 'live') {
      this.facade.load({ flows: this.clusterRole() });

      if (this.clusterRole()) this.facade.connectLive();
    } else if (next === 'timeline') {
      this.loadTimeline(this.timelineAt());
    } else {
      this.plansFacade.load({ status: 'pending' });
      this.loadPlan();
    }

    this.syncUrl();
  }

  refresh(): void {
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

  fit(): void {
    this.canvas()?.fit();
  }

  toggleLayer(layer: TopologyMapLayer, on: boolean): void {
    const next = new Set(this.layers());

    if (on) next.add(layer);
    else next.delete(layer);

    this.layers.set(next);
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

  /** The chosen time as a `datetime-local` value. */
  localAt(): string {
    return isoToLocalInput(this.timelineAt());
  }

  onPlanChange(id: string | null): void {
    this.planId.set(id || null);
    this.loadPlan();
    this.syncUrl();
  }

  trace(): void {
    const host = this.hostInput().trim().toLowerCase();

    if (host) this.facade.trace(host);
  }

  clearTrace(): void {
    this.hostInput.set('');
    this.facade.clearTrace();
  }

  traceFrom(element: TopologyElement): void {
    this.hostInput.set(element.label);
    this.trace();
  }

  focus(step: TopologyTraceStep): void {
    this.selection.set({ type: 'element', id: step.id });
    this.canvas()?.center(step.id);
  }

  onElementSelect(event: FpcGraphElementSelectEvent): void {
    this.selection.set({ type: 'element', id: event.id });
  }

  onEdgeSelect(event: FpcGraphEdgeSelectEvent): void {
    this.selection.set({ type: 'edge', id: event.id });
  }

  clearSelection(): void {
    this.selection.set(null);
  }

  modeName(mode: TopologyMode): string {
    return mode === 'live' ? this.liveLabel : mode === 'timeline' ? this.timelineLabel : this.planLabel;
  }

  planName(plan: Plan): string {
    const names = plan.changes.filter((c) => c.action !== 'unchanged').map((c) => `${c.kind} ${c.name}`);

    return `${plan.id.slice(0, 8)} · ${names.slice(0, 3).join(', ')}${names.length > 3 ? ' …' : ''}`;
  }

  private loadTimeline(at: string): void {
    this.timelineAt.set(at);
    this.facade.load({ flows: true, at });
    this.syncUrl();
  }

  private loadPlan(): void {
    const plan = this.planId();

    this.facade.load(plan ? { plan } : {});
  }

  /** Deep links: `?mode=timeline&at=…`, `?mode=plan&plan=…`. */
  private syncUrl(): void {
    const mode = this.mode();

    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        mode: mode === 'live' ? null : mode,
        at: mode === 'timeline' ? this.timelineAt() : null,
        plan: mode === 'plan' ? this.planId() : null,
      },
    });
  }
}
