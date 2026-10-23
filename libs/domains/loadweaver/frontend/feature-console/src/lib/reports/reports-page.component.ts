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
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

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

/** Queued and running reports are polled until they finish. */
const POLL_MS = 15_000;

/**
 * Periodic reports (3.25): runs per scope and month, re-runs for a finished month (cluster admins, project admins), and
 * the reports' file tree with downloads, folder archives and the printable page in a sandboxed viewer.
 */
@Component({
  selector: 'loadweaver-reports-page',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
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

  readonly activeTab = signal<string | null>('runs');
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
    this.activeTab.set('files');
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
