import { CommonModule } from '@angular/common';
import { Component, computed, effect, ElementRef, inject, input, signal, ViewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DeploymentsFacade } from '@forepath/agenstra/frontend/data-access-agent-console';
import { of, switchMap } from 'rxjs';

@Component({
  selector: 'framework-deployment-run-details',
  imports: [CommonModule],
  templateUrl: './deployment-run-details.component.html',
  styleUrls: ['./deployment-run-details.component.scss'],
  standalone: true,
})
export class DeploymentRunDetailsComponent {
  private readonly deploymentsFacade = inject(DeploymentsFacade);

  @ViewChild('cancelRunConfirmModal', { static: false })
  private cancelRunConfirmModal!: ElementRef<HTMLDivElement>;

  // Inputs
  clientId = input.required<string>();
  agentId = input.required<string>();
  runId = input.required<string>();

  // State from facade
  readonly currentRunStatus$ = toObservable(this.runId).pipe(
    switchMap((runId) => {
      if (!runId) {
        return of(null);
      }

      return this.deploymentsFacade.getRunById$(runId);
    }),
  );
  readonly runJobs$ = this.deploymentsFacade.jobs$;
  readonly runLogs$ = this.deploymentsFacade.runLogs$;
  readonly jobLogs$ = this.deploymentsFacade.jobLogs$;
  readonly loadingRunStatus$ = this.deploymentsFacade.loadingRunStatus$;
  readonly loadingRunJobs$ = this.deploymentsFacade.loadingRunJobs$;
  readonly loadingRunLogs$ = this.deploymentsFacade.loadingRunLogs$;
  readonly loadingJobLogs$ = this.deploymentsFacade.loadingJobLogs$;
  readonly cancellingRun$ = this.deploymentsFacade.cancelingRun$;
  readonly error$ = this.deploymentsFacade.error$;

  // Convert observables to signals
  readonly currentRunStatus = toSignal(this.currentRunStatus$, { initialValue: null });
  readonly runJobs = toSignal(this.runJobs$, { initialValue: [] });
  readonly runLogs = toSignal(this.runLogs$, { initialValue: null });
  readonly jobLogs = toSignal(this.jobLogs$, { initialValue: null });
  readonly loadingRunLogs = toSignal(this.loadingRunLogs$, { initialValue: false });
  readonly loadingJobLogs = toSignal(this.loadingJobLogs$, { initialValue: false });
  readonly loadingRunStatus = toSignal(this.loadingRunStatus$, { initialValue: false });
  readonly error = toSignal(this.error$, { initialValue: null });

  // UI state
  readonly selectedJobId = signal<string | null>(null);
  readonly showRunLogs = signal<boolean>(false);
  readonly showJobLogs = signal<boolean>(false);
  readonly hasLoadedOnce = signal<boolean>(false);

  // Track polling interval to prevent duplicates
  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  readonly selectedJob = computed(() => {
    const jobId = this.selectedJobId();

    if (!jobId) {
      return null;
    }

    return this.runJobs().find((job) => job.id === jobId) || null;
  });

  getRunDisplayName(runName: string | null | undefined): string {
    return runName || $localize`:@@featureDeploymentRunDetails-untitledRun:Untitled Run`;
  }

  constructor() {
    // Reset hasLoadedOnce and close logs when runId changes
    effect(() => {
      const runId = this.runId();

      if (runId) {
        this.hasLoadedOnce.set(false);
        // Close any open logs when run changes
        this.showRunLogs.set(false);
        this.showJobLogs.set(false);
        this.selectedJobId.set(null);

        // Clear polling interval when run changes
        if (this.pollingInterval) {
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
        }
      }
    });

    // Track when data is successfully loaded
    effect(() => {
      const runStatus = this.currentRunStatus();

      if (runStatus) {
        this.hasLoadedOnce.set(true);
      }
    });

    // Load run status and jobs when runId changes
    effect(() => {
      const runId = this.runId();
      const clientId = this.clientId();
      const agentId = this.agentId();

      if (runId && clientId && agentId) {
        this.deploymentsFacade.loadRunStatus(clientId, agentId, runId);
        this.deploymentsFacade.loadRunJobs(clientId, agentId, runId);
      }
    });

    // Poll for status updates if run is in progress
    // Use runId and status as dependencies, but only create interval if one doesn't exist
    effect(() => {
      const runStatus = this.currentRunStatus();
      const clientId = this.clientId();
      const agentId = this.agentId();
      const runId = this.runId();
      const status = runStatus?.status;

      // Clear existing interval if runId changed or status is no longer in progress
      if (this.pollingInterval) {
        const shouldPoll =
          runStatus &&
          clientId &&
          agentId &&
          runId &&
          (status === 'in_progress' || status === 'queued' || status === 'running');

        if (!shouldPoll) {
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
        }

        // If we should still poll and interval exists, don't create a new one
        return;
      }

      // Create new interval only if we should poll and no interval exists
      if (
        runStatus &&
        clientId &&
        agentId &&
        runId &&
        (status === 'in_progress' || status === 'queued' || status === 'running')
      ) {
        // Poll every 5 seconds
        this.pollingInterval = setInterval(() => {
          this.deploymentsFacade.loadRunStatus(clientId, agentId, runId);
        }, 5000);

        // Cleanup interval when effect re-runs or component is destroyed
        return () => {
          if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
          }
        };
      }

      return undefined;
    });
  }

  onLoadRunLogs(): void {
    const runId = this.runId();
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (runId && clientId && agentId) {
      this.deploymentsFacade.loadRunLogs(clientId, agentId, runId);
      this.showRunLogs.set(true);
      this.showJobLogs.set(false);
      this.selectedJobId.set(null);
    }
  }

  onLoadJobLogs(jobId: string): void {
    const runId = this.runId();
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (runId && clientId && agentId) {
      this.deploymentsFacade.loadJobLogs(clientId, agentId, runId, jobId);
      this.selectedJobId.set(jobId);
      this.showJobLogs.set(true);
      this.showRunLogs.set(false);
    }
  }

  onCloseLogs(): void {
    this.showRunLogs.set(false);
    this.showJobLogs.set(false);
    this.selectedJobId.set(null);
    // Logs will be cleared when new logs are loaded
  }

  onOpenCancelRunConfirm(): void {
    setTimeout(() => this.showCancelRunConfirmModal(), 0);
  }

  onCancelCancelRunConfirm(): void {
    this.hideCancelRunConfirmModal();
  }

  confirmCancelRun(): void {
    this.hideCancelRunConfirmModal();
    const runId = this.runId();
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (runId && clientId && agentId) {
      this.deploymentsFacade.cancelRun(clientId, agentId, runId);
    }
  }

  private showCancelRunConfirmModal(): void {
    const el = this.cancelRunConfirmModal?.nativeElement;

    if (!el) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Modal = (window as any).bootstrap?.Modal;

    if (!Modal) {
      return;
    }

    const inst = Modal.getOrCreateInstance ? Modal.getOrCreateInstance(el) : new Modal(el);

    inst.show();
  }

  private hideCancelRunConfirmModal(): void {
    const el = this.cancelRunConfirmModal?.nativeElement;

    if (!el) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modal = (window as any).bootstrap?.Modal?.getInstance(el);

    modal?.hide();
  }

  getStatusBadgeClass(status: string): string {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'success':
        return 'bg-success';
      case 'in_progress':
      case 'running':
      case 'queued':
        return 'bg-primary';
      case 'failed':
      case 'failure':
      case 'cancelled':
        return 'bg-danger';
      default:
        return 'bg-secondary';
    }
  }

  getStatusIcon(status: string): string {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'success':
        return 'bi-check-circle';
      case 'in_progress':
      case 'running':
        return 'bi-arrow-repeat';
      case 'queued':
        return 'bi-clock';
      case 'failed':
      case 'failure':
        return 'bi-x-circle';
      case 'cancelled':
        return 'bi-stop-circle';
      default:
        return 'bi-question-circle';
    }
  }

  getJobStatusBadgeClass(status: string): string {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'success':
        return 'bg-success';
      case 'in_progress':
      case 'running':
        return 'bg-primary';
      case 'failed':
      case 'failure':
        return 'bg-danger';
      case 'cancelled':
        return 'bg-warning';
      default:
        return 'bg-secondary';
    }
  }

  formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(d);
  }

  canCancelRun(): boolean {
    const status = this.currentRunStatus();

    if (!status) {
      return false;
    }

    const statusLower = status.status.toLowerCase();

    return statusLower === 'in_progress' || statusLower === 'running' || statusLower === 'queued';
  }

  getLogsHeader(): string {
    return this.showRunLogs()
      ? $localize`:@@featureDeploymentRunDetails-runLogsHeader:Run Logs`
      : $localize`:@@featureDeploymentRunDetails-jobLogsHeader:Job Logs`;
  }
}
