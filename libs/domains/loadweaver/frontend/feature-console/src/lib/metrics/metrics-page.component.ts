import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleDashboardsFacade,
  ConsoleMetricsFacade,
  dashboardKey,
  type DashboardResource,
  type DashboardWidget,
  type DashboardWidgetState,
  type MetricAggregation,
  type MetricEvent,
  type MetricGroupBy,
  type MetricQuery,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { DASHBOARD_ROW_PX, LoadweaverDashboardWidgetComponent } from './dashboard-widget.component';
import { LoadweaverMetricChartComponent } from './metric-chart.component';
import {
  durationMs,
  METRIC_RANGES,
  metricRangeLabel,
  metricUnit,
  rangeWindow,
  type MetricChartType,
  type MetricRange,
} from './metrics-format';

type MetricsTab = 'explore' | 'dashboards';

const REFRESH_MS = 60_000;
const GROUP_BYS: MetricGroupBy[] = ['entity', 'node', 'project', 'none'];
const AGGREGATIONS: MetricAggregation[] = ['avg', 'min', 'max', 'sum'];
const DEFAULT_DASHBOARD_RANGE = '6h';

/**
 * Metrics and dashboards (3.18): one metric over a range, grouped and aggregated, with event markers; and the
 * `Dashboard` resources as widget grids within a global filter (time range, project). Dashboards are edited as
 * resources, not here.
 */
@Component({
  selector: 'loadweaver-metrics-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverDashboardWidgetComponent,
    LoadweaverMetricChartComponent,
  ],
  templateUrl: './metrics-page.component.html',
  standalone: true,
})
export class LoadweaverMetricsPageComponent implements OnInit {
  private readonly metrics = inject(ConsoleMetricsFacade);
  private readonly dashboardsFacade = inject(ConsoleDashboardsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private dashboardRan = false;

  readonly names = toSignal(this.metrics.names$, { initialValue: [] as string[] });
  readonly namesError = toSignal(this.metrics.namesError$, { initialValue: null });
  readonly result = toSignal(this.metrics.result$, { initialValue: null });
  readonly loading = toSignal(this.metrics.loading$, { initialValue: false });
  readonly error = toSignal(this.metrics.error$, { initialValue: null });
  readonly events = toSignal(this.metrics.events$, { initialValue: [] as MetricEvent[] });
  readonly dashboards = toSignal(this.dashboardsFacade.dashboards$, { initialValue: [] as DashboardResource[] });
  readonly dashboardsLoading = toSignal(this.dashboardsFacade.loading$, { initialValue: false });
  readonly dashboardsError = toSignal(this.dashboardsFacade.error$, { initialValue: null });
  readonly dashboard = toSignal(this.dashboardsFacade.selected$, { initialValue: null });
  readonly widgetStates = toSignal(this.dashboardsFacade.widgets$, {
    initialValue: {} as Record<number, DashboardWidgetState>,
  });
  readonly projects = toSignal(this.access.projects$, { initialValue: [] as string[] });
  readonly clusterRole = toSignal(this.access.seesInfrastructure$, { initialValue: false });

  readonly tab = signal<MetricsTab>('explore');
  // Explore
  readonly metric = signal('');
  readonly range = signal<string>('1h');
  readonly groupBy = signal<MetricGroupBy>('entity');
  readonly aggregation = signal<MetricAggregation>('avg');
  readonly entity = signal('');
  readonly node = signal('');
  readonly project = signal('');
  readonly chartType = signal<MetricChartType>('line');
  // Dashboards
  readonly dashboardSelection = signal<string | null>(null);
  readonly dashboardRange = signal<string | null>(null);
  readonly dashboardProject = signal('');

  readonly unit = computed(() => metricUnit(this.metric()));
  readonly series = computed(() => this.result()?.series ?? []);
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
    })),
  );

  readonly ranges = METRIC_RANGES;
  readonly groupBys = GROUP_BYS;
  readonly aggregations = AGGREGATIONS;
  readonly chartTypes: MetricChartType[] = ['line', 'area', 'bar'];
  readonly rangeLabel = metricRangeLabel;
  readonly dashboardKey = dashboardKey;
  readonly rowPx = DASHBOARD_ROW_PX;

  readonly title = $localize`:@@lwConsoleMetrics-title:Metrics`;
  readonly tabExplore = $localize`:@@lwConsoleMetrics-tabExplore:Explore`;
  readonly tabDashboards = $localize`:@@lwConsoleMetrics-tabDashboards:Dashboards`;
  readonly metricLabel = $localize`:@@lwConsoleMetrics-metric:Metric`;
  readonly rangeFilterLabel = $localize`:@@lwConsoleMetrics-range:Time range`;
  readonly groupByLabel = $localize`:@@lwConsoleMetrics-groupBy:Group by`;
  readonly aggregationLabel = $localize`:@@lwConsoleMetrics-aggregation:Aggregation`;
  readonly entityLabel = $localize`:@@lwConsoleMetrics-entity:Entity (exact or prefix*)`;
  readonly nodeLabel = $localize`:@@lwConsoleMetrics-node:Node`;
  readonly projectLabel = $localize`:@@lwConsoleMetrics-project:Project`;
  readonly chartTypeLabel = $localize`:@@lwConsoleMetrics-chartType:Chart`;
  readonly showLabel = $localize`:@@lwConsoleMetrics-show:Show`;
  readonly refreshLabel = $localize`:@@lwConsoleMetrics-refresh:Refresh`;
  readonly dashboardLabel = $localize`:@@lwConsoleMetrics-dashboard:Dashboard`;

  constructor() {
    // A deep-linked (or the first) dashboard runs once the list is there.
    effect(() => {
      this.dashboards();
      untracked(() => this.ensureDashboard());
    });
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const groupBy = params.get('groupBy') as MetricGroupBy | null;
    const aggregation = params.get('aggregation') as MetricAggregation | null;

    if (params.get('tab') === 'dashboards' || params.get('dashboard')) this.tab.set('dashboards');

    this.metric.set(params.get('metric') ?? '');

    if (durationMs(params.get('range'))) this.range.set(params.get('range') as string);

    if (groupBy && GROUP_BYS.includes(groupBy)) this.groupBy.set(groupBy);

    if (aggregation && AGGREGATIONS.includes(aggregation)) this.aggregation.set(aggregation);

    this.entity.set(params.get('entity') ?? '');
    this.node.set(params.get('node') ?? '');
    this.project.set(params.get('project') ?? '');
    this.dashboardSelection.set(params.get('dashboard'));
    this.dashboardProject.set(params.get('dashboardProject') ?? '');

    if (durationMs(params.get('dashboardRange'))) this.dashboardRange.set(params.get('dashboardRange'));

    this.metrics.loadNames();
    this.dashboardsFacade.load();

    if (this.metric()) this.show();

    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refresh());
  }

  onTabChange(tab: string | null): void {
    this.tab.set(tab === 'dashboards' ? 'dashboards' : 'explore');
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

  /** The explore query of the form, ending now. */
  query(): MetricQuery | null {
    const metric = this.metric().trim();

    if (!metric) return null;

    return {
      metric,
      ...rangeWindow(this.range()),
      groupBy: this.groupBy(),
      aggregation: this.aggregation(),
      ...(this.entity().trim() ? { entity: this.entity().trim() } : {}),
      ...(this.node().trim() ? { node: this.node().trim() } : {}),
      ...(this.project() ? { project: this.project() } : {}),
    };
  }

  show(): void {
    const query = this.query();

    if (query) this.metrics.query(query);

    this.syncUrl();
  }

  refresh(): void {
    if (this.tab() === 'explore') {
      const query = this.query();

      if (query) this.metrics.query(query);
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

  onDashboardRangeChange(range: string): void {
    this.dashboardRange.set(range);
    this.refresh();
  }

  onDashboardProjectChange(project: string): void {
    this.dashboardProject.set(project);
    this.refresh();
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
    const dashboards = this.tab() === 'dashboards';

    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        tab: dashboards ? 'dashboards' : null,
        metric: this.metric().trim() || null,
        range: this.range() === '1h' ? null : this.range(),
        groupBy: this.groupBy() === 'entity' ? null : this.groupBy(),
        aggregation: this.aggregation() === 'avg' ? null : this.aggregation(),
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
