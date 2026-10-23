import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule, type ParamMap } from '@angular/router';
import {
  apiErrorMessage,
  CONSOLE_LOG_LEVELS,
  CONSOLE_LOG_SOURCES,
  ConsoleAccessFacade,
  ConsoleLogsFacade,
  LogsService,
  type ConsoleLogLevel,
  type ConsoleLogSource,
  type LogExportFormat,
  type LogFilter,
  type LogLine,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcCollapsibleFilterPanelComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcPageHeaderComponent,
  FpcPagerComponent,
  FpcPanelComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

import { saveFile } from '../live/live-format';
import {
  localInputToIso,
  LOG_LEVEL_TONE,
  LOG_RANGES,
  logLevelLabel,
  logRangeLabel,
  logSourceLabel,
  rangeMs,
  isoToLocalInput,
  type LogRange,
} from './logs-format';

/** Label filters in the URL and the form. */
const TEXT_FILTERS = ['project', 'deployment', 'service', 'replica', 'node', 'policy', 'text'] as const;

type TextFilter = (typeof TEXT_FILTERS)[number];

const PAGE_SIZES = [50, 100, 250, 500];

const DEFAULT_RANGE: LogRange = '1h';

/**
 * The log explorer (3.14): time range, sources, levels, labels and full text; newest first, paged by cursor; live
 * tail over `socket/logs`; export. The filter lives in the URL, so other views link to it
 * (`/logs?project=shop&service=api`).
 */
@Component({
  selector: 'loadweaver-logs-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcCollapsibleFilterPanelComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcPageHeaderComponent,
    FpcPagerComponent,
    FpcPanelComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './logs-page.component.html',
  styleUrl: './logs-page.component.scss',
  standalone: true,
})
export class LoadweaverLogsPageComponent implements OnInit, OnDestroy {
  private readonly facade = inject(ConsoleLogsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly service = inject(LogsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  readonly lines = toSignal(this.facade.lines$, { initialValue: [] as LogLine[] });
  readonly page = toSignal(this.facade.page$, { initialValue: 0 });
  readonly hasNext = toSignal(this.facade.hasNext$, { initialValue: false });
  readonly hasPrevious = toSignal(this.facade.hasPrevious$, { initialValue: false });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly tailing = toSignal(this.facade.tailing$, { initialValue: false });
  readonly tailConnected = toSignal(this.facade.tailConnected$, { initialValue: false });
  readonly tailError = toSignal(this.facade.tailError$, { initialValue: null });
  readonly tail = toSignal(this.facade.tail$, { initialValue: [] as LogLine[] });
  readonly projects = toSignal(this.access.projects$, { initialValue: [] as string[] });

  readonly range = signal<LogRange>(DEFAULT_RANGE);
  readonly customFrom = signal('');
  readonly customTo = signal('');
  readonly sources = signal<ReadonlySet<ConsoleLogSource>>(new Set());
  readonly levels = signal<ReadonlySet<ConsoleLogLevel>>(new Set());
  readonly labels = signal<Record<TextFilter, string>>({
    project: '',
    deployment: '',
    service: '',
    replica: '',
    node: '',
    policy: '',
    text: '',
  });
  readonly limit = signal(100);
  readonly expanded = signal<string | null>(null);
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  /** The filter of the shown results (with the resolved time range). */
  readonly applied = signal<LogFilter | null>(null);

  readonly filtersOpen = signal(false);

  /** Panel filters that differ from the defaults (the full-text search field is not counted). */
  readonly activeFilterCount = computed(
    () =>
      TEXT_FILTERS.filter((name) => name !== 'text' && this.labels()[name].trim()).length +
      (this.range() !== DEFAULT_RANGE ? 1 : 0) +
      (this.sources().size > 0 ? 1 : 0) +
      (this.levels().size > 0 ? 1 : 0),
  );

  readonly shown = computed(() => (this.tailing() ? this.tail() : this.lines()));

  /** Label inputs after the project (which may be a select). */
  readonly labelInputs: TextFilter[] = ['deployment', 'service', 'replica', 'node', 'policy'];
  readonly allSources = CONSOLE_LOG_SOURCES;
  readonly allLevels = CONSOLE_LOG_LEVELS;
  readonly ranges = LOG_RANGES;
  readonly pageSizes = PAGE_SIZES;
  readonly levelTone = LOG_LEVEL_TONE;
  readonly levelLabel = logLevelLabel;
  readonly sourceLabel = logSourceLabel;
  readonly rangeLabel = logRangeLabel;

  readonly title = $localize`:@@lwConsoleLogs-title:Logs`;
  readonly searchLabel = $localize`:@@lwConsoleLogs-search:Search`;
  readonly rangeFilterLabel = $localize`:@@lwConsoleLogs-range:Time range`;
  readonly fromLabel = $localize`:@@lwConsoleLogs-from:From`;
  readonly toLabel = $localize`:@@lwConsoleLogs-to:To`;
  readonly sourcesLabel = $localize`:@@lwConsoleLogs-sources:Sources`;
  readonly levelsLabel = $localize`:@@lwConsoleLogs-levels:Levels`;
  readonly pageSizeLabel = $localize`:@@lwConsoleLogs-pageSize:Lines per page`;
  readonly newerLabel = $localize`:@@lwConsoleLogs-newer:Newer`;
  readonly olderLabel = $localize`:@@lwConsoleLogs-older:Older`;
  readonly followLabel = $localize`:@@lwConsoleLogs-follow:Live tail`;
  readonly stopLabel = $localize`:@@lwConsoleLogs-stop:Stop tail`;
  readonly clearLabel = $localize`:@@lwConsoleLogs-clear:Clear`;
  readonly pageLabel = $localize`:@@lwConsoleLogs-page:Page`;
  readonly filtersLabel = $localize`:@@lwConsoleLogs-filters:Filters`;
  readonly resetLabel = $localize`:@@lwConsoleLogs-reset:Reset`;
  readonly exportCsvLabel = $localize`:@@lwConsoleLogs-exportCsv:Export CSV`;
  readonly exportNdjsonLabel = $localize`:@@lwConsoleLogs-exportNdjson:Export NDJSON`;

  ngOnInit(): void {
    this.readUrl(this.route.snapshot.queryParamMap);
    this.search();

    if (this.route.snapshot.queryParamMap.get('live') === 'true') this.startTail();
  }

  ngOnDestroy(): void {
    this.facade.stopTail();
  }

  labelPlaceholder(name: TextFilter): string {
    switch (name) {
      case 'project':
        return $localize`:@@lwConsoleLogs-project:Project`;
      case 'deployment':
        return $localize`:@@lwConsoleLogs-deployment:Deployment`;
      case 'service':
        return $localize`:@@lwConsoleLogs-service:Service`;
      case 'replica':
        return $localize`:@@lwConsoleLogs-replica:Replica (project/deployment/service/index)`;
      case 'node':
        return $localize`:@@lwConsoleLogs-node:Node`;
      case 'policy':
        return $localize`:@@lwConsoleLogs-policy:Policy`;
      default:
        return $localize`:@@lwConsoleLogs-text:Full text`;
    }
  }

  setLabel(name: TextFilter, value: string): void {
    this.labels.set({ ...this.labels(), [name]: value });
  }

  toggleSource(source: ConsoleLogSource): void {
    const next = new Set(this.sources());

    if (next.has(source)) next.delete(source);
    else next.add(source);

    this.sources.set(next);
  }

  toggleLevel(level: ConsoleLogLevel): void {
    const next = new Set(this.levels());

    if (next.has(level)) next.delete(level);
    else next.add(level);

    this.levels.set(next);
  }

  /** The filter of the form; relative ranges resolved to fixed times (stable paging). */
  filter(): LogFilter {
    const range = this.range();
    let from: string | undefined;
    let to: string | undefined;

    if (range === 'custom') {
      from = localInputToIso(this.customFrom()) ?? undefined;
      to = localInputToIso(this.customTo()) ?? undefined;
    } else {
      const now = Date.now();

      to = new Date(now).toISOString();
      from = new Date(now - rangeMs(range)).toISOString();
    }

    const filter: LogFilter = { from, to };

    if (this.sources().size > 0) filter.sources = [...this.sources()];

    if (this.levels().size > 0) filter.levels = [...this.levels()];

    for (const name of TEXT_FILTERS) {
      const value = this.labels()[name].trim();

      if (value) filter[name] = value;
    }

    if (!filter.from) delete filter.from;

    if (!filter.to) delete filter.to;

    return filter;
  }

  search(): void {
    const filter = this.filter();

    this.applied.set(filter);
    this.expanded.set(null);
    this.facade.search(filter, this.limit());
    this.syncUrl();

    if (this.tailing()) this.facade.startTail(filter);
  }

  /** Resets the panel filters (time range, sources, levels, labels) and searches again; keeps the full text. */
  resetFilters(): void {
    this.range.set(DEFAULT_RANGE);
    this.customFrom.set('');
    this.customTo.set('');
    this.sources.set(new Set());
    this.levels.set(new Set());
    this.labels.set({
      project: '',
      deployment: '',
      service: '',
      replica: '',
      node: '',
      policy: '',
      text: this.labels().text,
    });
    this.search();
  }

  onLimitChange(limit: number | string): void {
    this.limit.set(Number(limit));
    this.search();
  }

  older(): void {
    this.facade.next();
  }

  newer(): void {
    this.facade.previous();
  }

  startTail(): void {
    this.facade.startTail(this.filter());
    this.syncUrl(true);
  }

  stopTail(): void {
    this.facade.stopTail();
    this.syncUrl(false);
  }

  clearTail(): void {
    this.facade.clearTail();
  }

  toggle(line: LogLine): void {
    this.expanded.set(this.expanded() === line.id ? null : line.id);
  }

  labelEntries(line: LogLine): { key: string; value: string }[] {
    return Object.entries({ ...line.labels, ...line.fields })
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => ({ key, value: String(value) }));
  }

  /** The map at the line's time (timeline view, cluster roles). */
  mapParams(line: LogLine): Record<string, string> {
    return { mode: 'timeline', at: line.at };
  }

  /** Narrows the filter to a label of a line. */
  narrow(name: TextFilter, value: string | undefined): void {
    if (!value) return;

    this.setLabel(name, value);
    this.search();
  }

  export(format: LogExportFormat): void {
    this.exporting.set(true);
    this.exportError.set(null);
    this.service.export(this.applied() ?? this.filter(), format).subscribe({
      next: (content) => {
        this.exporting.set(false);
        this.download(content, format);
      },
      error: (error: unknown) => {
        this.exporting.set(false);
        this.exportError.set(apiErrorMessage(error, 'Export failed'));
      },
    });
  }

  private readUrl(params: ParamMap): void {
    const list = (name: string) =>
      (params.get(name) ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    const from = params.get('from');
    const to = params.get('to');
    const range = params.get('range') as LogRange | null;

    if (from || to) {
      this.range.set('custom');
      this.customFrom.set(isoToLocalInput(from));
      this.customTo.set(isoToLocalInput(to));
    } else if (range && LOG_RANGES.includes(range) && range !== 'custom') this.range.set(range);

    this.sources.set(
      new Set(
        list('sources').filter((s): s is ConsoleLogSource => CONSOLE_LOG_SOURCES.includes(s as ConsoleLogSource)),
      ),
    );
    this.levels.set(
      new Set(list('levels').filter((l): l is ConsoleLogLevel => CONSOLE_LOG_LEVELS.includes(l as ConsoleLogLevel))),
    );

    const labels = { ...this.labels() };

    for (const name of TEXT_FILTERS) labels[name] = params.get(name) ?? '';

    this.labels.set(labels);
  }

  private syncUrl(live = this.tailing()): void {
    const range = this.range();
    const labels = this.labels();
    const queryParams: Record<string, string | null> = {
      range: range === 'custom' ? null : range,
      from: range === 'custom' ? localInputToIso(this.customFrom()) : null,
      to: range === 'custom' ? localInputToIso(this.customTo()) : null,
      sources: this.sources().size > 0 ? [...this.sources()].join(',') : null,
      levels: this.levels().size > 0 ? [...this.levels()].join(',') : null,
      live: live ? 'true' : null,
    };

    for (const name of TEXT_FILTERS) queryParams[name] = labels[name].trim() || null;

    void this.router.navigate([], { relativeTo: this.route, replaceUrl: true, queryParams });
  }

  private download(content: string, format: LogExportFormat): void {
    saveFile(this.document, content, `logs-${new Date().toISOString().slice(0, 10)}.${format}`);
  }
}
