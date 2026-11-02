import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  apiErrorMessage,
  ConsoleAccessFacade,
  ConsoleDashboardsFacade,
  dashboardKey,
  MetricsService,
  type DashboardResource,
  type DashboardWidget,
  type DashboardWidgetState,
  type MetricAggregation,
  type MetricEvent,
  type MetricGroupBy,
  type MetricQuery,
  type MetricResult,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormCheckGroupComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcListHeaderComponent,
  fpcListQueryState,
  FpcListToolbarComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  type FpcFilterChip,
} from '@forepath/shared/frontend/ui-components';
import {
  catchError,
  from,
  ignoreElements,
  interval,
  map,
  merge,
  mergeMap,
  of,
  Subscription,
  switchMap,
  tap,
} from 'rxjs';

import { containerStateLabel } from '../drift/drift-page.component';
import { injectSectionScope, sectionQuery } from '../section/section-scope';
import { DASHBOARD_ROW_PX, LoadweaverDashboardWidgetComponent } from './dashboard-widget.component';
import { LoadweaverMetricChartComponent } from './metric-chart.component';
import {
  aggregationLabel,
  durationMs,
  formatMetricValue,
  METRIC_CATEGORIES,
  METRIC_RANGES,
  metricCategoryLabel,
  metricLabel,
  metricRangeLabel,
  metricUnit,
  overviewMetrics,
  rangeWindow,
  summaryValue,
  type MetricCategory,
  type MetricDefinition,
  type MetricRange,
} from './metrics-format';

type MetricsTab = 'overview' | 'dashboards';

/** One chart's data: the answer of its metric query (kept while the next refresh runs). */
interface ChartData {
  result: MetricResult | null;
  error: string | null;
}

/** A chart of the overview as rendered: catalog entry, data, and the series left after the visibility filter. */
export interface OverviewChart {
  def: MetricDefinition;
  label: string;
  unit: string | undefined;
  data: ChartData | undefined;
  series: MetricResult['series'];
}

const REFRESH_MS = 30_000;
/** Metric queries in flight at once (one per chart). */
const CONCURRENCY = 4;
const GROUP_BYS: MetricGroupBy[] = ['entity', 'node', 'project', 'none'];
const AGGREGATIONS: MetricAggregation[] = ['avg', 'min', 'max', 'sum'];
const DEFAULT_DASHBOARD_RANGE = '6h';
const DEFAULT_RANGE = '1h';
const DEFAULT_GROUP_BY: MetricGroupBy = 'entity';
const DEFAULT_AGGREGATION: MetricAggregation = 'avg';

/** Summary-card glyphs (Bootstrap icon names) per summary metric; others fall back to a chart glyph. */
const METRIC_ICONS: Readonly<Record<string, string>> = {
  'node.cpu_cores': 'cpu',
  'replica.cpu_cores': 'cpu',
  'node.memory_bytes': 'memory',
  'replica.memory_bytes': 'memory',
  'node.disk_bytes': 'device-hdd',
  'node.containers': 'box-seam',
  'ingress.requests_per_s': 'arrow-left-right',
  'ingress.errors_per_s': 'x-octagon',
  'ingress.latency_p95_ms': 'stopwatch',
};

function metricIcon(metric: string): string {
  return METRIC_ICONS[metric] ?? 'graph-up';
}

/**
 * Metrics and dashboards (3.18, 3.38 decision 13): the **Overview** shows every metric the caller has data for at
 * once, live (refresh every 30 s): a summary bar of key figures, then one chart per metric grouped by category
 * (Nodes, Workloads, Virtual machines, Ingress, Network, Other) in panel grids. Scope controls (time range,
 * grouping, aggregation, project) sit in the strip and reload the data; the filter drawer only toggles what is
 * shown (categories, charts, series by name, event markers) — all data stays loaded. **Dashboards** shows the
 * `Dashboard` resources as widget grids within a global filter (time range, project).
 *
 * Embeddable (3.38, object tabs Metrics of nodes / deployments / VMs): Overview only, the scope's `node` /
 * `project` / `entity` are fixed (no chips, kept on Clear all), no URL writes, no page header.
 */
@Component({
  selector: 'loadweaver-metrics-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormCheckGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcListHeaderComponent,
    FpcListToolbarComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverDashboardWidgetComponent,
    LoadweaverMetricChartComponent,
    NgTemplateOutlet,
  ],
  templateUrl: './metrics-page.component.html',
  standalone: true,
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
})
export class LoadweaverMetricsPageComponent implements OnInit {
  private readonly service = inject(MetricsService);
  private readonly dashboardsFacade = inject(ConsoleDashboardsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private dashboardRan = false;
  private loadSub: Subscription | null = null;
  /** The object scope when embedded in an object tab (3.38), else `null`. */
  readonly scope = injectSectionScope();
  /** Filters the scope fixes. */
  readonly fixed: ReadonlySet<string> = new Set(
    Object.keys(this.scope?.params() ?? {}).filter((key) => ['node', 'project', 'entity'].includes(key)),
  );

  readonly dashboards = toSignal(this.dashboardsFacade.dashboards$, { initialValue: [] as DashboardResource[] });
  readonly dashboardsLoading = toSignal(this.dashboardsFacade.loading$, { initialValue: false });
  readonly dashboardsError = toSignal(this.dashboardsFacade.error$, { initialValue: null });
  readonly dashboard = toSignal(this.dashboardsFacade.selected$, { initialValue: null });
  readonly widgetStates = toSignal(this.dashboardsFacade.widgets$, {
    initialValue: {} as Record<number, DashboardWidgetState>,
  });
  readonly projects = toSignal(this.access.projects$, { initialValue: [] as string[] });

  readonly tab = signal<MetricsTab>('overview');
  // Overview: data scope (reloads)
  readonly range = signal<string>(DEFAULT_RANGE);
  readonly groupBy = signal<MetricGroupBy>(DEFAULT_GROUP_BY);
  readonly aggregation = signal<MetricAggregation>(DEFAULT_AGGREGATION);
  readonly entity = signal('');
  readonly node = signal('');
  readonly project = signal('');
  // Overview: data
  /** The charts of the metrics the caller has data for (`GET /metrics/names`), `null` before the first answer. */
  readonly definitions = signal<MetricDefinition[] | null>(null);
  readonly data = signal<Record<string, ChartData>>({});
  readonly events = signal<MetricEvent[]>([]);
  readonly loading = signal(false);
  readonly namesError = signal<string | null>(null);
  // Overview: visibility (drawer, Apply; the data stays loaded)
  readonly hiddenCategories = signal<readonly string[]>([]);
  readonly hiddenCharts = signal<readonly string[]>([]);
  readonly seriesFilter = signal('');
  readonly markers = signal(true);
  readonly filtersOpen = signal(false);
  readonly visibility = fpcListQueryState({
    filters: {
      categories: this.hiddenCategories,
      charts: this.hiddenCharts,
      series: this.seriesFilter,
      markers: this.markers,
    },
    url: this.scope ? false : { filters: 'show' },
    open: this.filtersOpen,
  });
  // Dashboards
  readonly dashboardSelection = signal<string | null>(null);
  readonly dashboardRange = signal<string | null>(null);
  readonly dashboardProject = signal('');
  readonly dashboardFiltersOpen = signal(false);

  /** Dashboard, range and project: the drawer edits a draft until Apply (3.38 R12). */
  readonly dashboardFilterState = fpcListQueryState({
    filters: { dashboard: this.dashboardSelection, range: this.dashboardRange, project: this.dashboardProject },
    url: false,
    open: this.dashboardFiltersOpen,
    changed: () => this.refresh(),
  });
  readonly dashboardFilterCount = computed(() => (this.dashboardRange() ? 1 : 0) + (this.dashboardProject() ? 1 : 0));

  /** Every chart with its data; series narrowed by the series filter (visibility only). */
  readonly charts = computed<OverviewChart[]>(() => {
    const data = this.data();
    const needle = this.seriesFilter().trim().toLowerCase();

    return (this.definitions() ?? []).map((def) => {
      const chart = data[def.metric];
      const series = chart?.result?.series ?? [];

      return {
        def,
        label: metricLabel(def.metric),
        unit: metricUnit(def.metric),
        data: chart,
        series: needle
          ? series.filter(
              (s) =>
                s.key.toLowerCase().includes(needle) ||
                this.seriesLabel(def.metric, s.key).toLowerCase().includes(needle),
            )
          : series,
      };
    });
  });
  /** Charts with data (or an error, or still loading): metrics without samples in this scope are left out. */
  readonly relevantCharts = computed(() =>
    this.charts().filter((c) => !c.data || !!c.data.error || (c.data.result?.series.length ?? 0) > 0),
  );
  /** The categories with their visible charts, in display order (empty or hidden categories left out). */
  readonly groups = computed(() => {
    const hiddenCategories = new Set(this.hiddenCategories());
    const hiddenCharts = new Set(this.hiddenCharts());

    return METRIC_CATEGORIES.filter((category) => !hiddenCategories.has(category))
      .map((category) => ({
        category,
        label: metricCategoryLabel(category),
        charts: this.relevantCharts().filter((c) => c.def.category === category && !hiddenCharts.has(c.def.metric)),
      }))
      .filter((group) => group.charts.length > 0);
  });
  /** The drawer's choices: categories with their charts (only those with data). */
  readonly choices = computed(() =>
    METRIC_CATEGORIES.map((category) => ({
      category,
      label: metricCategoryLabel(category),
      charts: this.relevantCharts().filter((c) => c.def.category === category),
    })).filter((group) => group.charts.length > 0),
  );
  /** Key figures: the newest values of the summary metrics (all series, not narrowed by the visibility filter). */
  readonly summary = computed(() =>
    this.charts()
      .filter((c) => c.def.summary && (c.data?.result?.series.length ?? 0) > 0)
      .map((c) => {
        const value = summaryValue(c.data?.result?.series ?? [], c.def.summary ?? 'sum');

        return {
          metric: c.def.metric,
          icon: metricIcon(c.def.metric),
          label: c.label,
          value: formatMetricValue(value, c.unit),
          tone:
            c.def.metric === 'ingress.errors_per_s' && (value ?? 0) > 0 ? ('danger' as const) : ('default' as const),
        };
      }),
  );
  /** Data loaded and nothing to show in this scope. */
  readonly noData = computed(
    () => this.definitions() !== null && !this.loading() && this.relevantCharts().length === 0,
  );
  /** Deep-linked entity / node filters as removable chips (not in an object tab: there they are fixed). */
  readonly chips = computed<FpcFilterChip[]>(() => [
    ...(this.entity() && !this.fixed.has('entity')
      ? [{ id: 'entity', field: 'entity', value: this.entity(), label: `${this.entityLabel}: ${this.entity()}` }]
      : []),
    ...(this.node() && !this.fixed.has('node')
      ? [{ id: 'node', field: 'node', value: this.node(), label: `${this.nodeLabel}: ${this.node()}` }]
      : []),
  ]);

  readonly dashboardRanges = computed(() => {
    const own = this.dashboard()?.spec.range;

    return own && !METRIC_RANGES.includes(own as MetricRange) ? [own, ...METRIC_RANGES] : [...METRIC_RANGES];
  });
  readonly effectiveDashboardRange = computed(
    () => this.dashboardRange() ?? this.dashboard()?.spec.range ?? DEFAULT_DASHBOARD_RANGE,
  );
  /** Widgets placed on the 12-column grid (CSS grid lines are 1-based). */
  readonly placedWidgets = computed(() =>
    (this.dashboard()?.spec.widgets ?? []).map((widget, index) => ({
      widget,
      index,
      column: `${(widget.x ?? 0) + 1} / span ${widget.w ?? 6}`,
      row: `${(widget.y ?? 0) + 1} / span ${widget.h ?? 4}`,
      height: `${(widget.h ?? 4) * DASHBOARD_ROW_PX}px`,
    })),
  );

  readonly ranges = METRIC_RANGES;
  readonly groupBys = GROUP_BYS;
  readonly aggregations = AGGREGATIONS;
  readonly rangeLabel = metricRangeLabel;
  readonly aggregationName = aggregationLabel;
  readonly dashboardKey = dashboardKey;
  readonly rowPx = DASHBOARD_ROW_PX;

  readonly title = $localize`:@@lwConsoleMetrics-title:Metrics`;
  readonly tabOverview = $localize`:@@lwConsoleMetrics-tabOverview:Overview`;
  readonly tabDashboards = $localize`:@@lwConsoleMetrics-tabDashboards:Dashboards`;
  readonly rangeFilterLabel = $localize`:@@lwConsoleMetrics-range:Time range`;
  readonly groupByLabel = $localize`:@@lwConsoleMetrics-groupBy:Group by`;
  readonly aggregationLabel = $localize`:@@lwConsoleMetrics-aggregation:Aggregation`;
  readonly entityLabel = $localize`:@@lwConsoleMetrics-entityChip:Entity`;
  readonly nodeLabel = $localize`:@@lwConsoleMetrics-node:Node`;
  readonly projectLabel = $localize`:@@lwConsoleMetrics-project:Project`;
  readonly refreshLabel = $localize`:@@lwConsoleMetrics-refresh:Refresh`;
  readonly dashboardLabel = $localize`:@@lwConsoleMetrics-dashboard:Dashboard`;
  readonly loadingLabel = $localize`:@@lwConsoleMetrics-loading:Loading samples`;
  readonly noSeriesLabel = $localize`:@@lwConsoleMetrics-noSeries:No samples in this range`;
  readonly showTitle = $localize`:@@lwConsoleMetrics-show:Show`;
  readonly categoriesLabel = $localize`:@@lwConsoleMetrics-categories:Categories`;
  readonly seriesFilterLabel = $localize`:@@lwConsoleMetrics-seriesFilter:Series name contains`;
  readonly markersLabel = $localize`:@@lwConsoleMetrics-markers:Event markers (plans, health, drift)`;
  readonly noVisibleSeriesLabel = $localize`:@@lwConsoleMetrics-noVisibleSeries:No series match the filter`;
  readonly dashboardsLoadingLabel = $localize`:@@lwConsoleDashboards-loading:Loading dashboards`;

  constructor() {
    // A deep-linked (or the first) dashboard runs once the list is there.
    effect(() => {
      this.dashboards();
      untracked(() => this.ensureDashboard());
    });
    this.destroyRef.onDestroy(() => this.loadSub?.unsubscribe());
  }

  ngOnInit(): void {
    const params = sectionQuery(this.route, this.scope);
    const groupBy = params.get('groupBy') as MetricGroupBy | null;
    const aggregation = params.get('aggregation') as MetricAggregation | null;

    if (!this.scope && (params.get('tab') === 'dashboards' || params.get('dashboard'))) this.tab.set('dashboards');

    if (durationMs(params.get('range'))) this.range.set(params.get('range') as string);

    if (groupBy && GROUP_BYS.includes(groupBy)) this.groupBy.set(groupBy);

    if (aggregation && AGGREGATIONS.includes(aggregation)) this.aggregation.set(aggregation);

    this.entity.set(params.get('entity') ?? '');
    this.node.set(params.get('node') ?? '');
    this.project.set(params.get('project') ?? '');
    this.dashboardSelection.set(params.get('dashboard'));
    this.dashboardProject.set(params.get('dashboardProject') ?? '');

    if (durationMs(params.get('dashboardRange'))) this.dashboardRange.set(params.get('dashboardRange'));

    if (!this.scope) this.dashboardsFacade.load();

    if (this.tab() === 'overview') this.load();

    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refresh());
  }

  onTabChange(tab: string | null): void {
    this.tab.set(tab === 'dashboards' ? 'dashboards' : 'overview');

    if (this.tab() === 'overview' && this.definitions() === null) this.load();

    this.ensureDashboard();
    this.syncUrl();
  }

  groupByName(groupBy: MetricGroupBy): string {
    switch (groupBy) {
      case 'entity':
        return $localize`:@@lwConsoleMetrics-byEntity:Per entity`;
      case 'node':
        return $localize`:@@lwConsoleMetrics-byNode:Per node`;
      case 'project':
        return $localize`:@@lwConsoleMetrics-byProject:Per project`;
      default:
        return $localize`:@@lwConsoleMetrics-byNone:All together`;
    }
  }

  /** The query of one chart within the scope controls, ending now. */
  query(metric: string, window = rangeWindow(this.range())): MetricQuery {
    return {
      metric,
      ...window,
      groupBy: this.groupBy(),
      aggregation: this.aggregation(),
      ...(this.entity().trim() ? { entity: this.entity().trim() } : {}),
      ...(this.node().trim() ? { node: this.node().trim() } : {}),
      ...(this.project() ? { project: this.project() } : {}),
    };
  }

  /** A scope control changed (range, grouping, aggregation, project): reload everything. */
  setScope(patch: { range?: string; groupBy?: MetricGroupBy; aggregation?: MetricAggregation; project?: string }) {
    if (patch.range !== undefined) this.range.set(patch.range);

    if (patch.groupBy !== undefined) this.groupBy.set(patch.groupBy);

    if (patch.aggregation !== undefined) this.aggregation.set(patch.aggregation);

    if (patch.project !== undefined) this.project.set(patch.project);

    this.load();
  }

  /** A deep-linked entity / node chip removed. */
  removeChip(chip: FpcFilterChip): void {
    if (chip.id === 'entity') this.entity.set('');

    if (chip.id === 'node') this.node.set('');

    this.load();
  }

  /** Clear all: everything visible again, deep-linked chips removed (fixed scope filters stay). */
  clearVisibility(): void {
    this.visibility.clear();

    if (this.chips().length > 0) {
      if (!this.fixed.has('entity')) this.entity.set('');

      if (!this.fixed.has('node')) this.node.set('');

      this.load();
    }
  }

  isCategoryShown(category: MetricCategory): boolean {
    return !this.visibility.draft().categories.includes(category);
  }

  isChartShown(metric: string): boolean {
    return !this.visibility.draft().charts.includes(metric);
  }

  toggleCategory(category: MetricCategory, shown: boolean): void {
    const hidden = this.visibility.draft().categories.filter((c) => c !== category);

    this.visibility.patch({ categories: shown ? hidden : [...hidden, category] });
  }

  toggleChart(metric: string, shown: boolean): void {
    const hidden = this.visibility.draft().charts.filter((c) => c !== metric);

    this.visibility.patch({ charts: shown ? hidden : [...hidden, metric] });
  }

  /** Readable series names where the keys are known values (container states of `node.containers`). */
  seriesLabel(metric: string, key: string): string {
    return metric === 'node.containers' && this.groupBy() === 'entity' ? containerStateLabel(key) : key;
  }

  /** The chart's series label function (stable per metric for the chart input). */
  labelFor(metric: string): ((key: string) => string) | undefined {
    return metric === 'node.containers' && this.groupBy() === 'entity' ? containerStateLabel : undefined;
  }

  /**
   * Loads every chart: the names the caller has data for, then one query per metric (4 at a time) plus the event
   * markers. The previous answers stay on screen until the new ones arrive (no flicker on the live refresh).
   */
  load(): void {
    const window = rangeWindow(this.range());

    this.loadSub?.unsubscribe();
    this.loading.set(true);
    this.syncUrl();
    this.loadSub = this.service
      .names()
      .pipe(
        catchError((error: unknown) => {
          this.namesError.set(apiErrorMessage(error, 'Metric names could not be loaded'));

          return of(null);
        }),
        switchMap((names) => {
          if (names === null) return of(null);

          const definitions = overviewMetrics(names);

          this.namesError.set(null);
          this.definitions.set(definitions);
          const events = this.service
            .events({ ...window, ...(this.project() ? { project: this.project() } : {}), limit: 200 })
            .pipe(
              catchError(() => of([] as MetricEvent[])),
              tap((list: MetricEvent[]) => this.events.set(list)),
              ignoreElements(),
            );

          return merge(
            events,
            from(definitions).pipe(
              mergeMap(
                (def) =>
                  this.service.query(this.query(def.metric, window)).pipe(
                    map((result): [string, ChartData] => [def.metric, { result, error: null }]),
                    catchError((error: unknown) =>
                      of<[string, ChartData]>([
                        def.metric,
                        { result: null, error: apiErrorMessage(error, 'Query failed') },
                      ]),
                    ),
                  ),
                CONCURRENCY,
              ),
            ),
          );
        }),
      )
      .subscribe({
        next: (entry) => {
          if (entry) this.data.update((data) => ({ ...data, [entry[0]]: entry[1] }));
        },
        complete: () => this.loading.set(false),
      });
  }

  /** Resets the dashboard's range and project filter and runs it again. */
  resetDashboardFilters(): void {
    this.dashboardRange.set(null);
    this.dashboardProject.set('');
    this.refresh();
  }

  refresh(): void {
    if (this.tab() === 'overview') {
      this.load();
    } else {
      const key = this.dashboardSelection();

      if (key) this.runDashboard(key);
    }
  }

  onDashboardChange(key: string): void {
    this.dashboardSelection.set(key);
    this.dashboardRange.set(null);

    const target = this.dashboards().find((d) => dashboardKey(d) === key);

    this.runDashboard(key, target?.spec.range);
  }

  widgetState(index: number): DashboardWidgetState | null {
    return this.widgetStates()[index] ?? null;
  }

  trackWidget(widget: DashboardWidget, index: number): string {
    return `${index}:${widget.title}`;
  }

  /** On the dashboards tab: runs the chosen dashboard once (later runs come from the filter and the refresh). */
  private ensureDashboard(): void {
    const dashboards = this.dashboards();

    if (this.dashboardRan || this.tab() !== 'dashboards' || dashboards.length === 0) return;

    const target = dashboards.find((d) => dashboardKey(d) === this.dashboardSelection()) ?? dashboards[0];

    this.dashboardRan = true;
    this.dashboardSelection.set(dashboardKey(target));
    this.runDashboard(dashboardKey(target), target.spec.range);
  }

  private runDashboard(key: string, ownRange?: string): void {
    const range = this.dashboardRange() ?? ownRange ?? this.dashboard()?.spec.range ?? DEFAULT_DASHBOARD_RANGE;

    this.dashboardsFacade.run(key, {
      ...rangeWindow(range),
      ...(this.dashboardProject() ? { project: this.dashboardProject() } : {}),
    });
    this.syncUrl();
  }

  private syncUrl(): void {
    // Embedded in an object tab: the URL belongs to the object page.
    if (this.scope) return;

    const dashboards = this.tab() === 'dashboards';

    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      // The visibility filter (`show`) is written by its own query state.
      queryParamsHandling: 'merge',
      queryParams: {
        tab: dashboards ? 'dashboards' : null,
        metric: null,
        range: this.range() === DEFAULT_RANGE ? null : this.range(),
        groupBy: this.groupBy() === DEFAULT_GROUP_BY ? null : this.groupBy(),
        aggregation: this.aggregation() === DEFAULT_AGGREGATION ? null : this.aggregation(),
        entity: this.entity().trim() || null,
        node: this.node().trim() || null,
        project: this.project() || null,
        dashboard: dashboards ? this.dashboardSelection() : null,
        dashboardRange: dashboards ? this.dashboardRange() : null,
        dashboardProject: dashboards ? this.dashboardProject() || null : null,
      },
    });
  }
}
