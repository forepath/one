import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DeploymentsFacade, type DeploymentRun } from '@forepath/agenstra/frontend/data-access-agent-console';
import { combineLatestWith, map } from 'rxjs';

@Component({
  selector: 'framework-deployment-runs-list',
  imports: [CommonModule, FormsModule],
  templateUrl: './deployment-runs-list.component.html',
  styleUrls: ['./deployment-runs-list.component.scss'],
  standalone: true,
})
export class DeploymentRunsListComponent {
  private readonly deploymentsFacade = inject(DeploymentsFacade);

  // Inputs
  clientId = input.required<string>();
  agentId = input.required<string>();
  selectedRunId = input<string | null>(null);

  // Outputs
  readonly runSelected = output<string | null>();

  // Search query
  readonly searchRunsQuery = signal<string>('');

  // State from facade
  readonly runs$ = this.deploymentsFacade.runs$;
  readonly loadingRuns$ = this.deploymentsFacade.loadingRuns$;
  readonly error$ = this.deploymentsFacade.error$;

  // Convert observables to signals
  readonly error = toSignal(this.error$, { initialValue: null });

  // Search query observable
  readonly searchRunsQuery$ = toObservable(this.searchRunsQuery);

  // Filtered runs based on search query
  readonly filteredRuns$ = this.runs$.pipe(
    combineLatestWith(this.searchRunsQuery$),
    map(([runs, searchQuery]): DeploymentRun[] => {
      if (!searchQuery) {
        return runs;
      }

      return runs.filter((run: DeploymentRun) => JSON.stringify(run).toLowerCase().includes(searchQuery.toLowerCase()));
    }),
  );

  // Convert filtered runs to signal
  readonly filteredRuns = toSignal(this.filteredRuns$, { initialValue: [] as DeploymentRun[] });

  readonly hasRuns = computed(() => (this.filteredRuns()?.length ?? 0) > 0);

  // Filter out 404 errors (not found) since empty state is handled by hasRuns check
  readonly filteredError = computed(() => {
    const error = this.error();

    if (!error) {
      return null;
    }

    // Hide 404-related errors (not found)
    const lowerError = error.toLowerCase();

    if (lowerError.includes('not found') || lowerError.includes('404') || lowerError.includes('workflow_dispatch')) {
      return null;
    }

    return error;
  });

  getRunDisplayName(runName: string | null | undefined): string {
    return runName || $localize`:@@featureDeploymentRunsList-untitledRun:Untitled Run`;
  }

  constructor() {
    // Load runs when component initializes
    effect(() => {
      const clientId = this.clientId();
      const agentId = this.agentId();

      if (clientId && agentId) {
        this.deploymentsFacade.loadRuns(clientId, agentId);
      }
    });
  }

  onRunClick(runId: string): void {
    // Toggle selection: if already selected, unselect it
    if (this.selectedRunId() === runId) {
      this.runSelected.emit(null);
    } else {
      this.runSelected.emit(runId);
    }
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

  formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  }
}
