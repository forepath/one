import { CommonModule, Location } from '@angular/common';
import { AfterViewInit, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  DeploymentsFacade,
  triggerWorkflowSuccess,
  type DeploymentConfiguration,
  type DeploymentRun,
  type Workflow,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { LocaleService } from '@forepath/shared/frontend/util-configuration';
import { Actions, ofType } from '@ngrx/effects';
import { combineLatest, map, Observable, take } from 'rxjs';

import { DeploymentConfigurationComponent } from './deployment-configuration/deployment-configuration.component';
import { DeploymentRunDetailsComponent } from './deployment-run-details/deployment-run-details.component';
import { DeploymentRunsListComponent } from './deployment-runs-list/deployment-runs-list.component';

@Component({
  selector: 'framework-deployment-manager',
  imports: [CommonModule, DeploymentConfigurationComponent, DeploymentRunsListComponent, DeploymentRunDetailsComponent],
  templateUrl: './deployment-manager.component.html',
  styleUrls: ['./deployment-manager.component.scss'],
  standalone: true,
})
export class DeploymentManagerComponent implements AfterViewInit {
  private readonly deploymentsFacade = inject(DeploymentsFacade);
  private readonly location = inject(Location);
  private readonly localeService = inject(LocaleService);
  private readonly actions$ = inject(Actions);

  // Inputs
  clientId = input.required<string>();
  agentId = input.required<string>();

  // Internal state
  selectedRunId = signal<string | null>(null);
  selectedRepositoryId = signal<string | null>(null);
  selectedBranch = signal<string | null>(null);
  selectedWorkflowId = signal<string | null>(null);
  private isInitializing = true;

  // Visibility toggles
  readonly configurationVisible = signal<boolean>(true);
  readonly runsListVisible = signal<boolean>(true);
  readonly runDetailsVisible = signal<boolean>(false);

  // Outputs
  readonly closeRequested = output<void>();

  // Convert signals to observables
  private readonly clientId$ = toObservable(this.clientId);
  private readonly agentId$ = toObservable(this.agentId);
  private readonly selectedRunId$ = toObservable(this.selectedRunId);

  // State observables from facade
  readonly configuration$ = this.deploymentsFacade.configuration$;
  readonly repositories$ = this.deploymentsFacade.repositories$;
  readonly branches$ = this.deploymentsFacade.branches$;
  readonly workflows$ = this.deploymentsFacade.workflows$;
  readonly runs$ = this.deploymentsFacade.runs$;
  readonly loadingConfiguration$ = this.deploymentsFacade.loadingConfiguration$;
  readonly loadingRepositories$ = this.deploymentsFacade.loadingRepositories$;
  readonly loadingBranches$ = this.deploymentsFacade.loadingBranches$;
  readonly loadingWorkflows$ = this.deploymentsFacade.loadingWorkflows$;
  readonly loadingRuns$ = this.deploymentsFacade.loadingRuns$;
  readonly triggeringWorkflow$ = this.deploymentsFacade.triggeringWorkflow$;
  readonly error$ = this.deploymentsFacade.error$;

  // Computed observables
  readonly selectedRun$: Observable<DeploymentRun | undefined> = combineLatest([this.selectedRunId$, this.runs$]).pipe(
    map(([runId, runs]) => {
      if (!runId) {
        return undefined;
      }

      return runs.find((run) => run.id === runId);
    }),
  );

  readonly selectedRunSignal = toSignal(this.selectedRun$, { initialValue: undefined });

  // Convert observables to signals (outside reactive context)
  readonly configurationSignal = toSignal(this.configuration$, { initialValue: null });
  readonly runsSignal = toSignal(this.runs$, { initialValue: [] });
  readonly loadingRunsSignal = toSignal(this.loadingRuns$, { initialValue: false });

  readonly hasConfiguration = computed(() => {
    const config = this.configurationSignal();

    return config !== null;
  });

  constructor() {
    // Load configuration when component initializes
    effect(() => {
      const clientId = this.clientId();
      const agentId = this.agentId();

      if (clientId && agentId) {
        this.deploymentsFacade.loadConfiguration(clientId, agentId);
      }
    });

    // Load repositories when configuration is available
    effect(() => {
      const config = this.configurationSignal();
      const clientId = this.clientId();
      const agentId = this.agentId();

      if (config && clientId && agentId) {
        this.deploymentsFacade.loadRepositories(clientId, agentId);
      }
    });

    // Load runs when configuration is available
    effect(() => {
      const config = this.configurationSignal();
      const clientId = this.clientId();
      const agentId = this.agentId();

      if (config && clientId && agentId) {
        this.deploymentsFacade.loadRuns(clientId, agentId);
      }
    });

    // Restore run from query parameter once runs are loaded
    effect(() => {
      const runs = this.runsSignal();
      const loadingRuns = this.loadingRunsSignal();
      const clientId = this.clientId();
      const agentId = this.agentId();

      // Only restore if:
      // 1. We're still initializing
      // 2. Runs are loaded (not loading)
      // 3. No run is currently selected
      // 4. We have client and agent IDs
      if (this.isInitializing && !loadingRuns && clientId && agentId && !this.selectedRunId()) {
        const url = new URL(window.location.href);
        const runParam = url.searchParams.get('run');

        if (runParam) {
          try {
            const decodedRunId = decodeURIComponent(runParam);
            // Check if the run exists in the loaded runs
            const runExists = runs.some((run) => run.id === decodedRunId);

            if (runExists || runs.length > 0) {
              // Run exists in list, or runs are loaded (even if empty, try to select it)
              // The run might be loaded separately via loadRunStatus
              this.onRunSelected(decodedRunId);
              // Mark initialization as complete after a short delay to allow the selection to process
              setTimeout(() => {
                this.isInitializing = false;
              }, 100);
            }
            // If runs are still loading, wait for them
          } catch (error) {
            console.warn('Failed to decode run ID from query parameter:', error);
            this.isInitializing = false;
          }
        } else {
          // No run parameter, initialization complete
          this.isInitializing = false;
        }
      } else if (this.isInitializing && !loadingRuns && runs.length === 0 && clientId && agentId) {
        // Runs loaded but empty, check if we should still try to restore
        const url = new URL(window.location.href);
        const runParam = url.searchParams.get('run');

        if (runParam) {
          try {
            const decodedRunId = decodeURIComponent(runParam);

            // Even if runs list is empty, try to select the run (it might be loaded separately)
            this.onRunSelected(decodedRunId);
            setTimeout(() => {
              this.isInitializing = false;
            }, 100);
          } catch (error) {
            console.warn('Failed to decode run ID from query parameter:', error);
            this.isInitializing = false;
          }
        } else {
          this.isInitializing = false;
        }
      }
    });

    // Update query parameter when selected run changes (but not during initialization)
    effect(() => {
      const runId = this.selectedRunId();
      const clientId = this.clientId();
      const agentId = this.agentId();

      // Skip updating query parameter during initialization to avoid removing it before restoration
      if (this.isInitializing) {
        return;
      }

      // Update query parameter based on selected run
      if (runId && clientId && agentId) {
        this.updateQueryParameter('run', runId);
      } else {
        // Only remove query parameter if we're not initializing
        this.updateQueryParameter('run', null);
      }
    });
  }

  ngAfterViewInit(): void {
    // Mark initialization as complete after a short delay if not already done
    // This ensures the query parameter effect can start working
    setTimeout(() => {
      if (this.isInitializing) {
        this.isInitializing = false;
      }
    }, 1000);
  }

  onConfigurationSaved(config: DeploymentConfiguration): void {
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (clientId && agentId) {
      // Reload configuration, repositories, and runs after configuration is saved
      this.deploymentsFacade.loadConfiguration(clientId, agentId);
      this.deploymentsFacade.loadRepositories(clientId, agentId);
      this.deploymentsFacade.loadRuns(clientId, agentId);

      // Update selections based on the saved configuration
      if (config.repositoryId) {
        this.selectedRepositoryId.set(config.repositoryId);
      }

      if (config.defaultBranch) {
        this.selectedBranch.set(config.defaultBranch);
      }

      if (config.workflowId) {
        this.selectedWorkflowId.set(config.workflowId);
      }
    }
  }

  onConfigurationDeleted(): void {
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (clientId && agentId) {
      // Clear selections
      this.selectedRepositoryId.set(null);
      this.selectedBranch.set(null);
      this.selectedWorkflowId.set(null);
      this.selectedRunId.set(null);
    }
  }

  onRepositorySelected(repositoryId: string): void {
    this.selectedRepositoryId.set(repositoryId);
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (clientId && agentId) {
      this.deploymentsFacade.loadBranches(clientId, agentId, repositoryId);
      this.deploymentsFacade.loadWorkflows(clientId, agentId, repositoryId);
    }
  }

  onBranchSelected(branch: string): void {
    this.selectedBranch.set(branch);
    const repositoryId = this.selectedRepositoryId();
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (repositoryId && clientId && agentId) {
      this.deploymentsFacade.loadWorkflows(clientId, agentId, repositoryId, branch);
    }
  }

  onWorkflowSelected(workflowId: string): void {
    this.selectedWorkflowId.set(workflowId);
  }

  onRunSelected(runId: string | null): void {
    // Mark initialization as complete when run is manually selected (before setting runId)
    // This ensures the query parameter effect will run
    if (this.isInitializing) {
      this.isInitializing = false;
    }

    if (!runId) {
      // Unselect run
      this.selectedRunId.set(null);
      this.runDetailsVisible.set(false);

      // Query parameter will be updated by the effect
      return;
    }

    this.selectedRunId.set(runId);
    this.runDetailsVisible.set(true);
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (clientId && agentId) {
      this.deploymentsFacade.loadRunStatus(clientId, agentId, runId);
      this.deploymentsFacade.loadRunJobs(clientId, agentId, runId);
    }
    // Query parameter will be updated by the effect
  }

  onCloseRunDetails(): void {
    // Mark initialization as complete when run is manually closed
    if (this.isInitializing) {
      this.isInitializing = false;
    }

    this.selectedRunId.set(null);
    this.runDetailsVisible.set(false);
    // Query parameter will be updated by the effect
  }

  onTriggerWorkflow(workflow: Workflow, branch: string, inputs?: Record<string, string>): void {
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (clientId && agentId) {
      this.deploymentsFacade.triggerWorkflow(clientId, agentId, {
        workflowId: workflow.id,
        ref: branch,
        inputs,
      });
      // Only reload runs on success, not on failure (to preserve error messages)
      this.actions$.pipe(ofType(triggerWorkflowSuccess), take(1)).subscribe(() => {
        setTimeout(() => {
          this.deploymentsFacade.loadRuns(clientId, agentId);
        }, 2000);
      });
    }
  }

  onRefreshRuns(): void {
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (clientId && agentId) {
      this.deploymentsFacade.loadRuns(clientId, agentId);
    }
  }

  onClose(): void {
    this.closeRequested.emit();
  }

  /**
   * Update the query parameter silently (without triggering navigation)
   */
  private updateQueryParameter(key: string, value: string | null): void {
    try {
      const url = new URL(window.location.href);
      const currentValue = url.searchParams.get(key);

      if (value) {
        const encodedValue = encodeURIComponent(value);

        // Only update if the value has changed
        if (currentValue !== encodedValue) {
          url.searchParams.set(key, encodedValue);
          this.replaceStateWithoutDuplicateLocale(url.pathname, url.search, url.hash);
        }
      } else {
        // Only remove if it exists
        if (currentValue !== null) {
          url.searchParams.delete(key);
          this.replaceStateWithoutDuplicateLocale(url.pathname, url.search, url.hash);
        }
      }
    } catch (error) {
      console.warn('Failed to update query parameter:', error);
    }
  }

  private replaceStateWithoutDuplicateLocale(pathname: string, search: string, hash: string): void {
    const availableLocales = this.localeService.getAvailableLocales().map((loc) => loc.code);
    const pathSegments = pathname.split('/').filter(Boolean);
    const firstSegment = pathSegments[0] ?? '';
    const pathnameWithoutLocale =
      availableLocales.includes(firstSegment) && pathSegments.length > 1
        ? '/' + pathSegments.slice(1).join('/')
        : pathname;

    this.location.replaceState(pathnameWithoutLocale + search + hash);
  }
}
