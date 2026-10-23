import { CommonModule, DOCUMENT } from '@angular/common';
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
  FpcCollapsibleFilterPanelComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcPageHeaderComponent,
  FpcPagerComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
} from '@forepath/shared/frontend/ui-components';

import { saveFile } from '../live/live-format';
import { isoToLocalInput, localInputToIso } from '../logs/logs-format';
import {
  bucketFormat,
  formatUsageValue,
  meterTotals,
  meterUnit,
  pivotUsage,
  USAGE_METER_ORDER,
  type UsageTableRow,
} from './usage-format';

const GRANULARITIES: readonly UsageGranularity[] = ['hour', 'day', 'month'];
const PAGE_SIZES = [25, 50, 100, 250];

/**
 * Usage metering per project (3.24): CPU, memory, storage, traffic and public addresses by hour, day or month, with
 * totals and a CSV export (the numbers Decabill bills). Project members see their projects; cluster roles may also
 * look at all projects at once. Filters live in the URL.
 */
@Component({
  selector: 'loadweaver-usage-page',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcCollapsibleFilterPanelComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcPageHeaderComponent,
    FpcPagerComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
  ],
  templateUrl: './usage-page.component.html',
  standalone: true,
})
export class LoadweaverUsagePageComponent implements OnInit {
  private readonly facade = inject(ConsoleUsageFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly service = inject(ConsoleUsageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

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
  readonly page = signal(0);
  readonly pageSize = signal(50);
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  private started = false;
  private issued = false;

  readonly meters = USAGE_METER_ORDER;
  readonly granularities = GRANULARITIES;
  readonly pageSizes = PAGE_SIZES;

  readonly lines = computed(() => pivotUsage(this.report()?.rows ?? []));
  readonly pageLines = computed(() =>
    this.lines().slice(this.page() * this.pageSize(), (this.page() + 1) * this.pageSize()),
  );
  readonly hasNext = computed(() => (this.page() + 1) * this.pageSize() < this.lines().length);
  readonly totals = computed(() => meterTotals(this.report()));
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
  readonly noProject = computed(() => !this.clusterWide() && this.memberProjects().length === 0);
  readonly activeFilterCount = computed(
    () =>
      (this.project() ? 1 : 0) +
      (this.granularity() !== 'day' ? 1 : 0) +
      (this.fromInput() ? 1 : 0) +
      (this.toInput() ? 1 : 0),
  );

  readonly title = $localize`:@@lwConsoleUsage-title:Usage`;
  readonly refreshLabel = $localize`:@@lwConsoleUsage-refresh:Refresh`;
  readonly exportCsvLabel = $localize`:@@lwConsoleUsage-exportCsv:Export CSV`;
  readonly filtersLabel = $localize`:@@lwConsoleUsage-filters:Filters`;
  readonly projectLabel = $localize`:@@lwConsoleUsage-project:Project`;
  readonly granularityLabel = $localize`:@@lwConsoleUsage-granularity:Resolution`;
  readonly fromLabel = $localize`:@@lwConsoleUsage-from:From`;
  readonly toLabel = $localize`:@@lwConsoleUsage-to:To`;
  readonly applyLabel = $localize`:@@lwConsoleUsage-apply:Apply`;
  readonly resetLabel = $localize`:@@lwConsoleUsage-reset:Reset`;
  readonly pageLabel = $localize`:@@lwConsoleUsage-page:Page`;
  readonly newerLabel = $localize`:@@lwConsoleUsage-newer:Newer`;
  readonly olderLabel = $localize`:@@lwConsoleUsage-older:Older`;
  readonly pageSizeLabel = $localize`:@@lwConsoleUsage-pageSize:Rows per page`;

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
    const params = this.route.snapshot.queryParamMap;
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
    this.page.set(0);
    this.facade.load(query);
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

  reset(): void {
    this.project.set(this.clusterWide() ? '' : (this.memberProjects()[0] ?? ''));
    this.granularity.set('day');
    this.fromInput.set('');
    this.toInput.set('');
    this.load();
  }

  onPageSizeChange(size: number | string): void {
    this.pageSize.set(Number(size));
    this.page.set(0);
  }

  next(): void {
    if (this.hasNext()) this.page.set(this.page() + 1);
  }

  previous(): void {
    if (this.page() > 0) this.page.set(this.page() - 1);
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
