import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, effect, inject, OnInit, signal, untracked, LOCALE_ID } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  AuthenticationFacade,
  ClientsFacade,
  StatisticsFacade,
  type ClientResponseDto,
  type StatisticsChatIoDto,
  type StatisticsEgressDecision,
  type StatisticsEgressEventDto,
  type StatisticsEntityEventDto,
  type StatisticsFilterDropDto,
  type StatisticsSeriesPoint,
  type UserResponseDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcAlertComponent,
  FpcDataTableComponent,
  FpcListToolbarComponent,
  fpcListQueryState,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  FPC_DEFAULT_PAGE_SIZE,
  type FpcFilterChip,
  type FpcMenuItem,
  type FpcTableColumn,
  type FpcTableState,
  FPC_CHART_AREA_FILL,
  FPC_CHART_AXIS,
  FPC_CHART_GRID,
  FPC_CHART_LABEL_STYLE,
  FPC_CHART_LEGEND,
  FPC_CHART_LEGEND_SCROLL,
  FPC_CHART_RESPONSIVE,
  fpcChartCountAxis,
  FPC_CHART_PLACEHOLDER_COLOR,
  FPC_CHART_SLICE_LABELS,
  FPC_CHART_SLICE_TOOLTIP,
  fpcChart,
  fpcChartColor,
  fpcChartColors,
  fpcFormatDateTime,
} from '@forepath/shared/frontend/ui-components';
import type {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexFill,
  ApexGrid,
  ApexLegend,
  ApexResponsive,
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
  countAxisScale,
  egressDecisionColor,
  filterBreakdownLabel,
  formatBytes,
  formatEgressDecision,
  formatEgressKind,
  formatEgressRule,
  hasEgressData,
} from './audit-security.util';

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
  activeTab: AuditTab;
}

/** Tabs of the audit page (3.38 D5: one table per tab). */
export type AuditTab = 'overview' | 'chat-io' | 'filter-drops' | 'filter-flags' | 'web-traffic' | 'entity-events';
type AuditTable = Exclude<AuditTab, 'overview'>;

const AUDIT_TABS: readonly AuditTab[] = [
  'overview',
  'chat-io',
  'filter-drops',
  'filter-flags',
  'web-traffic',
  'entity-events',
];

/** Rows with an agent (chat route in the row menu). */
type AuditAgentRow = { clientId?: string; agentId?: string };

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
  responsive?: ApexResponsive[];
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
    FpcListToolbarComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
    FpcTabGroupComponent,
    FpcTabComponent,
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
  private readonly locale = inject(LOCALE_ID);
  private readonly clientsFacade = inject(ClientsFacade);
  private readonly statisticsFacade = inject(StatisticsFacade);
  private readonly datePipe = inject(DatePipe);
  private readonly router = inject(Router);

  readonly pageTitle = $localize`:@@featureAudit-pageTitle:Audit`;
  readonly filtersPanelTitle = $localize`:@@featureAudit-filtersTitle:Filters`;
  readonly emptyPeriodHint = $localize`:@@featureAudit-emptyPeriodHint:Change the time range or workspace in Filters.`;
  readonly allWorkspacesPlaceholder = $localize`:@@featureAudit-allWorkspaces:All workspaces`;
  readonly searchChatIoPlaceholder = $localize`:@@featureAudit-searchChatIo:Search messages`;
  readonly searchFilterDropsPlaceholder = $localize`:@@featureAudit-searchFilterDrops:Search filter drops`;
  readonly searchFilterFlagsPlaceholder = $localize`:@@featureAudit-searchFilterFlags:Search filter flags`;
  readonly searchWebTrafficPlaceholder = $localize`:@@featureAudit-searchWebTraffic:Search web traffic`;
  readonly searchEntityEventsPlaceholder = $localize`:@@featureAudit-searchEntityEvents:Search entity events`;
  readonly loadingLabel = $localize`:@@featureAudit-loading:Loading statistics`;
  readonly totalMessagesLabel = $localize`:@@featureAudit-totalMessages:Messages`;
  readonly totalWordsLabel = $localize`:@@featureAudit-totalWords:Words`;
  readonly avgWordsPerMessageLabel = $localize`:@@featureAudit-avgWordsPerMessage:Words / message`;
  readonly totalTokensLabel = $localize`:@@featureAudit-totalTokens:Tokens`;
  readonly totalCostLabel = $localize`:@@featureAudit-totalCost:Cost (USD)`;
  readonly filterFlagsLabel = $localize`:@@featureAudit-filterFlags:Filter flags`;
  readonly filterDropsLabel = $localize`:@@featureAudit-filterDrops:Filter drops`;
  readonly egressBlockedLabel = $localize`:@@featureAudit-egressBlocked:Blocked`;
  readonly egressObservedLabel = $localize`:@@featureAudit-egressObserved:Observed`;
  /** "Observed" explained (AG-09): the label stays short, the tooltip says what it counts. */
  readonly egressObservedHint = $localize`:@@featureAudit-egressObservedHint:Requests an observe-only egress policy let through that enforcing it would block`;
  readonly egressBlockedHint = $localize`:@@featureAudit-egressBlockedHint:Requests to destinations the egress policy blocked`;
  readonly egressAllowedLabel = $localize`:@@featureAudit-egressAllowed:Allowed requests`;
  readonly overviewTabLabel = $localize`:@@featureAudit-tabOverview:Overview`;
  readonly chatIoTabLabel = $localize`:@@featureAudit-chatIoTable:Chat I/O`;
  readonly filterDropsTabLabel = $localize`:@@featureAudit-filterDropsTable:Filter drops`;
  readonly filterFlagsTabLabel = $localize`:@@featureAudit-filterFlagsTable:Filter flags`;
  readonly webTrafficTabLabel = $localize`:@@featureAudit-egressEventsTable:Web traffic`;
  readonly entityEventsTabLabel = $localize`:@@featureAudit-entityEventsTable:Entity events`;
  private readonly openChatLabel = $localize`:@@featureAudit-openChat:Open environment chat`;
  private readonly openEntityLabel = $localize`:@@featureAudit-openEntity:Open`;

  private readonly timeLabel = $localize`:@@featureAudit-time:Time`;
  private readonly userLabel = $localize`:@@featureAudit-user:User`;
  private readonly agentLabel = $localize`:@@featureAudit-agent:Environment`;
  private readonly directionLabel = $localize`:@@featureAudit-direction:Direction`;
  private readonly wordsLabel = $localize`:@@featureAudit-words:Words`;
  private readonly charsLabel = $localize`:@@featureAudit-chars:Chars`;
  private readonly filterTypeLabel = $localize`:@@featureAudit-filterType:Filter`;
  private readonly reasonLabel = $localize`:@@featureAudit-reason:Reason`;
  private readonly decisionLabel = $localize`:@@featureAudit-egressDecision:Decision`;
  private readonly kindLabel = $localize`:@@featureAudit-egressKind:Type`;
  private readonly destinationLabel = $localize`:@@featureAudit-egressDestination:Destination`;
  private readonly ruleLabel = $localize`:@@featureAudit-egressRule:Rule`;
  private readonly countLabel = $localize`:@@featureAudit-egressCount:Count`;
  private readonly transferLabel = $localize`:@@featureAudit-egressTransfer:Transfer`;
  private readonly entityTypeLabel = $localize`:@@featureAudit-entityType:Type`;
  private readonly entityLabel = $localize`:@@featureAudit-entity:Entity`;
  private readonly eventTypeLabel = $localize`:@@featureAudit-eventType:Event`;

  /** Time column (the name column of an event log: the row's lead). */
  private readonly timeColumn = <R extends { occurredAt: string }>(): FpcTableColumn<R> => ({
    id: 'time',
    label: this.timeLabel,
    value: (row) => this.formatDateTime(row.occurredAt),
    sortable: false,
    priority: 1,
  });

  /** The audit APIs page server-side without a sort parameter: columns don't sort (no "sorted within page"). */
  readonly chatIoColumns: FpcTableColumn<StatisticsChatIoDto>[] = [
    {
      id: 'direction',
      label: this.directionLabel,
      type: 'state',
      sortable: false,
      state: (row): FpcTableState => ({
        label: this.formatChatIoDirection(row.direction),
        tone: row.direction === 'input' ? 'primary' : 'neutral',
        icon: row.direction === 'input' ? 'person' : 'robot',
      }),
    },
    this.timeColumn<StatisticsChatIoDto>(),
    { id: 'user', label: this.userLabel, sortable: false, priority: 2 },
    { id: 'agent', label: this.agentLabel, sortable: false, priority: 1 },
    {
      id: 'words',
      label: this.wordsLabel,
      value: (row) => row.wordCount,
      sortable: false,
      align: 'end',
      width: '7rem',
    },
    {
      id: 'chars',
      label: this.charsLabel,
      value: (row) => row.charCount,
      sortable: false,
      align: 'end',
      width: '7rem',
      priority: 3,
    },
  ];

  readonly filterColumns: FpcTableColumn<StatisticsFilterDropDto>[] = [
    {
      id: 'direction',
      label: this.directionLabel,
      type: 'state',
      sortable: false,
      state: (row): FpcTableState => ({
        label: this.formatFilterDirection(row.direction),
        tone: row.direction === 'incoming' ? 'primary' : 'neutral',
        icon: row.direction === 'incoming' ? 'box-arrow-in-down' : 'box-arrow-up',
      }),
    },
    this.timeColumn<StatisticsFilterDropDto>(),
    { id: 'user', label: this.userLabel, sortable: false, priority: 2 },
    { id: 'agent', label: this.agentLabel, sortable: false, priority: 1 },
    { id: 'filter', label: this.filterTypeLabel, value: (row) => row.filterDisplayName, sortable: false },
    {
      id: 'words',
      label: this.wordsLabel,
      value: (row) => row.wordCount,
      sortable: false,
      align: 'end',
      width: '7rem',
      priority: 3,
    },
    { id: 'reason', label: this.reasonLabel, value: (row) => row.filterReason ?? '–', sortable: false, priority: 3 },
  ];

  readonly egressColumns: FpcTableColumn<StatisticsEgressEventDto>[] = [
    {
      id: 'decision',
      label: this.decisionLabel,
      type: 'state',
      sortable: false,
      state: (row): FpcTableState => ({
        label: formatEgressDecision(row.decision),
        tone: AuditComponent.egressTone(row.decision),
        icon: AuditComponent.egressIcon(row.decision),
      }),
    },
    this.timeColumn<StatisticsEgressEventDto>(),
    { id: 'agent', label: this.agentLabel, sortable: false, priority: 2 },
    { id: 'destination', label: this.destinationLabel, sortable: false, priority: 1 },
    { id: 'kind', label: this.kindLabel, value: (row) => formatEgressKind(row.kind), sortable: false, priority: 3 },
    { id: 'rule', label: this.ruleLabel, sortable: false, priority: 3 },
    { id: 'count', label: this.countLabel, value: (row) => row.count, sortable: false, align: 'end', width: '6rem' },
    { id: 'transfer', label: this.transferLabel, sortable: false, priority: 3 },
  ];

  readonly entityColumns: FpcTableColumn<StatisticsEntityEventDto>[] = [
    {
      id: 'event',
      label: this.eventTypeLabel,
      type: 'state',
      sortable: false,
      state: (row): FpcTableState => ({
        label: this.formatEntityEventType(row.eventType),
        tone: row.eventType === 'created' ? 'success' : row.eventType === 'deleted' ? 'danger' : 'warning',
        icon: row.eventType === 'created' ? 'plus-circle' : row.eventType === 'deleted' ? 'trash' : 'pencil',
      }),
    },
    this.timeColumn<StatisticsEntityEventDto>(),
    { id: 'user', label: this.userLabel, sortable: false, priority: 2 },
    { id: 'type', label: this.entityTypeLabel, value: (row) => this.formatEntityType(row.entityType), sortable: false },
    { id: 'entity', label: this.entityLabel, sortable: false, priority: 1 },
  ];

  /** ⋮ of rows with an agent: open its chat. */
  readonly agentRowMenu = (row: AuditAgentRow): FpcMenuItem[] =>
    this.buildAgentChatRoute(row.clientId, row.agentId)
      ? [{ id: 'open-chat', label: this.openChatLabel, icon: 'chat-left-text' }]
      : [];

  readonly entityRowMenu = (row: StatisticsEntityEventDto): FpcMenuItem[] =>
    this.buildEntityEventRoute(row) ? [{ id: 'open', label: this.openEntityLabel, icon: 'box-arrow-up-right' }] : [];

  onAgentRowAction(row: AuditAgentRow, action: string): void {
    const route = this.buildAgentChatRoute(row.clientId, row.agentId);

    if (action === 'open-chat' && route) void this.router.navigateByUrl(route);
  }

  /** Web traffic row click: show / hide its details (row type is inferred from the shared agent row menu). */
  toggleEgressDetail(row: AuditAgentRow): void {
    const id = (row as Partial<StatisticsEgressEventDto>).id ?? null;

    this.expandedEgressId.set(this.expandedEgressId() === id ? null : id);
  }

  onEntityRowAction(row: StatisticsEntityEventDto, action: string): void {
    const route = this.buildEntityEventRoute(row);

    if (action === 'open' && route) void this.router.navigateByUrl(route);
  }

  private static egressTone(decision: string): FpcTableState['tone'] {
    switch (decision) {
      case 'allowed':
        return 'success';
      case 'observed':
        return 'warning';
      case 'blocked':
      case 'error':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  private static egressIcon(decision: string): string {
    switch (decision) {
      case 'allowed':
        return 'check-circle-fill';
      case 'observed':
        return 'eye';
      case 'blocked':
        return 'slash-circle-fill';
      case 'error':
        return 'exclamation-octagon-fill';
      default:
        return 'question-circle';
    }
  }
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
  readonly filtersOpen = computed(() => !this.filtersCollapsed());
  /** Applied client / range / grouping in the URL (`?f=`); the drawer edits a draft until Apply (3.38 R12). */
  readonly filterState = fpcListQueryState({
    filters: { client: this.selectedClientId, from: this.fromDate, to: this.toDate, groupBy: this.groupBy },
    open: this.filtersOpen,
    changed: () => this.onApplyFilters(),
  });
  /** Applied filters that differ from the defaults (last 30 days, all clients, per day). */
  readonly activeFilterCount = computed(() => {
    const f = this.filterState.applied();

    return [
      !!f.client,
      !!f.from && f.from !== this.formatDateForInput(this.getDefaultFromDate()),
      !!f.to && f.to !== this.formatDateForInput(this.getDefaultToDate()),
      f.groupBy !== 'day',
    ].filter(Boolean).length;
  });

  readonly activeTab = signal<AuditTab>('overview');

  /** 1-based pages and page sizes (25 by default, persisted per table by the data table). */
  readonly chatIoPage = signal(1);
  readonly filterDropsPage = signal(1);
  readonly filterFlagsPage = signal(1);
  readonly entityEventsPage = signal(1);
  readonly egressEventsPage = signal(1);
  readonly chatIoPageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  readonly filterDropsPageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  readonly filterFlagsPageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  readonly entityEventsPageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  readonly egressEventsPageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  readonly egressDecision = signal<StatisticsEgressDecision | ''>('');
  /** Web traffic drawer: draft decision until Apply. */
  readonly egressFiltersOpen = signal(false);
  readonly egressDecisionDraft = signal<StatisticsEgressDecision | ''>('');
  readonly egressChips = computed<FpcFilterChip[]>(() => {
    const decision = this.egressDecision();

    return decision
      ? [{ id: 'decision', label: `${this.decisionLabel}: ${formatEgressDecision(decision)}`, value: decision }]
      : [];
  });
  /** Web traffic row whose details (sample URL, matched source, message) are open. */
  readonly expandedEgressId = signal<string | null>(null);
  /** Bumped by Apply / Clear all of the page filters: the active table reloads. */
  private readonly filterVersion = signal(0);
  private readonly loadTimers = new Map<AuditTable, { handle: ReturnType<typeof setTimeout>; due: number }>();

  readonly chatIoSearch = signal('');
  readonly filterDropsSearch = signal('');
  readonly filterFlagsSearch = signal('');
  readonly entityEventsSearch = signal('');
  readonly egressEventsSearch = signal('');

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
      ...this.buildTimeAxisChart('area', categories, groupBy, { counts: [data] }),
      series: [{ name: this.totalMessagesLabel, data }],
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
    // Legend = the rule names shown in the tables (AG-08), not the raw filter keys.
    const drops = (s.filterTypesBreakdown ?? []).map((b) => ({
      label: filterBreakdownLabel(dropPrefix, b, this.formatFilterDirection(b.direction)),
      count: b.count,
    }));
    const flags = (s.filterFlagsBreakdown ?? []).map((b) => ({
      label: filterBreakdownLabel(flagPrefix, b, this.formatFilterDirection(b.direction)),
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
      ...this.buildTimeAxisChart('area', aligned.categories, groupBy, {
        counts: [aligned.filterDrops, aligned.filterFlags, aligned.egressBlocked, aligned.egressObserved],
      }),
      series: [
        { name: $localize`:@@featureAudit-seriesFilterDrops:Message drops`, data: aligned.filterDrops },
        { name: $localize`:@@featureAudit-seriesFilterFlags:Message flags`, data: aligned.filterFlags },
        { name: $localize`:@@featureAudit-seriesEgressBlocked:Blocked destinations`, data: aligned.egressBlocked },
        { name: $localize`:@@featureAudit-seriesEgressObserved:Observed (would block)`, data: aligned.egressObserved },
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
      ...this.buildTimeAxisChart('bar', aligned.categories, groupBy, {
        stacked: true,
        counts: [aligned.egressAllowed, aligned.egressBlocked, aligned.egressObserved],
      }),
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
    extra: { stacked?: boolean; counts?: readonly (readonly number[])[] } = {},
  ): Pick<AuditAxisChartOptions, 'chart' | 'dataLabels' | 'xaxis' | 'yaxis' | 'grid'> {
    const axisDateFormat = groupBy === 'day' ? 'mediumDate' : 'short';

    return {
      chart: fpcChart(type, 280, { stacked: extra.stacked }),
      dataLabels: { enabled: false },
      xaxis: {
        ...FPC_CHART_AXIS,
        categories,
        labels: {
          style: FPC_CHART_LABEL_STYLE,
          formatter: (value: string): string => this.formatAxisDateLabel(value, axisDateFormat),
        },
      },
      // Shared count axis (integer labels) + whole-unit ticks for small ranges (AG-08: no 0.5 steps).
      yaxis: { ...fpcChartCountAxis(), ...countAxisScale(extra.counts ?? [], extra.stacked) },
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
      chart: fpcChart('donut', 320),
      colors,
      labels,
      dataLabels: { ...FPC_CHART_SLICE_LABELS, enabled: showSliceLabels },
      // Legend below the ring and scrollable (AG-08): long rule names neither clip nor squeeze the donut on phones.
      legend: FPC_CHART_LEGEND_SCROLL,
      responsive: FPC_CHART_RESPONSIVE as ApexResponsive[],
      tooltip: FPC_CHART_SLICE_TOOLTIP,
      heading: title,
    };
  }

  ngOnInit(): void {
    const stored = this.loadFilters();
    // Filters from the URL (shared links, reload) win over the stored ones.
    const fromUrl = this.filterState.activeCount() > 0;

    if (stored) {
      if (!fromUrl) {
        if (stored.selectedClientId !== undefined) this.selectedClientId.set(stored.selectedClientId);

        if (stored.fromDate) this.fromDate.set(stored.fromDate);

        if (stored.toDate) this.toDate.set(stored.toDate);

        if (stored.groupBy === 'day' || stored.groupBy === 'hour') this.groupBy.set(stored.groupBy);
      }

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

      if (stored.activeTab && AUDIT_TABS.includes(stored.activeTab)) this.activeTab.set(stored.activeTab);
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

  /** Live apply (no Apply button): the drawer stays open while the filters change; Esc / outside click close it. */
  onApplyFilters(): void {
    this.resetPages();
    this.applyFilters();
  }

  onResetFilters(): void {
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
    this.resetPages();
    this.applyFilters();
  }

  onFiltersOpenChange(open: boolean): void {
    this.filtersCollapsed.set(!open);
  }

  onEgressEventsSearchChange(value: string): void {
    this.egressEventsSearch.set(value);
    this.egressEventsPage.set(1);
    this.scheduleLoad('web-traffic', 300);
  }

  onEgressDecisionChange(value: string): void {
    const decision = this.egressDecisions.includes(value as StatisticsEgressDecision)
      ? (value as StatisticsEgressDecision)
      : '';

    this.egressDecision.set(decision);
    this.egressDecisionDraft.set(decision);
    this.egressEventsPage.set(1);
    this.scheduleLoad('web-traffic', 0);
  }

  onChatIoSearchChange(value: string): void {
    this.chatIoSearch.set(value);
    this.chatIoPage.set(1);
    this.scheduleLoad('chat-io', 300);
  }

  onFilterDropsSearchChange(value: string): void {
    this.filterDropsSearch.set(value);
    this.filterDropsPage.set(1);
    this.scheduleLoad('filter-drops', 300);
  }

  onFilterFlagsSearchChange(value: string): void {
    this.filterFlagsSearch.set(value);
    this.filterFlagsPage.set(1);
    this.scheduleLoad('filter-flags', 300);
  }

  onEntityEventsSearchChange(value: string): void {
    this.entityEventsSearch.set(value);
    this.entityEventsPage.set(1);
    this.scheduleLoad('entity-events', 300);
  }

  private resetPages(): void {
    this.chatIoPage.set(1);
    this.filterDropsPage.set(1);
    this.filterFlagsPage.set(1);
    this.entityEventsPage.set(1);
    this.egressEventsPage.set(1);
  }

  private applyFilters(): void {
    const baseParams = this.getBaseParams();

    this.statisticsFacade.loadSummary(baseParams);
    this.filterVersion.update((version) => version + 1);
  }

  /**
   * Loads a table after `delay` ms; requests within that window coalesce (a search keystroke and the page reset it
   * causes load once, after the debounce).
   */
  private scheduleLoad(table: AuditTable, delay: number): void {
    const due = Date.now() + delay;
    const pending = this.loadTimers.get(table);

    if (pending && pending.due >= due) return;
    if (pending) clearTimeout(pending.handle);

    this.loadTimers.set(table, {
      due,
      handle: setTimeout(() => {
        this.loadTimers.delete(table);
        this.loadTable(table);
      }, delay),
    });
  }

  private loadTable(table: AuditTable): void {
    switch (table) {
      case 'chat-io':
        return this.loadChatIo();
      case 'filter-drops':
        return this.loadFilterDrops();
      case 'filter-flags':
        return this.loadFilterFlags();
      case 'web-traffic':
        return this.loadEgressEvents();
      case 'entity-events':
        return this.loadEntityEvents();
    }
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
      limit: this.chatIoPageSize(),
      offset: (this.chatIoPage() - 1) * this.chatIoPageSize(),
    });
  }

  private loadFilterDrops(): void {
    const base = this.getBaseParams();
    const search = this.filterDropsSearch().trim() || undefined;

    this.statisticsFacade.loadFilterDrops({
      ...base,
      search,
      limit: this.filterDropsPageSize(),
      offset: (this.filterDropsPage() - 1) * this.filterDropsPageSize(),
    });
  }

  private loadFilterFlags(): void {
    const base = this.getBaseParams();
    const search = this.filterFlagsSearch().trim() || undefined;

    this.statisticsFacade.loadFilterFlags({
      ...base,
      search,
      limit: this.filterFlagsPageSize(),
      offset: (this.filterFlagsPage() - 1) * this.filterFlagsPageSize(),
    });
  }

  private loadEntityEvents(): void {
    const base = this.getBaseParams();
    const search = this.entityEventsSearch().trim() || undefined;

    this.statisticsFacade.loadEntityEvents({
      ...base,
      search,
      limit: this.entityEventsPageSize(),
      offset: (this.entityEventsPage() - 1) * this.entityEventsPageSize(),
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
      limit: this.egressEventsPageSize(),
      offset: (this.egressEventsPage() - 1) * this.egressEventsPageSize(),
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

    // Shared date-time format, never seconds (AG-20, X-04).
    return fpcFormatDateTime(iso, this.locale, iso);
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
        return $localize`:@@featureAudit-entityTypeClient:Workspace`;
      case 'agent':
        return $localize`:@@featureAudit-entityTypeEnvironment:Agent`;
      case 'client_user':
        return $localize`:@@featureAudit-entityTypeClientUser:Workspace member`;
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

  constructor() {
    // The active table loads on tab switch, page / page-size change and after the page filters (only that table:
    // light API load). `untracked` keeps the search / decision out (they schedule their own debounced load).
    const tables: { table: AuditTable; page: () => number; size: () => number }[] = [
      { table: 'chat-io', page: this.chatIoPage, size: this.chatIoPageSize },
      { table: 'filter-drops', page: this.filterDropsPage, size: this.filterDropsPageSize },
      { table: 'filter-flags', page: this.filterFlagsPage, size: this.filterFlagsPageSize },
      { table: 'web-traffic', page: this.egressEventsPage, size: this.egressEventsPageSize },
      { table: 'entity-events', page: this.entityEventsPage, size: this.entityEventsPageSize },
    ];

    for (const entry of tables) {
      effect(() => {
        entry.page();
        entry.size();
        this.filterVersion();

        if (this.activeTab() === entry.table) untracked(() => this.scheduleLoad(entry.table, 0));
      });
    }

    // The drawer starts from the applied decision whenever it opens.
    effect(() => {
      if (this.egressFiltersOpen()) untracked(() => this.egressDecisionDraft.set(this.egressDecision()));
    });

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
      this.activeTab();
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
        activeTab: this.activeTab(),
      };

      window.localStorage.setItem(AUDIT_FILTERS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore storage errors */
    }
  }
}
