import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  apiErrorMessage,
  apiErrorMessageAsync,
  ConsoleAccessFacade,
  ConsoleReportsFacade,
  ReportsService,
  type Report,
  type ReportFileEntry,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcBreadcrumbItemComponent,
  FpcBreadcrumbsComponent,
  FpcButtonComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { filterBySearch } from '../list-search';
import { dlCopyIdItem } from '../section/data-list';
import { saveFile } from '../live/live-format';
import { formatBytes } from '../overview/console-format';
import {
  isFinishedMonth,
  lastFinishedMonth,
  monthValue,
  parentPath,
  parseMonth,
  pathCrumbs,
  readBlobText,
  REPORT_STATUS_TONE,
  reportFolder,
  reportHtmlPath,
  reportStatusLabel,
  reportViewerDocument,
  runnableScopes,
} from './report-format';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

/** Queued and running reports are polled until they finish. */
const POLL_MS = 15_000;

/**
 * Periodic reports (3.25): runs per scope and month, re-runs for a finished month (cluster admins, project admins), and
 * the reports' file tree with downloads, folder archives and the printable page in a sandboxed viewer.
 */
@Component({
  selector: 'loadweaver-reports-page',
  imports: [
    LoadweaverSavedViewsComponent,
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcBreadcrumbItemComponent,
    FpcBreadcrumbsComponent,
  ],
  templateUrl: './reports-page.component.html',
  standalone: true,
})
export class LoadweaverReportsPageComponent implements OnInit {
  private readonly facade = inject(ConsoleReportsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly service = inject(ReportsService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly reports = toSignal(this.facade.reports$, { initialValue: [] as Report[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly running = toSignal(this.facade.running$, { initialValue: false });
  readonly queued = toSignal(this.facade.queued$, { initialValue: null });
  readonly runError = toSignal(this.facade.runError$, { initialValue: null });
  readonly path = toSignal(this.facade.path$, { initialValue: '' });
  readonly entries = toSignal(this.facade.entries$, { initialValue: [] as ReportFileEntry[] });
  readonly entriesLoading = toSignal(this.facade.entriesLoading$, { initialValue: false });
  readonly entriesError = toSignal(this.facade.entriesError$, { initialValue: null });
  readonly me = toSignal(this.access.me$, { initialValue: null });

  /** Phone lane tab (below md one lane at a time): Runs | Files. */
  readonly lane = signal<'runs' | 'files'>('runs');
  readonly scope = signal('');
  readonly month = signal(monthValue(lastFinishedMonth().year, lastFinishedMonth().month));
  /** The file being fetched (download, archive or opened). */
  readonly busyPath = signal<string | null>(null);
  readonly fileError = signal<string | null>(null);
  readonly runOpen = signal(false);

  readonly scopes = computed(() =>
    runnableScopes(this.me(), [
      ...Object.keys(this.me()?.projects ?? {}),
      ...this.reports()
        .map((r) => r.scope)
        .filter((s) => s !== 'cluster'),
    ]),
  );
  readonly maxMonth = monthValue(lastFinishedMonth().year, lastFinishedMonth().month);
  readonly monthValid = computed(() => {
    const parsed = parseMonth(this.month());

    return !!parsed && isFinishedMonth(parsed.year, parsed.month);
  });
  readonly crumbs = computed(() => pathCrumbs(this.path()));
  /** Runs lane search. */
  readonly search = signal('');
  /** Files lane search (this folder). */
  readonly filesSearch = signal('');
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding({ search: this.search, filesSearch: this.filesSearch });
  readonly filteredReports = computed(() =>
    filterBySearch(this.reports(), this.search(), (r) => [
      r.scope,
      monthValue(r.year, r.month),
      reportStatusLabel(r.status),
      r.error,
    ]),
  );
  readonly filteredEntries = computed(() => filterBySearch(this.entries(), this.filesSearch(), (e) => [e.name]));
  readonly unfinished = computed(() => this.reports().some((r) => r.status === 'pending' || r.status === 'running'));

  readonly statusTone = REPORT_STATUS_TONE;
  readonly statusLabel = reportStatusLabel;
  readonly monthValue = monthValue;
  readonly folderOf = reportFolder;
  readonly htmlOf = reportHtmlPath;
  readonly bytes = formatBytes;

  readonly title = $localize`:@@lwConsoleReports-title:Reports`;
  readonly tabRuns = $localize`:@@lwConsoleReports-tabRuns:Runs`;
  readonly tabFiles = $localize`:@@lwConsoleReports-tabFiles:Files`;
  readonly refreshLabel = $localize`:@@lwConsoleReports-refresh:Refresh`;
  readonly rootLabel = $localize`:@@lwConsoleReports-root:Reports`;
  readonly breadcrumbsLabel = $localize`:@@lwConsoleReports-breadcrumbs:Folder`;
  readonly openLabel = $localize`:@@lwConsoleReports-open:Open report`;
  readonly downloadLabel = $localize`:@@lwConsoleReports-download:Download`;
  readonly archiveLabel = $localize`:@@lwConsoleReports-archive:Download as ZIP`;
  readonly folderLabel = $localize`:@@lwConsoleReports-showFiles:Show files`;
  readonly upLabel = $localize`:@@lwConsoleReports-up:Up`;
  readonly queuedMessage = $localize`:@@lwConsoleReports-queued:The report is queued; it shows up below when it runs.`;
  readonly runLabel = $localize`:@@lwConsoleReports-run:Run report`;
  readonly cancelLabel = $localize`:@@lwConsoleReports-cancel:Cancel`;
  readonly searchLabel = $localize`:@@lwConsoleReports-search:Search report runs`;
  readonly filesSearchLabel = $localize`:@@lwConsoleReports-searchFiles:Search report files`;
  readonly loadingLabel = $localize`:@@lwConsoleReports-loading:Loading report runs`;
  readonly filesLoadingLabel = $localize`:@@lwConsoleReports-filesLoading:Loading report files`;
  readonly clusterLabel = $localize`:@@lwConsoleReports-scopeCluster:Cluster`;

  /** 3.38 D1: State · Scope · month · completed · files · error; ⋮ open / show files; click opens the report. */
  readonly runColumns: FpcTableColumn<Report>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleReports-colStatus:Status`,
      type: 'state',
      state: (r) => ({ label: reportStatusLabel(r.status), tone: REPORT_STATUS_TONE[r.status] }),
    },
    {
      id: 'scope',
      label: $localize`:@@lwConsoleReports-colScope:Scope`,
      value: (r) => (r.scope === 'cluster' ? this.clusterLabel : r.scope),
      required: true,
      priority: 1,
    },
    {
      id: 'month',
      label: $localize`:@@lwConsoleReports-colMonth:Month`,
      value: (r) => monthValue(r.year, r.month),
      mono: true,
      priority: 1,
    },
    {
      id: 'completed',
      label: $localize`:@@lwConsoleReports-colCompleted:Completed`,
      value: (r) => r.completedAt ?? null,
      priority: 2,
    },
    {
      id: 'files',
      label: $localize`:@@lwConsoleReports-colFiles:Files`,
      value: (r) => r.files.length,
      align: 'end',
      width: '6rem',
      priority: 3,
    },
    { id: 'error', label: $localize`:@@lwConsoleReports-colError:Error`, value: (r) => r.error ?? '', priority: 2 },
  ];

  /** Files: Name · size · updated; download / ZIP inline, ⋮ open report. */
  readonly entryColumns: FpcTableColumn<ReportFileEntry>[] = [
    {
      id: 'name',
      label: $localize`:@@lwConsoleReports-colName:Name`,
      value: (e) => e.name,
      required: true,
      priority: 1,
    },
    {
      id: 'size',
      label: $localize`:@@lwConsoleReports-colSize:Size`,
      value: (e) => e.bytes ?? null,
      align: 'end',
      width: '7rem',
      priority: 1,
    },
    {
      id: 'updated',
      label: $localize`:@@lwConsoleReports-colUpdated:Updated`,
      value: (e) => e.updatedAt ?? null,
      priority: 2,
    },
  ];

  readonly entryId = (e: ReportFileEntry) => e.path;
  readonly runMenu = (r: Report): FpcMenuItem[] => {
    const html = r.status === 'completed' ? reportHtmlPath(r) : null;
    const folder = r.status === 'completed' ? reportFolder(r) : null;

    return [
      ...(html ? [{ id: 'open', label: this.openLabel, icon: 'box-arrow-up-right' }] : []),
      ...(folder ? [{ id: 'files', label: this.folderLabel, icon: 'folder2-open' }] : []),
      { ...dlCopyIdItem(), dividerBefore: !!html || !!folder },
    ];
  };
  /** The dominant action of a file row: download (folders: ZIP). */
  readonly entryInline = (e: ReportFileEntry): FpcMenuItem[] =>
    e.type === 'folder'
      ? [{ id: 'archive', label: this.archiveLabel, icon: 'file-earmark-zip', disabled: this.busyPath() === e.path }]
      : [{ id: 'download', label: this.downloadLabel, icon: 'download', disabled: this.busyPath() === e.path }];
  readonly entryMenu = (e: ReportFileEntry): FpcMenuItem[] =>
    e.type === 'file' && e.name === 'report.html'
      ? [{ id: 'open', label: this.openLabel, icon: 'box-arrow-up-right' }]
      : [];
  readonly popupBlocked = $localize`:@@lwConsoleReports-popupBlocked:The browser blocked the new tab.`;

  constructor() {
    // The first scope the caller may run, once known.
    effect(() => {
      const scopes = this.scopes();

      if (!scopes.includes(this.scope()) && scopes.length > 0) this.scope.set(scopes[0]);
    });
    // A queued run closes the run dialog; the confirmation shows above the runs.
    effect(() => {
      if (this.queued()) untracked(() => this.runOpen.set(false));
    });
  }

  ngOnInit(): void {
    this.facade.load();
    this.facade.openFolder('');
    interval(POLL_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.unfinished()) this.facade.load(true);
      });
  }

  refresh(): void {
    this.facade.load();
    this.facade.openFolder(this.path());
  }

  run(): void {
    const parsed = parseMonth(this.month());
    const scope = this.scope();

    if (!parsed || !scope || !this.monthValid()) return;

    this.facade.run({ scope, year: parsed.year, month: parsed.month });
  }

  openRun(): void {
    this.facade.clearRunResult();
    this.runOpen.set(true);
  }

  dismissRunResult(): void {
    this.facade.clearRunResult();
  }

  openFolder(path: string): void {
    this.facade.openFolder(path);
  }

  up(): void {
    this.facade.openFolder(parentPath(this.path()));
  }

  showFiles(report: Report): void {
    const folder = reportFolder(report);

    if (!folder) return;

    this.facade.openFolder(folder);
    this.lane.set('files');
  }

  /** Row click: a finished run opens its report. */
  activateRun(report: Report): void {
    const html = report.status === 'completed' ? reportHtmlPath(report) : null;

    if (html) this.openReport(html);
  }

  onRunAction(report: Report, action: string): void {
    const html = reportHtmlPath(report);

    if (action === 'open' && html) this.openReport(html);
    else if (action === 'files') this.showFiles(report);
    else if (action === 'copy-id') fpcCopyText(report.id);
  }

  onEntryAction(entry: ReportFileEntry, action: string): void {
    if (action === 'archive') this.downloadFolder(entry.path);
    else if (action === 'download') this.downloadFile(entry.path, entry.name);
    else if (action === 'open') this.openReport(entry.path);
  }

  openEntry(entry: ReportFileEntry): void {
    if (entry.type === 'folder') this.openFolder(entry.path);
    else if (entry.name === 'report.html') this.openReport(entry.path);
    else this.downloadFile(entry.path, entry.name);
  }

  /**
   * Opens the printable page in a new tab: fetched with the API's credentials, shown in a sandboxed frame of a blob
   * page. The tab is opened right away (popup blockers allow it only in the click).
   */
  openReport(path: string): void {
    const view = this.document.defaultView;

    if (!view?.URL?.createObjectURL) return;

    const tab = view.open('', '_blank');

    if (!tab) {
      this.fileError.set(this.popupBlocked);

      return;
    }

    this.busyPath.set(path);
    this.fileError.set(null);
    this.service.download(path).subscribe({
      next: (blob) =>
        void readBlobText(blob).then(
          (html) => {
            const viewer = new Blob([reportViewerDocument(html, path)], { type: 'text/html' });
            const url = view.URL.createObjectURL(viewer);

            // Kept for the console's session (released with it): the viewer tab can be reloaded while it is open.
            tab.location.href = url;
            this.busyPath.set(null);
          },
          (error: unknown) => {
            tab.close();
            this.busyPath.set(null);
            this.fileError.set(apiErrorMessage(error, 'Failed to open the report'));
          },
        ),
      error: (error: unknown) => {
        tab.close();
        this.busyPath.set(null);
        void apiErrorMessageAsync(error, 'Failed to open the report').then((message) => this.fileError.set(message));
      },
    });
  }

  downloadFile(path: string, name: string, event?: Event): void {
    event?.stopPropagation();
    this.fetch(path, this.service.download(path), name);
  }

  downloadFolder(path: string, event?: Event): void {
    event?.stopPropagation();
    this.fetch(path, this.service.archive(path), `${path.split('/').filter(Boolean).at(-1) || 'reports'}.zip`);
  }

  private fetch(path: string, request: ReturnType<ReportsService['download']>, name: string): void {
    this.busyPath.set(path);
    this.fileError.set(null);
    request.subscribe({
      next: (blob) => {
        this.busyPath.set(null);
        saveFile(this.document, blob, name);
      },
      error: (error: unknown) => {
        this.busyPath.set(null);
        void apiErrorMessageAsync(error, 'Download failed').then((message) => this.fileError.set(message));
      },
    });
  }
}
