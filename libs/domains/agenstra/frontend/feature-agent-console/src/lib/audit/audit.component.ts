import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AuthenticationFacade,
  ClientsFacade,
  StatisticsFacade,
  type ClientResponseDto,
  type StatisticsEgressDecision,
  type StatisticsSeriesPoint,
  type UserResponseDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcCollapsibleFilterPanelComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcPaginationComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
  FPC_CHART_AREA_FILL,
  FPC_CHART_AXIS,
  FPC_CHART_GRID,
  FPC_CHART_LABEL_STYLE,
  FPC_CHART_LEGEND,
  FPC_CHART_PLACEHOLDER_COLOR,
  FPC_CHART_SLICE_LABELS,
  FPC_CHART_SLICE_TOOLTIP,
  fpcChart,
  fpcChartColor,
  fpcChartColors,
} from '@forepath/shared/frontend/ui-components';
import type {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexFill,
  ApexGrid,
  ApexLegend,
  ApexNonAxisChartSeries,
  ApexPlotOptions,
  ApexStroke,
  ApexTooltip,
  ApexXAxis,
  ApexYAxis,
} from 'ng-apexcharts';
import { NgApexchartsModule } from 'ng-apexcharts';

import { getUnavailableDisplayLabel, resolveNamedDisplayLabel } from '../display-name.util';
import { ClientSelectComponent } from '../client-select/client-select.component';

import {
  alignSecuritySeries,
  egressDecisionColor,
  formatBytes,
  formatEgressDecision,
  formatEgressKind,
  formatEgressRule,
  hasEgressData,
} from './audit-security.util';

const PAGE_SIZE = 10;
const AUDIT_FILTERS_STORAGE_KEY = 'agent-console-audit-filters';

interface AuditFiltersStorage {
  selectedClientId: string | null;
  fromDate: string;
  toDate: string;
  groupBy: 'day' | 'hour';
  chatIoSearch: string;
  filterDropsSearch: string;
  filterFlagsSearch: string;
  entityEventsSearch: string;
  egressEventsSearch: string;
  egressDecision: StatisticsEgressDecision | '';
  filtersCollapsed: boolean;
}

interface AuditAxisChartOptions {
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
  heading: string;
}

interface AuditDonutChartOptions {
  series: ApexNonAxisChartSeries;
  chart: ApexChart;
  colors: string[];
  labels: string[];
  dataLabels: ApexDataLabels;
  legend: ApexLegend;
  tooltip: ApexTooltip;
  heading: string;
}

@Component({
  selector: 'framework-audit',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgApexchartsModule,
    RouterLink,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcCollapsibleFilterPanelComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcPaginationComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcSummaryCardValueDirective,
    ClientSelectComponent,
  ],
  providers: [DatePipe],
  templateUrl: './audit.component.html',
  styleUrls: ['./audit.component.scss'],
})
export class AuditComponent implements OnInit {
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly clientsFacade = inject(ClientsFacade);
  private readonly statisticsFacade = inject(StatisticsFacade);
  private readonly datePipe = inject(DatePipe);

  readonly pageTitle = $localize`:@@featureAudit-pageTitle:Audit`;
  readonly filtersPanelTitle = $localize`:@@featureAudit-filtersTitle:Filters`;
  readonly resetFiltersTitle = $localize`:@@featureAudit-resetFiltersTitle:Reset filters to defaults`;
  readonly searchPlaceholder = $localize`:@@featureAudit-searchPlaceholder:Search`;
  readonly loadingLabel = $localize`:@@featureAudit-loading:Loading statistics...`;
  readonly totalMessagesLabel = $localize`:@@featureAudit-totalMessages:Total messages`;
  readonly totalWordsLabel = $localize`:@@featureAudit-totalWords:Total words`;
  readonly avgWordsPerMessageLabel = $localize`:@@featureAudit-avgWordsPerMessage:Avg words/message`;
  readonly totalTokensLabel = $localize`:@@featureAudit-totalTokens:Total tokens`;
  readonly totalCostLabel = $localize`:@@featureAudit-totalCost:Total cost (USD)`;
  readonly filterFlagsLabel = $localize`:@@featureAudit-filterFlags:Filter flags`;
  readonly filterDropsLabel = $localize`:@@featureAudit-filterDrops:Filter drops`;
  readonly egressBlockedLabel = $localize`:@@featureAudit-egressBlocked:Blocked destinations`;
  readonly egressObservedLabel = $localize`:@@featureAudit-egressObserved:Would-be blocks`;
  readonly egressAllowedLabel = $localize`:@@featureAudit-egressAllowed:Allowed requests`;
  readonly egressDecisions: StatisticsEgressDecision[] = ['blocked', 'observed', 'allowed', 'error'];
  readonly formatEgressRule = formatEgressRule;
  readonly formatEgressDecision = formatEgressDecision;
  readonly formatEgressKind = formatEgressKind;
  readonly egressDecisionColor = egressDecisionColor;
  readonly formatBytes = formatBytes;

  readonly filtersCollapsed = signal(true);
  readonly selectedClientId = signal<string | null>(null);
  readonly fromDate = signal<string>('');
  readonly toDate = signal<string>('');
  readonly groupBy = signal<'day' | 'hour'>('day');

  readonly chatIoPage = signal(0);
  readonly filterDropsPage = signal(0);
  readonly filterFlagsPage = signal(0);
  readonly entityEventsPage = signal(0);
  readonly egressEventsPage = signal(0);
  readonly egressDecision = signal<StatisticsEgressDecision | ''>('');

  readonly chatIoSearch = signal('');
  readonly filterDropsSearch = signal('');
  readonly filterFlagsSearch = signal('');
  readonly entityEventsSearch = signal('');
  readonly egressEventsSearch = signal('');

  private chatIoSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private filterDropsSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private filterFlagsSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private entityEventsSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private egressEventsSearchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly clients$ = this.clientsFacade.clients$;
  readonly clients = toSignal(this.clientsFacade.clients$, { initialValue: [] as ClientResponseDto[] });
  readonly users = toSignal(this.authFacade.users$, { initialValue: [] as UserResponseDto[] });
  readonly summary = toSignal(this.statisticsFacade.summary$, { initialValue: null });
  readonly chatIo = toSignal(this.statisticsFacade.chatIo$, { initialValue: null });
  readonly filterDrops = toSignal(this.statisticsFacade.filterDrops$, { initialValue: null });
  readonly filterFlags = toSignal(this.statisticsFacade.filterFlags$, { initialValue: null });
  readonly entityEvents = toSignal(this.statisticsFacade.entityEvents$, { initialValue: null });
  readonly egressEvents = toSignal(this.statisticsFacade.egressEvents$, { initialValue: null });
  readonly loadingEgressEvents$ = this.statisticsFacade.loadingEgressEvents$;
  readonly hasEgress = computed(() => hasEgressData(this.summary()?.egressBreakdown));
  readonly loadingSummary$ = this.statisticsFacade.loadingSummary$;
  readonly loadingChatIo$ = this.statisticsFacade.loadingChatIo$;
  readonly loadingFilterDrops$ = this.statisticsFacade.loadingFilterDrops$;
  readonly loadingFilterFlags$ = this.statisticsFacade.loadingFilterFlags$;
  readonly loadingEntityEvents$ = this.statisticsFacade.loadingEntityEvents$;
  readonly error$ = this.statisticsFacade.error$;

  readonly selectedClient = computed(() => {
    const id = this.selectedClientId();
    const list = this.clients();

    if (!id) return null;

    return list.find((c) => c.id === id) ?? null;
  });

  readonly seriesChartOptions = computed<AuditAxisChartOptions | null>(() => {
    const s = this.summary();

    if (!s) return null;

    const seriesData = s.series ?? [];
    const groupBy = this.groupBy();
    const { categories, data } = this.buildMessagesOverTimeCategoriesAndData(
      seriesData,
      this.fromDate(),
      this.toDate(),
      groupBy,
    );

    return {
      ...this.buildTimeAxisChart('area', categories, groupBy),
      series: [{ name: 'Messages', data }],
      colors: [fpcChartColor(0)],
      stroke: { curve: 'smooth', width: 2 },
      fill: FPC_CHART_AREA_FILL,
      legend: { ...FPC_CHART_LEGEND, show: false },
      heading: $localize`:@@featureAudit-chartMessagesOverTimeTitle:Messages over time`,
    };
  });

  readonly filterBreakdownChartOptions = computed<AuditDonutChartOptions | null>(() => {
    const s = this.summary();

    if (!s) return null;

    const dropPrefix = $localize`:@@featureAudit-chartDropPrefix:Drop`;
    const flagPrefix = $localize`:@@featureAudit-chartFlagPrefix:Flag`;
    const drops = (s.filterTypesBreakdown ?? []).map((b) => ({
      label: `${dropPrefix}: ${b.filterType} (${this.formatFilterDirection(b.direction)})`,
      count: b.count,
    }));
    const flags = (s.filterFlagsBreakdown ?? []).map((b) => ({
      label: `${flagPrefix}: ${b.filterType} (${this.formatFilterDirection(b.direction)})`,
      count: b.count,
    }));
    const items = [...drops, ...flags];

    if (items.length === 0) {
      return this.buildDonutChart(
        [$localize`:@@featureAudit-chartNoFilterBreakdown:No filter drops or flags`],
        [1],
        [FPC_CHART_PLACEHOLDER_COLOR],
        $localize`:@@featureAudit-chartFilterBreakdownTitle:Filter drops and flags by type`,
        false,
      );
    }

    return this.buildDonutChart(
      items.map((i) => i.label),
      items.map((i) => i.count),
      fpcChartColors(items.length),
      $localize`:@@featureAudit-chartFilterBreakdownTitle:Filter drops and flags by type`,
    );
  });

  /** Security events over time: message filter drops / flags and blocked or observed destinations. */
  readonly securitySeriesChartOptions = computed<AuditAxisChartOptions | null>(() => {
    const s = this.summary();

    if (!s?.securitySeries) return null;

    const groupBy = this.groupBy();
    const aligned = alignSecuritySeries(
      s.securitySeries,
      this.generateUtcBucketKeysInclusive(this.fromDate(), this.toDate(), groupBy),
      groupBy,
    );

    return {
      ...this.buildTimeAxisChart('area', aligned.categories, groupBy),
      series: [
        { name: $localize`:@@featureAudit-seriesFilterDrops:Message drops`, data: aligned.filterDrops },
        { name: $localize`:@@featureAudit-seriesFilterFlags:Message flags`, data: aligned.filterFlags },
        { name: $localize`:@@featureAudit-seriesEgressBlocked:Blocked destinations`, data: aligned.egressBlocked },
        { name: $localize`:@@featureAudit-seriesEgressObserved:Would-be blocks`, data: aligned.egressObserved },
      ],
      colors: ['var(--bs-danger)', 'var(--bs-warning)', 'var(--bs-primary)', 'var(--bs-info)'],
      stroke: { curve: 'smooth', width: 2 },
      fill: FPC_CHART_AREA_FILL,
      legend: FPC_CHART_LEGEND,
      heading: $localize`:@@featureAudit-chartSecurityOverTimeTitle:Security events over time`,
    };
  });

  /** Web traffic decisions over time (stacked: allowed / blocked / would-be blocked). */
  readonly egressSeriesChartOptions = computed<AuditAxisChartOptions | null>(() => {
    const s = this.summary();

    if (!s?.securitySeries || !this.hasEgress()) return null;

    const groupBy = this.groupBy();
    const aligned = alignSecuritySeries(
      s.securitySeries,
      this.generateUtcBucketKeysInclusive(this.fromDate(), this.toDate(), groupBy),
      groupBy,
    );

    return {
      ...this.buildTimeAxisChart('bar', aligned.categories, groupBy, { stacked: true }),
      series: [
        { name: formatEgressDecision('allowed'), data: aligned.egressAllowed },
        { name: formatEgressDecision('blocked'), data: aligned.egressBlocked },
        { name: formatEgressDecision('observed'), data: aligned.egressObserved },
      ],
      colors: ['var(--bs-success)', 'var(--bs-danger)', 'var(--bs-warning)'],
      stroke: { width: 0 },
      fill: { type: 'solid' },
      legend: FPC_CHART_LEGEND,
      heading: $localize`:@@featureAudit-chartEgressOverTimeTitle:Web traffic decisions over time`,
    };
  });

  /** Most frequently blocked / would-be blocked destinations. */
  readonly egressTopHostsChartOptions = computed<(AuditAxisChartOptions & { plotOptions: ApexPlotOptions }) | null>(
    () => {
      const hosts = this.summary()?.egressTopBlockedHosts ?? [];

      if (hosts.length === 0) return null;

      return {
        series: [{ name: this.egressBlockedLabel, data: hosts.map((host) => host.count) }],
        chart: fpcChart('bar', 280),
        colors: ['var(--bs-danger)'],
        stroke: { width: 0 },
        fill: { type: 'solid' },
        plotOptions: { bar: { horizontal: true, borderRadius: 2 } },
        dataLabels: { enabled: false },
        xaxis: {
          ...FPC_CHART_AXIS,
          categories: hosts.map((host) => host.host),
          labels: { style: FPC_CHART_LABEL_STYLE },
        },
        yaxis: { labels: { style: FPC_CHART_LABEL_STYLE } },
        grid: FPC_CHART_GRID,
        legend: { ...FPC_CHART_LEGEND, show: false },
        heading: $localize`:@@featureAudit-chartTopBlockedHostsTitle:Top blocked destinations`,
      };
    },
  );

  /** Blocked / would-be blocked decisions by guard rule. */
  readonly egressRulesChartOptions = computed<AuditDonutChartOptions | null>(() => {
    const rules = this.summary()?.egressRulesBreakdown ?? [];

    if (rules.length === 0) return null;

    return this.buildDonutChart(
      rules.map((rule) => formatEgressRule(rule.rule)),
      rules.map((rule) => rule.count),
      fpcChartColors(rules.length),
      $localize`:@@featureAudit-chartEgressRulesTitle:Blocks by rule`,
    );
  });

  /** Shared chart, axes and grid for the time-bucketed charts. */
  private buildTimeAxisChart(
    type: 'area' | 'line' | 'bar',
    categories: string[],
    groupBy: 'day' | 'hour',
    extra: { stacked?: boolean } = {},
  ): Pick<AuditAxisChartOptions, 'chart' | 'dataLabels' | 'xaxis' | 'yaxis' | 'grid'> {
    const axisDateFormat = groupBy === 'day' ? 'mediumDate' : 'short';

    return {
      chart: fpcChart(type, 280, extra),
      dataLabels: { enabled: false },
      xaxis: {
        ...FPC_CHART_AXIS,
        categories,
        labels: {
          style: FPC_CHART_LABEL_STYLE,
          formatter: (value: string): string => this.formatAxisDateLabel(value, axisDateFormat),
        },
      },
      yaxis: { labels: { style: FPC_CHART_LABEL_STYLE } },
      grid: FPC_CHART_GRID,
    };
  }

  private buildDonutChart(
    labels: string[],
    series: number[],
    colors: string[],
    title: string,
    showSliceLabels = true,
  ): AuditDonutChartOptions {
    return {
      series,
      chart: fpcChart('donut', 280),
      colors,
      labels,
      dataLabels: { ...FPC_CHART_SLICE_LABELS, enabled: showSliceLabels },
      legend: FPC_CHART_LEGEND,
      tooltip: FPC_CHART_SLICE_TOOLTIP,
      heading: title,
    };
  }

  ngOnInit(): void {
    const stored = this.loadFilters();

    if (stored) {
      if (stored.selectedClientId !== undefined) this.selectedClientId.set(stored.selectedClientId);

      if (stored.fromDate) this.fromDate.set(stored.fromDate);

      if (stored.toDate) this.toDate.set(stored.toDate);

      if (stored.groupBy === 'day' || stored.groupBy === 'hour') this.groupBy.set(stored.groupBy);

      if (stored.chatIoSearch !== undefined) this.chatIoSearch.set(stored.chatIoSearch);

      if (stored.filterDropsSearch !== undefined) this.filterDropsSearch.set(stored.filterDropsSearch);

      if (stored.filterFlagsSearch !== undefined) this.filterFlagsSearch.set(stored.filterFlagsSearch);

      if (stored.entityEventsSearch !== undefined) this.entityEventsSearch.set(stored.entityEventsSearch);

      if (stored.egressEventsSearch !== undefined) this.egressEventsSearch.set(stored.egressEventsSearch);

      if (
        stored.egressDecision !== undefined &&
        (stored.egressDecision === '' || this.egressDecisions.includes(stored.egressDecision))
      ) {
        this.egressDecision.set(stored.egressDecision);
      }

      if (stored.filtersCollapsed !== undefined) this.filtersCollapsed.set(stored.filtersCollapsed);
    }

    if (!stored?.fromDate) this.fromDate.set(this.formatDateForInput(this.getDefaultFromDate()));

    if (!stored?.toDate) this.toDate.set(this.formatDateForInput(this.getDefaultToDate()));

    this.authFacade.loadUsers();
    this.clientsFacade.loadClients();
    this.applyFilters();
  }

  /** Resolve originalUserId to email when user is loaded; never show raw UUID. */
  resolveUserDisplay(originalUserId: string | undefined): string {
    if (!originalUserId) return '-';

    const user = this.users().find((u) => u.id === originalUserId);

    return resolveNamedDisplayLabel(user?.email);
  }

  /** Format agent display as "client name --> agent name" or fallback. */
  resolveAgentDisplay(row: { clientId?: string; agentId?: string; clientName?: string; agentName?: string }): string {
    const { clientName, agentName } = row;

    if (clientName && agentName) return `${clientName} <i class="bi bi-arrow-right"></i> ${agentName}`;

    if (agentName) return agentName;

    return getUnavailableDisplayLabel();
  }

  /** Chat route for agent link: /clients/{clientId}/agents/{agentId} */
  buildAgentChatRoute(clientId: string | undefined, agentId: string | undefined): string | null {
    if (!clientId || !agentId) return null;

    return `/clients/${clientId}/agents/${agentId}`;
  }

  /**
   * Route for entity event link: /clients/{id} for client, /clients/{clientId}/agents/{agentId} for agent.
   * Returns null for other entity types.
   */
  buildEntityEventRoute(row: {
    entityType: string;
    originalEntityId: string;
    clientId?: string;
    agentId?: string;
  }): string | null {
    if (row.entityType === 'client') {
      return row.originalEntityId ? `/clients/${row.originalEntityId}` : null;
    }

    if (row.entityType === 'agent' && row.clientId && row.originalEntityId) {
      return `/clients/${row.clientId}/agents/${row.originalEntityId}`;
    }

    return null;
  }

  /** Display text for entity event: resolved name when available; never raw UUID. */
  resolveEntityDisplay(row: {
    entityType: string;
    originalEntityId: string;
    clientId?: string;
    agentId?: string;
    clientName?: string;
    agentName?: string;
  }): string {
    if (row.entityType === 'client') {
      const client = this.clients().find((c) => c.id === row.originalEntityId);

      return resolveNamedDisplayLabel(client?.name);
    }

    if (row.entityType === 'agent') {
      if (row.clientName && row.agentName) {
        return `${row.clientName} <i class="bi bi-arrow-right"></i> ${row.agentName}`;
      }

      if (row.agentName) return row.agentName;
    }

    return getUnavailableDisplayLabel();
  }

  private getDefaultFromDate(): Date {
    const now = new Date();
    const sevenDaysAgo = new Date(now);

    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    return sevenDaysAgo;
  }

  private getDefaultToDate(): Date {
    return new Date();
  }

  private formatDateForInput(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  onApplyFilters(): void {
    this.chatIoPage.set(0);
    this.filterDropsPage.set(0);
    this.filterFlagsPage.set(0);
    this.entityEventsPage.set(0);
    this.egressEventsPage.set(0);
    this.filtersCollapsed.set(true);
    this.applyFilters();
  }

  onResetFilters(): void {
    if (this.egressEventsSearchTimer) {
      clearTimeout(this.egressEventsSearchTimer);
      this.egressEventsSearchTimer = null;
    }

    if (this.chatIoSearchTimer) {
      clearTimeout(this.chatIoSearchTimer);
      this.chatIoSearchTimer = null;
    }

    if (this.filterDropsSearchTimer) {
      clearTimeout(this.filterDropsSearchTimer);
      this.filterDropsSearchTimer = null;
    }

    if (this.filterFlagsSearchTimer) {
      clearTimeout(this.filterFlagsSearchTimer);
      this.filterFlagsSearchTimer = null;
    }

    if (this.entityEventsSearchTimer) {
      clearTimeout(this.entityEventsSearchTimer);
      this.entityEventsSearchTimer = null;
    }

    this.selectedClientId.set(null);
    this.fromDate.set(this.formatDateForInput(this.getDefaultFromDate()));
    this.toDate.set(this.formatDateForInput(this.getDefaultToDate()));
    this.groupBy.set('day');
    this.chatIoSearch.set('');
    this.filterDropsSearch.set('');
    this.filterFlagsSearch.set('');
    this.entityEventsSearch.set('');
    this.egressEventsSearch.set('');
    this.egressDecision.set('');
    this.filtersCollapsed.set(true);
    this.chatIoPage.set(0);
    this.filterDropsPage.set(0);
    this.filterFlagsPage.set(0);
    this.entityEventsPage.set(0);
    this.egressEventsPage.set(0);
    this.applyFilters();
  }

  onFiltersOpenChange(open: boolean): void {
    this.filtersCollapsed.set(!open);
  }

  onChatIoPageChange(page: number): void {
    this.chatIoPage.set(page);
    this.loadChatIo();
  }

  onFilterDropsPageChange(page: number): void {
    this.filterDropsPage.set(page);
    this.loadFilterDrops();
  }

  onFilterFlagsPageChange(page: number): void {
    this.filterFlagsPage.set(page);
    this.loadFilterFlags();
  }

  onEntityEventsPageChange(page: number): void {
    this.entityEventsPage.set(page);
    this.loadEntityEvents();
  }

  onEgressEventsPageChange(page: number): void {
    this.egressEventsPage.set(page);
    this.loadEgressEvents();
  }

  onEgressEventsSearchChange(value: string): void {
    this.egressEventsSearch.set(value);

    if (this.egressEventsSearchTimer) clearTimeout(this.egressEventsSearchTimer);

    this.egressEventsSearchTimer = setTimeout(() => {
      this.egressEventsPage.set(0);
      this.loadEgressEvents();
      this.egressEventsSearchTimer = null;
    }, 300);
  }

  onEgressDecisionChange(value: string): void {
    this.egressDecision.set(
      this.egressDecisions.includes(value as StatisticsEgressDecision) ? (value as StatisticsEgressDecision) : '',
    );
    this.egressEventsPage.set(0);
    this.loadEgressEvents();
  }

  onChatIoSearchChange(value: string): void {
    this.chatIoSearch.set(value);

    if (this.chatIoSearchTimer) clearTimeout(this.chatIoSearchTimer);

    this.chatIoSearchTimer = setTimeout(() => {
      this.chatIoPage.set(0);
      this.loadChatIo();
      this.chatIoSearchTimer = null;
    }, 300);
  }

  onFilterDropsSearchChange(value: string): void {
    this.filterDropsSearch.set(value);

    if (this.filterDropsSearchTimer) clearTimeout(this.filterDropsSearchTimer);

    this.filterDropsSearchTimer = setTimeout(() => {
      this.filterDropsPage.set(0);
      this.loadFilterDrops();
      this.filterDropsSearchTimer = null;
    }, 300);
  }

  onFilterFlagsSearchChange(value: string): void {
    this.filterFlagsSearch.set(value);

    if (this.filterFlagsSearchTimer) clearTimeout(this.filterFlagsSearchTimer);

    this.filterFlagsSearchTimer = setTimeout(() => {
      this.filterFlagsPage.set(0);
      this.loadFilterFlags();
      this.filterFlagsSearchTimer = null;
    }, 300);
  }

  onEntityEventsSearchChange(value: string): void {
    this.entityEventsSearch.set(value);

    if (this.entityEventsSearchTimer) clearTimeout(this.entityEventsSearchTimer);

    this.entityEventsSearchTimer = setTimeout(() => {
      this.entityEventsPage.set(0);
      this.loadEntityEvents();
      this.entityEventsSearchTimer = null;
    }, 300);
  }

  private applyFilters(): void {
    const baseParams = this.getBaseParams();

    this.statisticsFacade.loadSummary(baseParams);
    this.loadChatIo();
    this.loadFilterDrops();
    this.loadFilterFlags();
    this.loadEntityEvents();
    this.loadEgressEvents();
  }

  private getBaseParams(): {
    clientId?: string;
    from?: string;
    to?: string;
    groupBy?: 'day' | 'hour';
    limit?: number;
    offset?: number;
  } {
    const params: {
      clientId?: string;
      from?: string;
      to?: string;
      groupBy?: 'day' | 'hour';
      limit?: number;
      offset?: number;
    } = {};
    const clientId = this.selectedClientId();
    const from = this.fromDate();
    const to = this.toDate();
    const groupBy = this.groupBy();

    if (clientId) params.clientId = clientId;

    if (from) params.from = from;

    if (to) params.to = to;

    if (groupBy) params.groupBy = groupBy;

    return params;
  }

  private loadChatIo(): void {
    const base = this.getBaseParams();
    const search = this.chatIoSearch().trim() || undefined;

    this.statisticsFacade.loadChatIo({
      ...base,
      search,
      limit: PAGE_SIZE,
      offset: this.chatIoPage() * PAGE_SIZE,
    });
  }

  private loadFilterDrops(): void {
    const base = this.getBaseParams();
    const search = this.filterDropsSearch().trim() || undefined;

    this.statisticsFacade.loadFilterDrops({
      ...base,
      search,
      limit: PAGE_SIZE,
      offset: this.filterDropsPage() * PAGE_SIZE,
    });
  }

  private loadFilterFlags(): void {
    const base = this.getBaseParams();
    const search = this.filterFlagsSearch().trim() || undefined;

    this.statisticsFacade.loadFilterFlags({
      ...base,
      search,
      limit: PAGE_SIZE,
      offset: this.filterFlagsPage() * PAGE_SIZE,
    });
  }

  private loadEntityEvents(): void {
    const base = this.getBaseParams();
    const search = this.entityEventsSearch().trim() || undefined;

    this.statisticsFacade.loadEntityEvents({
      ...base,
      search,
      limit: PAGE_SIZE,
      offset: this.entityEventsPage() * PAGE_SIZE,
    });
  }

  private loadEgressEvents(): void {
    const base = this.getBaseParams();
    const search = this.egressEventsSearch().trim() || undefined;
    const decision = this.egressDecision() || undefined;

    this.statisticsFacade.loadEgressEvents({
      ...base,
      search,
      decision,
      limit: PAGE_SIZE,
      offset: this.egressEventsPage() * PAGE_SIZE,
    });
  }

  /**
   * Aligns API series with every UTC bucket in the selected date range so gaps show as zero.
   * Falls back to API-only points when from/to are not valid YYYY-MM-DD.
   */
  private buildMessagesOverTimeCategoriesAndData(
    seriesData: StatisticsSeriesPoint[],
    fromYmd: string,
    toYmd: string,
    groupBy: 'day' | 'hour',
  ): { categories: string[]; data: number[] } {
    const bucketKeys = this.generateUtcBucketKeysInclusive(fromYmd, toYmd, groupBy);

    if (bucketKeys.length === 0) {
      return {
        categories: seriesData.map((p) => p.period),
        data: seriesData.map((p) => p.count),
      };
    }

    const countByBucket = new Map<string, number>();

    for (const point of seriesData) {
      const key = AuditComponent.normalizePeriodToUtcBucketKey(point.period, groupBy);

      countByBucket.set(key, (countByBucket.get(key) ?? 0) + point.count);
    }

    return {
      categories: bucketKeys,
      data: bucketKeys.map((key) => countByBucket.get(key) ?? 0),
    };
  }

  private generateUtcBucketKeysInclusive(fromYmd: string, toYmd: string, groupBy: 'day' | 'hour'): string[] {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

    if (!dateOnly.test(fromYmd) || !dateOnly.test(toYmd)) {
      return [];
    }

    const fromMs = Date.parse(`${fromYmd}T00:00:00.000Z`);
    const toDayStartMs = Date.parse(`${toYmd}T00:00:00.000Z`);

    if (Number.isNaN(fromMs) || Number.isNaN(toDayStartMs) || fromMs > toDayStartMs) {
      return [];
    }

    const keys: string[] = [];

    if (groupBy === 'day') {
      for (let t = fromMs; t <= toDayStartMs; t += 86400000) {
        keys.push(AuditComponent.utcDayStartIso(new Date(t)));
      }

      return keys;
    }

    const endMs = Date.parse(`${toYmd}T23:59:59.999Z`);

    for (let t = fromMs; t <= endMs; t += 3600000) {
      keys.push(AuditComponent.utcHourStartIso(new Date(t)));
    }

    return keys;
  }

  private static utcDayStartIso(d: Date): string {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  }

  private static utcHourStartIso(d: Date): string {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours())).toISOString();
  }

  private static normalizePeriodToUtcBucketKey(period: string, groupBy: 'day' | 'hour'): string {
    const d = new Date(period);

    if (Number.isNaN(d.getTime())) {
      return period;
    }

    return groupBy === 'day' ? AuditComponent.utcDayStartIso(d) : AuditComponent.utcHourStartIso(d);
  }

  /** Apex category axis values are ISO instants; render with locale via DatePipe. */
  private formatAxisDateLabel(value: string, format: string): string {
    if (!value) {
      return '';
    }

    const ms = Date.parse(value);

    if (Number.isNaN(ms)) {
      return value;
    }

    return this.datePipe.transform(ms, format) ?? value;
  }

  formatDateTime(iso: string | undefined): string {
    if (!iso) return '-';

    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  /** Human-readable label for Chat I/O direction (API: input | output). */
  formatChatIoDirection(direction: string): string {
    switch (direction) {
      case 'input':
        return $localize`:@@featureAudit-chatIoDirectionInput:User message`;
      case 'output':
        return $localize`:@@featureAudit-chatIoDirectionOutput:Assistant reply`;
      default:
        return direction;
    }
  }

  /** Human-readable label for filter audit direction (API: incoming | outgoing). */
  formatFilterDirection(direction: string): string {
    switch (direction) {
      case 'incoming':
        return $localize`:@@featureAudit-filterDirectionIncoming:Incoming`;
      case 'outgoing':
        return $localize`:@@featureAudit-filterDirectionOutgoing:Outgoing`;
      default:
        return direction;
    }
  }

  /** Human-readable label for entity audit row type. */
  formatEntityType(entityType: string): string {
    switch (entityType) {
      case 'user':
        return $localize`:@@featureAudit-entityTypeUser:User`;
      case 'client':
        return $localize`:@@featureAudit-entityTypeClient:Client`;
      case 'agent':
        return $localize`:@@featureAudit-entityTypeAgent:Agent`;
      case 'client_user':
        return $localize`:@@featureAudit-entityTypeClientUser:Client user`;
      case 'provisioning_reference':
        return $localize`:@@featureAudit-entityTypeProvisioningReference:Provisioning reference`;
      default:
        return entityType;
    }
  }

  /** Human-readable label for entity audit event type. */
  formatEntityEventType(eventType: string): string {
    switch (eventType) {
      case 'created':
        return $localize`:@@featureAudit-eventTypeCreated:Created`;
      case 'updated':
        return $localize`:@@featureAudit-eventTypeUpdated:Updated`;
      case 'deleted':
        return $localize`:@@featureAudit-eventTypeDeleted:Deleted`;
      default:
        return eventType;
    }
  }

  totalPages(total: number): number {
    return Math.max(0, Math.ceil(total / PAGE_SIZE));
  }

  constructor() {
    effect(() => {
      this.selectedClientId();
      this.fromDate();
      this.toDate();
      this.groupBy();
      this.chatIoSearch();
      this.filterDropsSearch();
      this.filterFlagsSearch();
      this.entityEventsSearch();
      this.egressEventsSearch();
      this.egressDecision();
      this.filtersCollapsed();
      this.saveFilters();
    });
  }

  private loadFilters(): Partial<AuditFiltersStorage> | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;

    try {
      const raw = window.localStorage.getItem(AUDIT_FILTERS_STORAGE_KEY);

      if (!raw) return null;

      const parsed = JSON.parse(raw) as Partial<AuditFiltersStorage>;

      if (!parsed || typeof parsed !== 'object') return null;

      if (parsed.groupBy !== 'day' && parsed.groupBy !== 'hour') parsed.groupBy = undefined;

      return parsed;
    } catch {
      return null;
    }
  }

  private saveFilters(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;

    try {
      const payload: AuditFiltersStorage = {
        selectedClientId: this.selectedClientId(),
        fromDate: this.fromDate(),
        toDate: this.toDate(),
        groupBy: this.groupBy(),
        chatIoSearch: this.chatIoSearch(),
        filterDropsSearch: this.filterDropsSearch(),
        filterFlagsSearch: this.filterFlagsSearch(),
        entityEventsSearch: this.entityEventsSearch(),
        egressEventsSearch: this.egressEventsSearch(),
        egressDecision: this.egressDecision(),
        filtersCollapsed: this.filtersCollapsed(),
      };

      window.localStorage.setItem(AUDIT_FILTERS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore storage errors */
    }
  }
}
