import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AdminSpoolerService,
  type SpoolJob,
  type SpoolJobKind,
  type SpoolJobStatus,
  type SpoolOutputTarget,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
  type FpcTableState,
  type FpcTableView,
} from '@forepath/shared/frontend/ui-components';
import { finalize, interval } from 'rxjs';

import { formatBillingDateTime } from '../billing-format';
import { DB_DL_CANCEL, DB_DL_DOWNLOAD, DB_DL_RETRY, dbCopyIdItem } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';

/** While jobs are queued or running the list refreshes itself. */
const ACTIVE_REFRESH_MS = 3000;
const KIND_LABELS: Record<SpoolJobKind, string> = {
  'document.send': $localize`:@@featureAdminSpooler-kindDocumentSend:Document send`,
  'print.inventory_labels': $localize`:@@featureAdminSpooler-kindLabels:Labels`,
  'print.inventory_movement': $localize`:@@featureAdminSpooler-kindMovement:Inventory document`,
  'print.project_time_report': $localize`:@@featureAdminSpooler-kindTimeReport:Time report`,
};
const TARGET_LABELS: Record<SpoolOutputTarget, string> = {
  download: $localize`:@@featureAdminSpooler-targetDownload:Download`,
  email: $localize`:@@featureAdminSpooler-targetEmail:Email`,
  postal: $localize`:@@featureAdminSpooler-targetPostal:Letter`,
};
const STATUS_STATES: Record<SpoolJobStatus, FpcTableState> = {
  queued: { label: $localize`:@@featureAdminSpooler-statusQueued:Queued`, tone: 'info', icon: 'hourglass-split' },
  processing: {
    label: $localize`:@@featureAdminSpooler-statusProcessing:Processing`,
    tone: 'info',
    icon: 'arrow-repeat',
  },
  completed: {
    label: $localize`:@@featureAdminSpooler-statusCompleted:Completed`,
    tone: 'success',
    icon: 'check-circle-fill',
  },
  failed: { label: $localize`:@@featureAdminSpooler-statusFailed:Failed`, tone: 'danger', icon: 'x-circle-fill' },
  cancelled: {
    label: $localize`:@@featureAdminSpooler-statusCancelled:Cancelled`,
    tone: 'neutral',
    icon: 'slash-circle',
  },
};

/**
 * Spooler (Administration): admin printouts (labels, inventory documents, time reports) and document sends (email,
 * letter) that run as background jobs. Files of finished printouts can be downloaded again until the retention period
 * ends; failed jobs can be retried, queued ones cancelled (a cancelled send leaves the document unsent).
 */
@Component({
  selector: 'framework-admin-spooler-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FpcAlertComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
  ],
  templateUrl: './admin-spooler-page.component.html',
})
export class AdminSpoolerPageComponent implements OnInit {
  private readonly spooler = inject(AdminSpoolerService);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureAdminSpooler-title:Spooler`;
  readonly views: FpcTableView[] = [
    { id: 'all', name: $localize`:@@featureAdminSpooler-viewAll:All` },
    { id: 'queued', name: STATUS_STATES.queued.label },
    { id: 'processing', name: STATUS_STATES.processing.label },
    { id: 'completed', name: STATUS_STATES.completed.label },
    { id: 'failed', name: STATUS_STATES.failed.label },
    { id: 'cancelled', name: STATUS_STATES.cancelled.label },
  ];
  readonly activeView = signal<string>('all');
  readonly items = signal<SpoolJob[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Result of the last row action (retry, cancel, download). */
  readonly notice = signal<{ tone: 'success' | 'danger'; message: string } | null>(null);
  readonly hasActiveJobs = computed(() =>
    this.items().some((job) => job.status === 'queued' || job.status === 'processing'),
  );

  /** View (status) + page + size → `GET /admin/billing/spooler/jobs?status&limit&offset` (replace-page). */
  readonly paging = dbServerPaging((query) => this.load(query.page, query.pageSize), {
    url: '',
    filters: () => [this.activeView()],
  });

  readonly columns: FpcTableColumn<SpoolJob>[] = [
    {
      id: 'status',
      label: $localize`:@@featureAdminSpooler-colStatus:Status`,
      type: 'state',
      state: (job) => STATUS_STATES[job.status],
    },
    {
      id: 'title',
      label: $localize`:@@featureAdminSpooler-colJob:Job`,
      value: (job) => job.title,
      required: true,
      priority: 1,
    },
    {
      id: 'kind',
      label: $localize`:@@featureAdminSpooler-colKind:Type`,
      value: (job) => KIND_LABELS[job.kind] ?? job.kind,
      priority: 2,
    },
    {
      id: 'target',
      label: $localize`:@@featureAdminSpooler-colTarget:Output`,
      value: (job) => TARGET_LABELS[job.outputTarget] ?? job.outputTarget,
      priority: 2,
    },
    {
      id: 'created',
      label: $localize`:@@featureAdminSpooler-colCreated:Created`,
      value: (job) => job.createdAt,
      priority: 1,
    },
    {
      id: 'finished',
      label: $localize`:@@featureAdminSpooler-colFinished:Finished`,
      value: (job) => job.finishedAt ?? '',
      priority: 3,
    },
    {
      id: 'attempts',
      label: $localize`:@@featureAdminSpooler-colAttempts:Attempts`,
      value: (job) => job.attempts,
      align: 'end',
      priority: 3,
    },
    {
      id: 'error',
      label: $localize`:@@featureAdminSpooler-colError:Error`,
      value: (job) => job.error ?? '',
      priority: 2,
    },
  ];

  readonly rowInlineActions = (job: SpoolJob): FpcMenuItem[] =>
    job.hasFile ? [{ id: 'download', label: DB_DL_DOWNLOAD, icon: 'download' }] : [];
  readonly rowMenu = (job: SpoolJob): FpcMenuItem[] => [
    { id: 'download', label: DB_DL_DOWNLOAD, icon: 'download', disabled: !job.hasFile },
    { id: 'retry', label: DB_DL_RETRY, icon: 'arrow-clockwise', disabled: !job.canRetry },
    { id: 'cancel', label: DB_DL_CANCEL, icon: 'x-circle', disabled: !job.canCancel },
    dbCopyIdItem(),
  ];

  ngOnInit(): void {
    interval(ACTIVE_REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.hasActiveJobs() && !this.loading()) this.paging.reload();
      });
  }

  onViewSelect(view: FpcTableView): void {
    this.activeView.set(view.id);
  }

  onRowAction(job: SpoolJob, action: string): void {
    if (action === 'download' && job.hasFile) this.download(job);
    else if (action === 'retry' && job.canRetry) this.mutate(job, 'retry');
    else if (action === 'cancel' && job.canCancel) this.mutate(job, 'cancel');
    else if (action === 'copy-id') fpcCopyText(job.id);
  }

  formatDate(value: string | null): string {
    return formatBillingDateTime(value);
  }

  private load(page: number, pageSize: number): void {
    const view = untracked(this.activeView);

    this.loading.set(true);
    this.spooler
      .list({
        ...(view !== 'all' ? { status: view as SpoolJobStatus } : {}),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (response) => {
          this.items.set(response.items);
          this.total.set(response.total);
          this.error.set(null);
        },
        error: (error: Error) => this.error.set(error.message ?? 'Failed to load spool jobs'),
      });
  }

  private download(job: SpoolJob): void {
    this.spooler
      .downloadFile(job.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => this.saveBlob(blob, job.fileName ?? `${job.id}.pdf`),
        error: (error: Error) => this.notice.set({ tone: 'danger', message: error.message }),
      });
  }

  private mutate(job: SpoolJob, action: 'retry' | 'cancel'): void {
    (action === 'retry' ? this.spooler.retry(job.id) : this.spooler.cancel(job.id))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.notice.set({
            tone: 'success',
            message:
              action === 'retry'
                ? $localize`:@@featureAdminSpooler-retried:The job was queued again.`
                : $localize`:@@featureAdminSpooler-cancelled:The job was cancelled.`,
          });
          this.paging.reload();
        },
        error: (error: { error?: { message?: string }; message?: string }) =>
          this.notice.set({ tone: 'danger', message: error.error?.message ?? error.message ?? 'Request failed' }),
      });
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
