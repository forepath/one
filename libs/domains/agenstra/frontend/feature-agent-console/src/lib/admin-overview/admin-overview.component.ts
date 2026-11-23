import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  AdminOverviewFacade,
  ClientsFacade,
  type AdminOverviewGroupBy,
  type AdminOverviewMetrics,
  type AdminOverviewResponse,
  type AdminOverviewWorkspace,
  type ClientResponseDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcAlertComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcKeyValueListComponent,
  FpcListToolbarComponent,
  fpcListQueryState,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
  FPC_CHART_AREA_FILL,
  FPC_CHART_GRID,
  FPC_CHART_LEGEND,
  FPC_CHART_LINE_STROKE,
  fpcChart,
  fpcChartCategoryAxis,
  fpcChartColor,
  fpcChartCountAxis,
  type FpcKeyValueItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import type {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexFill,
  ApexGrid,
  ApexLegend,
  ApexStroke,
  ApexXAxis,
  ApexYAxis,
} from 'ng-apexcharts';
import { NgApexchartsModule } from 'ng-apexcharts';
import { debounceTime, distinctUntilChanged, map, skip } from 'rxjs';

import {
  alignSecuritySeries,
  countAxisScale,
  utcBucketKey,
  utcBucketKeysInclusive,
} from '../audit/audit-security.util';
import { resolveNamedDisplayLabel } from '../display-name.util';
import { WorkspaceChipComponent } from '../shared/workspace-chip.component';
import {
  WorkspaceSwitchTableComponent,
  type WorkspaceSwitchAllOption,
} from '../shared/workspace-switch-table.component';

/** One area panel of the overview with its facts and console page. */
interface AdminOverviewSection {
  id: string;
  title: string;
  link: string[];
  items: FpcKeyValueItem[];
}

interface AdminOverviewChartOptions {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  colors: string[];
  stroke: ApexStroke;
  fill: ApexFill;
  dataLabels: ApexDataLabels;
  xaxis: ApexXAxis;
  yaxis: ApexYAxis;
  grid: ApexGrid;
  legend: ApexLegend;
}

const DEFAULT_RANGE_DAYS = 30;

/**
 * Admin overview (dashboard) of the Agenstra instance: chat activity, tickets, knowledge, CI/CD and automation runs
 * and security events, laid out like the audit overview (summary bar, filter strip, panel grid). The Workspace filter
 * narrows everything to one workspace; without it the numbers are combined over all workspaces and a per-workspace
 * comparison table is shown. Admins and managers only (route guard and API).
 */
@Component({
  selector: 'framework-admin-overview',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    NgApexchartsModule,
    WorkspaceChipComponent,
    WorkspaceSwitchTableComponent,
    FpcModalComponent,
    FpcAlertComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcKeyValueListComponent,
    FpcListToolbarComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcSummaryCardValueDirective,
  ],
  providers: [DatePipe, DecimalPipe],
  templateUrl: './admin-overview.component.html',
  styleUrls: ['./admin-overview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminOverviewComponent implements OnInit {
  private readonly facade = inject(AdminOverviewFacade);
  private readonly clientsFacade = inject(ClientsFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datePipe = inject(DatePipe);
  private readonly decimalPipe = inject(DecimalPipe);

  readonly pageTitle = $localize`:@@featureAdminOverview-title:Overview`;
  readonly filtersPanelTitle = $localize`:@@featureAdminOverview-filtersTitle:Overview filters`;
  readonly loadingLabel = $localize`:@@featureAdminOverview-loading:Loading overview…`;
  readonly allWorkspacesPlaceholder = $localize`:@@featureAdminOverview-allWorkspaces:All workspaces`;
  readonly workspacesLabel = $localize`:@@featureAdminOverview-kpiWorkspaces:Workspaces`;
  readonly activeAgentsLabel = $localize`:@@featureAdminOverview-kpiActiveAgents:Active agents`;
  readonly messagesLabel = $localize`:@@featureAdminOverview-kpiMessages:Messages`;
  readonly tokensLabel = $localize`:@@featureAdminOverview-kpiTokens:Tokens`;
  readonly costLabel = $localize`:@@featureAdminOverview-kpiCost:Cost (USD)`;
  readonly openTicketsLabel = $localize`:@@featureAdminOverview-kpiOpenTickets:Open tickets`;
  readonly messagesChartTitle = $localize`:@@featureAdminOverview-chartMessages:Messages over time`;
  readonly securityChartTitle = $localize`:@@featureAdminOverview-chartSecurity:Security events over time`;
  readonly workspacesTableTitle = $localize`:@@featureAdminOverview-workspacesTable:Workspaces`;
  readonly openLabel = $localize`:@@featureAdminOverview-openPage:Open`;
  readonly switchWorkspaceTitle = $localize`:@@featureAdminOverview-switchWorkspace:Switch workspace`;
  readonly allWorkspacesOption: WorkspaceSwitchAllOption = {
    label: this.allWorkspacesPlaceholder,
    description: $localize`:@@featureAdminOverview-allWorkspacesNote:Combined numbers of all workspaces`,
  };

  readonly overview = toSignal(this.facade.overview$, { initialValue: null as AdminOverviewResponse | null });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null as string | null });
  readonly clients = toSignal(this.clientsFacade.clients$, { initialValue: [] as ClientResponseDto[] });

  /** Viewed workspace from the route (`/overview/:clientId`); `null` = all workspaces combined. */
  readonly selectedClientId = toSignal(this.route.paramMap.pipe(map((params) => params.get('clientId'))), {
    initialValue: this.route.snapshot.paramMap.get('clientId'),
  });
  /** Workspace switch dialog of the header chip (same as the tickets / knowledge / tasks boards). */
  readonly workspaceSwitchOpen = signal(false);
  readonly workspaceSwitchSearch = signal('');
  readonly workspaceSwitchHasMore = toSignal(this.clientsFacade.hasMore$, { initialValue: false });
  readonly workspaceSwitchAppendLoading = toSignal(this.clientsFacade.appendLoading$, { initialValue: false });
  readonly workspaceSwitchAppendError = toSignal(this.clientsFacade.appendError$, {
    initialValue: null as string | null,
  });
  readonly clientsLoading = toSignal(this.clientsFacade.loading$, { initialValue: false });
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly groupBy = signal<AdminOverviewGroupBy>('day');
  readonly filtersOpen = signal(false);
  private readonly defaultDates = signal({ from: '', to: '' });
  /** Applied filters in the URL (`?f=`); the strip edits a draft until Apply (3.38 R12). */
  readonly filterState = fpcListQueryState({
    filters: { from: this.fromDate, to: this.toDate, groupBy: this.groupBy },
    open: this.filtersOpen,
    changed: () => this.load(),
    defaults: () => this.defaultDates(),
  });
  readonly activeFilterCount = computed(() => {
    const applied = this.filterState.applied();
    const defaults = this.defaultDates();

    return [applied.from !== defaults.from || applied.to !== defaults.to, applied.groupBy !== 'day'].filter(Boolean)
      .length;
  });

  readonly metrics = computed(() => this.overview()?.metrics ?? null);
  readonly isAllWorkspaces = computed(() => this.overview()?.scope === 'all');
  /** Header chip label: the viewed workspace's name, or "All workspaces". */
  readonly workspaceChipLabel = computed(() => {
    const clientId = this.selectedClientId();

    if (!clientId) return this.allWorkspacesPlaceholder;

    const fromOverview = this.overview()?.workspaces.find((w) => w.clientId === clientId)?.name;
    const fromClients = this.clients().find((c) => c.id === clientId)?.name;

    return resolveNamedDisplayLabel(fromOverview, fromClients, clientId);
  });
  readonly scopeLabel = computed(() => {
    const applied = this.filterState.applied();
    const range = `${this.formatDate(applied.from)} – ${this.formatDate(applied.to)}`;
    const grouping =
      applied.groupBy === 'hour'
        ? $localize`:@@featureAdminOverview-scopeByHour:by hour`
        : $localize`:@@featureAdminOverview-scopeByDay:by day`;

    return `${range}, ${grouping}`;
  });
  readonly sections = computed<AdminOverviewSection[]>(() => {
    const m = this.metrics();

    return m ? this.buildSections(m, this.overview()?.clientId ?? null) : [];
  });
  readonly messagesChartOptions = computed(() => this.buildMessagesChart(this.overview()));
  readonly securityChartOptions = computed(() => this.buildSecurityChart(this.overview()));
  readonly workspaceColumns: FpcTableColumn<AdminOverviewWorkspace>[] = [
    {
      id: 'workspace',
      label: $localize`:@@featureAdminOverview-colWorkspace:Workspace`,
      value: (row) => resolveNamedDisplayLabel(row.name, row.clientId),
      required: true,
    },
    { id: 'agents', label: this.activeAgentsLabel, value: (row) => row.metrics.activeAgentCount, align: 'end' },
    { id: 'messages', label: this.messagesLabel, value: (row) => row.metrics.totalMessages, align: 'end' },
    {
      id: 'tokens',
      label: this.tokensLabel,
      value: (row) => row.metrics.totalTokens,
      align: 'end',
      priority: 3,
    },
    {
      id: 'cost',
      label: this.costLabel,
      value: (row) => this.formatUsd(row.metrics.totalCostUsd),
      align: 'end',
    },
    { id: 'tickets', label: this.openTicketsLabel, value: (row) => row.metrics.openTicketCount, align: 'end' },
    {
      id: 'failedRuns',
      label: $localize`:@@featureAdminOverview-colFailedRuns:Failed runs`,
      value: (row) =>
        row.metrics.failedDeploymentRunCount + row.metrics.failedAutomationRunCount + row.metrics.failedTaskRunCount,
      align: 'end',
      priority: 3,
    },
  ];
  readonly workspaceRowId = (row: AdminOverviewWorkspace): string => row.clientId;

  constructor() {
    // A workspace switch (route param) reloads; the first value is loaded by ngOnInit.
    this.route.paramMap
      .pipe(
        map((params) => params.get('clientId')),
        distinctUntilChanged(),
        skip(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.load());
    toObservable(this.workspaceSwitchSearch)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => this.clientsFacade.loadClients({ search: search.trim() || undefined }));
  }

  ngOnInit(): void {
    this.setDefaultDates();
    this.clientsFacade.loadClients();
    this.load();
  }

  openWorkspaceSwitch(): void {
    this.workspaceSwitchSearch.set('');
    this.clientsFacade.loadClients();
    this.workspaceSwitchOpen.set(true);
  }

  onLoadMoreWorkspaces(): void {
    this.clientsFacade.loadMoreClients();
  }

  /** Switch to one workspace (`/overview/:clientId`) or all (`/overview`); range and grouping (`?f=`) stay. */
  selectWorkspace(clientId: string | null): void {
    this.workspaceSwitchOpen.set(false);

    if (clientId === this.selectedClientId()) return;

    void this.router.navigate(clientId ? ['/overview', clientId] : ['/overview'], {
      queryParamsHandling: 'preserve',
    });
  }

  formatUsd(value: number | null | undefined): string {
    return `$${this.decimalPipe.transform(value ?? 0, '1.2-2') ?? '0.00'}`;
  }

  formatCount(value: number | null | undefined): string {
    return this.decimalPipe.transform(value ?? 0, '1.0-0') ?? '0';
  }

  onWorkspaceRowActivate(row: AdminOverviewWorkspace): void {
    this.selectWorkspace(row.clientId);
  }

  onFiltersOpenChange(open: boolean): void {
    this.filtersOpen.set(open);
  }

  onResetFilters(): void {
    this.filterState.clear();
  }

  private load(): void {
    this.facade.load({
      clientId: this.selectedClientId() || null,
      from: this.fromDate() || undefined,
      to: this.toDate() || undefined,
      groupBy: this.groupBy(),
    });
  }

  private setDefaultDates(): void {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    from.setUTCDate(from.getUTCDate() - DEFAULT_RANGE_DAYS);
    const defaults = { from: from.toISOString().slice(0, 10), to };

    this.defaultDates.set(defaults);

    // A range from the URL (`?f=`) wins over the defaults.
    if (!this.fromDate()) this.fromDate.set(defaults.from);

    if (!this.toDate()) this.toDate.set(defaults.to);
  }

  private formatDate(ymd: string): string {
    return ymd ? (this.datePipe.transform(`${ymd}T12:00:00.000Z`, 'mediumDate', 'UTC') ?? ymd) : '–';
  }

  private buildSections(m: AdminOverviewMetrics, clientId: string | null): AdminOverviewSection[] {
    const scoped = (path: string): string[] => (clientId ? [path, clientId] : [path]);
    const count = (value: number) => this.formatCount(value);

    return [
      {
        id: 'activity',
        title: $localize`:@@featureAdminOverview-sectionActivity:Activity in period`,
        link: ['/audit'],
        items: [
          { key: 'agents', label: this.activeAgentsLabel, value: count(m.activeAgentCount) },
          {
            key: 'users',
            label: $localize`:@@featureAdminOverview-activeUsers:Active users`,
            value: count(m.activeUserCount),
          },
          { key: 'messages', label: this.messagesLabel, value: count(m.totalMessages) },
          { key: 'tokens', label: this.tokensLabel, value: count(m.totalTokens) },
          { key: 'cost', label: this.costLabel, value: this.formatUsd(m.totalCostUsd) },
        ],
      },
      {
        id: 'tickets',
        title: $localize`:@@featureAdminOverview-sectionTickets:Tickets and automation`,
        link: scoped('/tickets'),
        items: [
          { key: 'open', label: this.openTicketsLabel, value: count(m.openTicketCount) },
          {
            key: 'inProgress',
            label: $localize`:@@featureAdminOverview-inProgressTickets:In progress`,
            value: count(m.inProgressTicketCount),
          },
          {
            key: 'automationRuns',
            label: $localize`:@@featureAdminOverview-automationRuns:Autonomous runs in period`,
            value: count(m.automationRunCount),
            hint: this.failedHint(m.failedAutomationRunCount),
          },
          {
            key: 'activeRuns',
            label: $localize`:@@featureAdminOverview-activeAutomationRuns:Running now`,
            value: count(m.activeAutomationRunCount),
          },
        ],
      },
      {
        id: 'deployments',
        title: $localize`:@@featureAdminOverview-sectionDeployments:Pipelines and tasks`,
        link: scoped('/pipelines'),
        items: [
          {
            key: 'deploymentRuns',
            label: $localize`:@@featureAdminOverview-deploymentRuns:Pipeline runs in period`,
            value: count(m.deploymentRunCount),
            hint: this.failedHint(m.failedDeploymentRunCount),
          },
          {
            key: 'taskRuns',
            label: $localize`:@@featureAdminOverview-taskRuns:Scheduled task runs in period`,
            value: count(m.taskRunCount),
            hint: this.failedHint(m.failedTaskRunCount),
          },
          {
            key: 'knowledge',
            label: $localize`:@@featureAdminOverview-knowledgePages:Knowledge pages`,
            value: count(m.knowledgePageCount),
          },
        ],
      },
      {
        id: 'security',
        title: $localize`:@@featureAdminOverview-sectionSecurity:Security in period`,
        link: ['/audit'],
        items: [
          {
            key: 'drops',
            label: $localize`:@@featureAdminOverview-filterDrops:Message drops`,
            value: count(m.filterDropCount),
          },
          {
            key: 'flags',
            label: $localize`:@@featureAdminOverview-filterFlags:Message flags`,
            value: count(m.filterFlagCount),
          },
          {
            key: 'blocked',
            label: $localize`:@@featureAdminOverview-egressBlocked:Blocked destinations`,
            value: count(m.egressBlockedCount),
          },
          {
            key: 'observed',
            label: $localize`:@@featureAdminOverview-egressObserved:Observed (would block)`,
            value: count(m.egressObservedCount),
          },
        ],
      },
    ];
  }

  /** Muted hint under a run count, only when some runs failed. */
  private failedHint(failed: number): string | null {
    return failed > 0 ? $localize`:@@featureAdminOverview-failedHint:${failed}:count: failed` : null;
  }

  private bucketKeys(overview: AdminOverviewResponse): string[] {
    return utcBucketKeysInclusive(overview.from, overview.to, overview.groupBy);
  }

  private buildMessagesChart(overview: AdminOverviewResponse | null): AdminOverviewChartOptions | null {
    if (!overview) return null;

    const keys = this.bucketKeys(overview);
    const byBucket = new Map<string, number>();

    for (const point of overview.series) {
      const key = utcBucketKey(point.period, overview.groupBy);

      byBucket.set(key, (byBucket.get(key) ?? 0) + point.count);
    }

    const data = keys.map((key) => byBucket.get(key) ?? 0);

    return {
      ...this.buildTimeAxis(keys, overview.groupBy, [data]),
      series: [{ name: this.messagesLabel, data }],
      colors: [fpcChartColor(0)],
      stroke: FPC_CHART_LINE_STROKE as ApexStroke,
      fill: FPC_CHART_AREA_FILL as ApexFill,
      legend: { ...FPC_CHART_LEGEND, show: false } as ApexLegend,
    };
  }

  private buildSecurityChart(overview: AdminOverviewResponse | null): AdminOverviewChartOptions | null {
    if (!overview) return null;

    const aligned = alignSecuritySeries(overview.securitySeries, this.bucketKeys(overview), overview.groupBy);

    return {
      ...this.buildTimeAxis(aligned.categories, overview.groupBy, [
        aligned.filterDrops,
        aligned.filterFlags,
        aligned.egressBlocked,
        aligned.egressObserved,
      ]),
      series: [
        { name: $localize`:@@featureAdminOverview-filterDrops:Message drops`, data: aligned.filterDrops },
        { name: $localize`:@@featureAdminOverview-filterFlags:Message flags`, data: aligned.filterFlags },
        { name: $localize`:@@featureAdminOverview-egressBlocked:Blocked destinations`, data: aligned.egressBlocked },
        {
          name: $localize`:@@featureAdminOverview-egressObserved:Observed (would block)`,
          data: aligned.egressObserved,
        },
      ],
      colors: ['var(--bs-danger)', 'var(--bs-warning)', 'var(--bs-primary)', 'var(--bs-info)'],
      stroke: FPC_CHART_LINE_STROKE as ApexStroke,
      fill: FPC_CHART_AREA_FILL as ApexFill,
      legend: FPC_CHART_LEGEND as ApexLegend,
    };
  }

  /** Chart, count axis and grid of the audit's time charts, with the shared thinned category axis. */
  private buildTimeAxis(
    categories: string[],
    groupBy: AdminOverviewGroupBy,
    counts: readonly (readonly number[])[],
  ): Pick<AdminOverviewChartOptions, 'chart' | 'dataLabels' | 'xaxis' | 'yaxis' | 'grid'> {
    const format = groupBy === 'day' ? 'mediumDate' : 'short';

    return {
      chart: fpcChart('area', 280) as ApexChart,
      dataLabels: { enabled: false },
      // Shared category axis: unrotated labels thinned to the plot width (tooltips keep every label).
      xaxis: fpcChartCategoryAxis(categories, {
        format: (value: string): string => {
          const ms = Date.parse(value);

          return Number.isNaN(ms) ? value : (this.datePipe.transform(ms, format) ?? value);
        },
      }) as ApexXAxis,
      yaxis: { ...fpcChartCountAxis(), ...countAxisScale(counts, false) } as ApexYAxis,
      grid: FPC_CHART_GRID as ApexGrid,
    };
  }
}
