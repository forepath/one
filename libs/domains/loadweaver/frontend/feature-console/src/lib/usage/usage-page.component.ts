import { CommonModule, DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  apiErrorMessage,
  ConsoleAccessFacade,
  ConsoleUsageFacade,
  ConsoleUsageService,
  type UsageGranularity,
  type UsageMeterKey,
  type UsageQuery,
  type UsageReport,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
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
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { saveFile } from '../live/live-format';
import { LoadweaverMetricChartComponent } from '../metrics/metric-chart.component';
import { isoToLocalInput, localInputToIso } from '../logs/logs-format';
import { injectSectionScope, sectionQuery } from '../section/section-scope';
import {
  bucketFormat,
  formatUsageValue,
  meterTotals,
  meterUnit,
  pivotUsage,
  USAGE_CATEGORIES,
  USAGE_METER_ORDER,
  usageSeries,
  type UsageCategory,
  type UsageTableRow,
} from './usage-format';

const GRANULARITIES: readonly UsageGranularity[] = ['hour', 'day', 'month'];

/** Summary-card glyphs (Bootstrap icon names) per usage meter. */
const USAGE_METER_ICONS: Record<UsageMeterKey, string> = {
  cpu_core_hours: 'cpu',
  memory_gib_hours: 'memory',
  storage_gib_hours: 'device-hdd',
  storage_replica_gib_hours: 'layers',
  traffic_in_gb: 'cloud-download',
  traffic_out_gb: 'cloud-upload',
  public_ip_hours: 'globe',
};

/**
 * Usage metering per project (3.24): CPU, memory, storage, traffic and public addresses by hour, day or month, with
 * totals and a CSV export (the numbers Decabill bills). Project members see their projects; cluster roles may also
 * look at all projects at once. Filters live in the URL. Tabs (3.38 D4 / decision 13): **Overview** — one bar chart
 * per meter (a series per project) grouped Compute · Storage · Network, the drawer also toggles which charts show;
 * **Lines** — the table.
 *
 * Embeddable (3.38, project tab Usage): the scope's `project` is fixed (API-side; picker and page header hidden, kept on
 * Clear all, not counted), no URL writes.
 */
@Component({
  selector: 'loadweaver-usage-page',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
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
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    LoadweaverMetricChartComponent,
    NgTemplateOutlet,
  ],
  templateUrl: './usage-page.component.html',
  standalone: true,
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
})
export class LoadweaverUsagePageComponent implements OnInit {
  private readonly facade = inject(ConsoleUsageFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly service = inject(ConsoleUsageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  /** The object scope when embedded in an object tab (3.38), else `null`. */
  readonly scope = injectSectionScope();

  readonly report = toSignal(this.facade.report$, { initialValue: null as UsageReport | null });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null as string | null });
  readonly memberProjects = toSignal(this.access.projects$, { initialValue: [] as string[] });
  /** Cluster roles (any) may see all projects at once. */
  readonly clusterWide = toSignal(this.access.seesInfrastructure$, { initialValue: false });

  readonly project = signal('');
  readonly granularity = signal<UsageGranularity>('day');
  readonly fromInput = signal('');
  readonly toInput = signal('');
  readonly filtersOpen = signal(false);
  /** The table's page (1-based; client paging over the loaded report, back to 1 on a new report). */
  readonly page = signal(1);
  readonly tab = signal<'overview' | 'lines'>('overview');
  /** Meters whose charts the overview hides (applied) and the drawer's draft of it. */
  readonly hiddenMeters = signal<readonly UsageMeterKey[]>([]);
  readonly hiddenDraft = signal<readonly UsageMeterKey[]>([]);
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  private started = false;
  private issued = false;

  readonly meters = USAGE_METER_ORDER;
  readonly granularities = GRANULARITIES;

  readonly lines = computed(() => pivotUsage(this.report()?.rows ?? []));
  readonly totals = computed(() => meterTotals(this.report()));
  /** The overview's chart sections: meters with data, hidden ones left out. */
  readonly chartGroups = computed(() => {
    const rows = this.report()?.rows ?? [];
    const hidden = new Set(this.hiddenMeters());

    return USAGE_CATEGORIES.map(({ category, meters }) => ({
      category,
      label: this.categoryLabel(category),
      charts: meters
        .filter((meter) => !hidden.has(meter))
        .map((meter) => ({
          meter,
          label: this.meterLabel(meter),
          unit: this.unit(meter),
          series: usageSeries(rows, meter),
        }))
        .filter((chart) => chart.series.length > 0),
    })).filter((group) => group.charts.length > 0);
  });
  readonly categories = USAGE_CATEGORIES;
  /** Period, project, then one right-aligned column per meter (unit in the label once the report names it). */
  readonly columns = computed<FpcTableColumn<UsageTableRow>[]>(() => [
    { id: 'bucket', label: this.bucketLabel, required: true, mono: true, sortable: false },
    { id: 'project', label: this.projectLabel, value: (line) => line.project, sortable: false },
    ...this.meters.map(
      (meter): FpcTableColumn<UsageTableRow> => ({
        id: meter,
        label: this.unit(meter) ? `${this.meterLabel(meter)} (${this.unit(meter)})` : this.meterLabel(meter),
        value: (line) => this.value(line, meter),
        align: 'end',
        mono: true,
        sortable: false,
      }),
    ),
  ]);
  readonly rowId = (line: UsageTableRow): string => `${line.bucket}|${line.project}`;
  /** Member projects, plus projects in the answer (cluster roles) and the current selection. */
  readonly projectOptions = computed(() =>
    [
      ...new Set([
        ...this.memberProjects(),
        ...(this.report()?.totals ?? []).map((t) => t.project),
        ...(this.project() ? [this.project()] : []),
      ]),
    ].sort(),
  );
  /** Without a cluster role a project has to be chosen (and there must be one). */
  readonly noProject = computed(() => !this.scope && !this.clusterWide() && this.memberProjects().length === 0);
  /** Applied filters (3.38 R12: the count follows Apply, not the drawer's draft). */
  readonly activeFilterCount = signal(0);

  readonly title = $localize`:@@lwConsoleUsage-title:Usage`;
  readonly refreshLabel = $localize`:@@lwConsoleUsage-refresh:Refresh`;
  readonly exportCsvLabel = $localize`:@@lwConsoleUsage-exportCsv:Export CSV`;
  readonly projectLabel = $localize`:@@lwConsoleUsage-project:Project`;
  readonly granularityLabel = $localize`:@@lwConsoleUsage-granularity:Resolution`;
  readonly fromLabel = $localize`:@@lwConsoleUsage-from:From`;
  readonly toLabel = $localize`:@@lwConsoleUsage-to:To`;
  readonly bucketLabel = $localize`:@@lwConsoleUsage-colBucket:Period (UTC)`;
  readonly loadingLabel = $localize`:@@lwConsoleUsage-loading:Loading usage`;
  readonly tabOverview = $localize`:@@lwConsoleUsage-tabOverview:Overview`;
  readonly tabLines = $localize`:@@lwConsoleUsage-tabLines:Lines`;

  constructor() {
    // The access may arrive after the page opened: start once it says what the caller may see.
    effect(() => {
      const projects = this.memberProjects();
      const clusterWide = this.clusterWide();

      untracked(() => {
        if (!this.started || this.issued) return;

        if (!clusterWide && !this.project()) {
          if (projects.length === 0) return;

          this.project.set(projects[0]);
        }

        this.load();
      });
    });
  }

  ngOnInit(): void {
    const params = sectionQuery(this.route, this.scope);
    const granularity = params.get('granularity') as UsageGranularity | null;

    this.project.set(params.get('project') ?? '');
    this.granularity.set(granularity && GRANULARITIES.includes(granularity) ? granularity : 'day');
    this.fromInput.set(isoToLocalInput(params.get('from')));
    this.toInput.set(isoToLocalInput(params.get('to')));
    this.started = true;

    if (!this.project() && !this.clusterWide()) {
      const first = this.memberProjects()[0];

      // Without a cluster role and before the access is known: the effect starts later.
      if (!first) return;

      this.project.set(first);
    }

    this.load();
  }

  query(): UsageQuery {
    const from = localInputToIso(this.fromInput());
    const to = localInputToIso(this.toInput());

    return {
      project: this.project() || null,
      granularity: this.granularity(),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };
  }

  load(): void {
    const query = this.query();

    this.issued = true;
    this.activeFilterCount.set(
      (this.project() && !this.scope ? 1 : 0) +
        (this.granularity() !== 'day' ? 1 : 0) +
        (this.fromInput() ? 1 : 0) +
        (this.toInput() ? 1 : 0),
    );
    this.page.set(1);
    this.facade.load(query);

    // Embedded in an object tab: the URL belongs to the object page.
    if (this.scope) return;

    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        project: query.project ?? null,
        granularity: query.granularity === 'day' ? null : query.granularity,
        from: query.from ?? null,
        to: query.to ?? null,
      },
    });
  }

  /** The overview's drawer opened: its chart toggles start from the applied ones. */
  onOverviewFiltersOpen(open: boolean): void {
    this.filtersOpen.set(open);

    if (open) this.hiddenDraft.set(this.hiddenMeters());
  }

  /** Apply in the overview's drawer: the chart toggles, then the data filters. */
  applyOverview(): void {
    this.hiddenMeters.set(this.hiddenDraft());
    this.load();
  }

  isMeterShown(meter: UsageMeterKey): boolean {
    return !this.hiddenDraft().includes(meter);
  }

  toggleMeter(meter: UsageMeterKey, shown: boolean): void {
    const hidden = this.hiddenDraft().filter((m) => m !== meter);

    this.hiddenDraft.set(shown ? hidden : [...hidden, meter]);
  }

  categoryLabel(category: UsageCategory): string {
    switch (category) {
      case 'compute':
        return $localize`:@@lwConsoleUsage-catCompute:Compute`;
      case 'storage':
        return $localize`:@@lwConsoleUsage-catStorage:Storage`;
      default:
        return $localize`:@@lwConsoleUsage-catNetwork:Network`;
    }
  }

  reset(): void {
    this.hiddenMeters.set([]);
    this.hiddenDraft.set([]);
    if (!this.scope) this.project.set(this.clusterWide() ? '' : (this.memberProjects()[0] ?? ''));
    this.granularity.set('day');
    this.fromInput.set('');
    this.toInput.set('');
    this.load();
  }

  export(): void {
    const query = this.query();

    this.exporting.set(true);
    this.exportError.set(null);
    this.service.exportCsv(query).subscribe({
      next: (content) => {
        this.exporting.set(false);
        saveFile(
          this.document,
          content,
          `usage-${query.project ?? 'cluster'}-${query.granularity}-${new Date().toISOString().slice(0, 10)}.csv`,
        );
      },
      error: (error: unknown) => {
        this.exporting.set(false);
        this.exportError.set(apiErrorMessage(error, 'Export failed'));
      },
    });
  }

  /** Faint summary-card glyph per meter. */
  meterIcon(meter: UsageMeterKey): string {
    return USAGE_METER_ICONS[meter];
  }

  meterLabel(meter: UsageMeterKey): string {
    switch (meter) {
      case 'cpu_core_hours':
        return $localize`:@@lwConsoleUsage-meterCpu:CPU`;
      case 'memory_gib_hours':
        return $localize`:@@lwConsoleUsage-meterMemory:Memory`;
      case 'storage_gib_hours':
        return $localize`:@@lwConsoleUsage-meterStorage:Storage`;
      case 'storage_replica_gib_hours':
        return $localize`:@@lwConsoleUsage-meterStorageReplicas:Storage incl. replicas`;
      case 'traffic_in_gb':
        return $localize`:@@lwConsoleUsage-meterTrafficIn:Traffic in`;
      case 'traffic_out_gb':
        return $localize`:@@lwConsoleUsage-meterTrafficOut:Traffic out`;
      default:
        return $localize`:@@lwConsoleUsage-meterPublicIps:Public IPs`;
    }
  }

  granularityName(granularity: UsageGranularity): string {
    switch (granularity) {
      case 'hour':
        return $localize`:@@lwConsoleUsage-hourly:Hourly`;
      case 'day':
        return $localize`:@@lwConsoleUsage-daily:Daily`;
      default:
        return $localize`:@@lwConsoleUsage-monthly:Monthly`;
    }
  }

  unit(meter: UsageMeterKey): string {
    return meterUnit(this.report(), meter);
  }

  total(meter: UsageMeterKey): string {
    const unit = this.unit(meter);

    return `${formatUsageValue(this.totals()[meter] ?? 0)}${unit ? ` ${unit}` : ''}`;
  }

  value(line: UsageTableRow, meter: UsageMeterKey): string {
    return formatUsageValue(line.values[meter]);
  }

  bucketFormat(): string {
    return bucketFormat(this.report()?.granularity ?? this.granularity());
  }
}
