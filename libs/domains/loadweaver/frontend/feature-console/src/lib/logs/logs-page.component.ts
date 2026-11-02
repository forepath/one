import { CommonModule, DOCUMENT, NgTemplateOutlet } from '@angular/common';
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
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcPageHeaderComponent,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  type FpcBadgeTone,
  type FpcTableColumn,
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
import { injectSectionScope, sectionQuery } from '../section/section-scope';
import { type SavedViewBinding, savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

/** Label filters in the URL and the form. */
const TEXT_FILTERS = ['project', 'deployment', 'service', 'replica', 'node', 'policy', 'text'] as const;

type TextFilter = (typeof TEXT_FILTERS)[number];

const PAGE_SIZES = [25, 50, 100];

const DEFAULT_RANGE: LogRange = '1h';

/**
 * The log explorer (3.14): time range, sources, levels, labels and full text; newest first, paged by cursor; live
 * tail over `socket/logs`; export. The filter lives in the URL, so other views link to it
 * (`/observe/logs?project=shop&service=api`).
 *
 * Embeddable (3.38, object tabs Logs of nodes / deployments / VMs): the scope's `node` / `project` / `deployment` /
 * `service` are fixed filters (their drawer fields hidden, kept on Clear all), no URL writes, no page header (the
 * actions sit in the table's toolbar strip).
 */
@Component({
  selector: 'loadweaver-logs-page',
  imports: [
    LoadweaverSavedViewsComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
    NgTemplateOutlet,
  ],
  templateUrl: './logs-page.component.html',
  styleUrl: './logs-page.component.scss',
  standalone: true,
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
})
export class LoadweaverLogsPageComponent implements OnInit, OnDestroy {
  private readonly facade = inject(ConsoleLogsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly service = inject(LogsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  /** The object scope when embedded in an object tab (3.38), else `null`. */
  readonly scope = injectSectionScope();
  /** Label filters the scope fixes (hidden in the drawer, kept on Clear all, not counted). */
  readonly fixed: ReadonlySet<string> = new Set(
    Object.keys(this.scope?.params() ?? {}).filter((key) => (TEXT_FILTERS as readonly string[]).includes(key)),
  );

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
  readonly limit = signal(25);
  readonly expanded = signal<string | null>(null);
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  /** The filter of the shown results (with the resolved time range). */
  readonly applied = signal<LogFilter | null>(null);
  /** "Views ▾" (3.37): saved filters of the log search, per user (sets stored as lists). */
  readonly views: SavedViewBinding = {
    state: computed(() => ({
      range: this.range(),
      customFrom: this.customFrom(),
      customTo: this.customTo(),
      sources: [...this.sources()].sort(),
      levels: [...this.levels()].sort(),
      labels: this.labels(),
      limit: this.limit(),
    })),
    apply: (state) => {
      const list = (value: unknown) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);

      savedViewBinding({
        range: this.range,
        customFrom: this.customFrom,
        customTo: this.customTo,
        labels: this.labels,
        limit: this.limit,
      }).apply(state);
      this.sources.set(new Set(list(state['sources']) as ConsoleLogSource[]));
      this.levels.set(new Set(list(state['levels']) as ConsoleLogLevel[]));
      this.search();
    },
  };

  readonly filtersOpen = signal(false);

  /** Applied panel filters that differ from the defaults (3.38 R12: follows Apply; the lead search is not counted). */
  readonly activeFilterCount = signal(0);
  private textTimer: ReturnType<typeof setTimeout> | null = null;

  readonly shown = computed(() => (this.tailing() ? this.tail() : this.lines()));

  /** Label inputs after the project (which may be a select). */
  readonly labelInputs: TextFilter[] = (['deployment', 'service', 'replica', 'node', 'policy'] as TextFilter[]).filter(
    (name) => !this.fixed.has(name),
  );
  readonly columns: FpcTableColumn<LogLine>[] = [
    {
      id: 'level',
      label: $localize`:@@lwConsoleLogs-colLevel:Level`,
      type: 'state',
      state: (line) => ({ label: logLevelLabel(line.level), tone: LOG_LEVEL_TONE[line.level] }),
      sortable: false,
    },
    {
      id: 'at',
      label: $localize`:@@lwConsoleLogs-colTime:Time`,
      width: '11rem',
      required: true,
      sortable: false,
      priority: 1,
    },
    {
      id: 'source',
      label: $localize`:@@lwConsoleLogs-colSource:Source`,
      value: (line) => logSourceLabel(line.source),
      sortable: false,
    },
    { id: 'where', label: $localize`:@@lwConsoleLogs-colWhere:Where`, sortable: false },
    {
      id: 'message',
      label: $localize`:@@lwConsoleLogs-colMessage:Message`,
      value: (line) => line.message,
      width: '50%',
      mono: true,
      required: true,
      sortable: false,
    },
  ];
  readonly rowId = (line: LogLine): string => line.id;
  readonly allSources = CONSOLE_LOG_SOURCES;
  readonly allLevels = CONSOLE_LOG_LEVELS;
  readonly ranges = LOG_RANGES;
  readonly pageSizes = PAGE_SIZES;
  /** Tone per log level (a function so the untyped table-cell context can call it under strict templates). */
  readonly levelTone = (level: keyof typeof LOG_LEVEL_TONE): FpcBadgeTone => LOG_LEVEL_TONE[level];
  readonly levelLabel = logLevelLabel;
  readonly sourceLabel = logSourceLabel;
  readonly rangeLabel = logRangeLabel;

  readonly title = $localize`:@@lwConsoleLogs-title:Logs`;
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
  readonly exportCsvLabel = $localize`:@@lwConsoleLogs-exportCsv:Export CSV`;
  readonly exportNdjsonLabel = $localize`:@@lwConsoleLogs-exportNdjson:Export NDJSON`;
  readonly loadingLabel = $localize`:@@lwConsoleLogs-loading:Loading log lines`;

  ngOnInit(): void {
    const params = sectionQuery(this.route, this.scope);

    this.readUrl(params);
    this.search();

    if (params.get('live') === 'true') this.startTail();
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
        return $localize`:@@lwConsoleLogs-text:Search log lines`;
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

  /** The lead full-text search is live (debounced); the drawer fields wait for Apply. */
  onTextChange(value: string): void {
    this.setLabel('text', value);

    if (this.textTimer) clearTimeout(this.textTimer);
    this.textTimer = setTimeout(() => {
      this.textTimer = null;
      this.search();
    }, 300);
  }

  search(): void {
    const filter = this.filter();

    this.applied.set(filter);
    this.activeFilterCount.set(
      TEXT_FILTERS.filter((name) => name !== 'text' && !this.fixed.has(name) && this.labels()[name].trim()).length +
        (this.range() !== DEFAULT_RANGE ? 1 : 0) +
        (this.sources().size > 0 ? 1 : 0) +
        (this.levels().size > 0 ? 1 : 0),
    );
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
    const labels = this.labels();
    const keep = (name: TextFilter) => (this.fixed.has(name) ? labels[name] : '');

    this.labels.set({
      project: keep('project'),
      deployment: keep('deployment'),
      service: keep('service'),
      replica: keep('replica'),
      node: keep('node'),
      policy: keep('policy'),
      text: labels.text,
    });
    this.search();
  }

  onLimitChange(limit: number | string): void {
    this.limit.set(Number(limit));
    this.search();
  }

  /** Server paging (cursor): one page newer / older; back to page 1 starts over. */
  onPage(page: number): void {
    const current = this.page() + 1;

    if (page === current) return;

    if (page === 1 && current > 2) this.search();
    else if (page > current) this.older();
    else this.newer();
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
    // Embedded in an object tab: the URL belongs to the object page.
    if (this.scope) return;

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
