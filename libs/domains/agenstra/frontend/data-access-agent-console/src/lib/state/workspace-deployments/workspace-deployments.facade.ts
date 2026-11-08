import { Injectable, inject } from '@angular/core';
import type {
  DeploymentConnectionOption,
  DeploymentRunDetail,
  DeploymentRunLogs,
  DeploymentRunSummary,
  DeploymentWorkflowSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  approveDeploymentWorkflow,
  cancelDeploymentRun,
  clearDeploymentRunLogs,
  clearLastTriggeredDeploymentRun,
  clearSelectedDeploymentRun,
  clearSelectedDeploymentWorkflow,
  clearWorkspaceDeploymentsError,
  createDeploymentWorkflow,
  deleteDeploymentWorkflow,
  loadDeploymentConnectionOptions,
  loadDeploymentRun,
  loadDeploymentRunLogs,
  loadDeploymentRuns,
  loadDeploymentWorkflow,
  loadDeploymentWorkflows,
  syncDeploymentWorkflow,
  triggerDeploymentWorkflow,
  updateDeploymentWorkflow,
} from './workspace-deployments.actions';
import {
  selectApprovingDeploymentWorkflowIds,
  selectCancellingDeploymentRunIds,
  selectDeploymentConnectionOptions,
  selectDeploymentConnectionOptionsLoading,
  selectDeploymentRunLogs,
  selectDeploymentRunLogsError,
  selectDeploymentRunLogsLoading,
  selectDeploymentRunLogsTarget,
  selectDeploymentRuns,
  selectDeploymentRunsLoading,
  selectDeploymentRunsTotal,
  selectDeploymentWorkflows,
  selectDeploymentWorkflowsHasNext,
  selectDeploymentWorkflowsLoading,
  selectLastTriggeredDeploymentRun,
  selectSelectedDeploymentRun,
  selectSelectedDeploymentRunLoading,
  selectSelectedDeploymentWorkflow,
  selectSelectedDeploymentWorkflowLoading,
  selectSyncingDeploymentWorkflowIds,
  selectWorkspaceDeploymentsError,
  selectWorkspaceDeploymentsSaving,
  selectWorkspaceDeploymentsTriggering,
} from './workspace-deployments.selectors';
import type {
  CreateDeploymentWorkflowDto,
  DeploymentLogsTarget,
  DeploymentRunsQuery,
  DeploymentWorkflowsQuery,
  TriggerDeploymentWorkflowDto,
  UpdateDeploymentWorkflowDto,
} from './workspace-deployments.types';

/** Deployment workflows / runs of a workspace (`/deployments/:clientId` page); live updates via the clients socket. */
@Injectable({
  providedIn: 'root',
})
export class WorkspaceDeploymentsFacade {
  private readonly store = inject(Store);

  readonly workflows$: Observable<DeploymentWorkflowSummary[]> = this.store.select(selectDeploymentWorkflows);
  readonly workflowsHasNext$: Observable<boolean> = this.store.select(selectDeploymentWorkflowsHasNext);
  readonly workflowsLoading$: Observable<boolean> = this.store.select(selectDeploymentWorkflowsLoading);
  readonly selectedWorkflow$: Observable<DeploymentWorkflowSummary | null> = this.store.select(
    selectSelectedDeploymentWorkflow,
  );
  readonly selectedWorkflowLoading$: Observable<boolean> = this.store.select(selectSelectedDeploymentWorkflowLoading);
  readonly runs$: Observable<DeploymentRunSummary[]> = this.store.select(selectDeploymentRuns);
  readonly runsTotal$: Observable<number> = this.store.select(selectDeploymentRunsTotal);
  readonly runsLoading$: Observable<boolean> = this.store.select(selectDeploymentRunsLoading);
  readonly selectedRun$: Observable<DeploymentRunDetail | null> = this.store.select(selectSelectedDeploymentRun);
  readonly selectedRunLoading$: Observable<boolean> = this.store.select(selectSelectedDeploymentRunLoading);
  readonly logs$: Observable<DeploymentRunLogs | null> = this.store.select(selectDeploymentRunLogs);
  readonly logsTarget$: Observable<DeploymentLogsTarget | null> = this.store.select(selectDeploymentRunLogsTarget);
  readonly logsLoading$: Observable<boolean> = this.store.select(selectDeploymentRunLogsLoading);
  readonly logsError$: Observable<string | null> = this.store.select(selectDeploymentRunLogsError);
  readonly connectionOptions$: Observable<DeploymentConnectionOption[]> = this.store.select(
    selectDeploymentConnectionOptions,
  );
  readonly connectionOptionsLoading$: Observable<boolean> = this.store.select(selectDeploymentConnectionOptionsLoading);
  readonly saving$: Observable<boolean> = this.store.select(selectWorkspaceDeploymentsSaving);
  readonly triggering$: Observable<boolean> = this.store.select(selectWorkspaceDeploymentsTriggering);
  readonly lastTriggeredRun$: Observable<DeploymentRunSummary | null> = this.store.select(
    selectLastTriggeredDeploymentRun,
  );
  readonly syncingWorkflowIds$: Observable<string[]> = this.store.select(selectSyncingDeploymentWorkflowIds);
  readonly approvingWorkflowIds$: Observable<string[]> = this.store.select(selectApprovingDeploymentWorkflowIds);
  readonly cancellingRunIds$: Observable<string[]> = this.store.select(selectCancellingDeploymentRunIds);
  readonly error$: Observable<string | null> = this.store.select(selectWorkspaceDeploymentsError);

  loadWorkflows(clientId: string, query: DeploymentWorkflowsQuery = {}): void {
    this.store.dispatch(loadDeploymentWorkflows({ clientId, query }));
  }

  openWorkflow(clientId: string, workflowId: string): void {
    this.store.dispatch(loadDeploymentWorkflow({ clientId, workflowId }));
  }

  closeWorkflow(): void {
    this.store.dispatch(clearSelectedDeploymentWorkflow());
  }

  createWorkflow(clientId: string, dto: CreateDeploymentWorkflowDto): void {
    this.store.dispatch(createDeploymentWorkflow({ clientId, dto }));
  }

  updateWorkflow(clientId: string, workflowId: string, dto: UpdateDeploymentWorkflowDto): void {
    this.store.dispatch(updateDeploymentWorkflow({ clientId, workflowId, dto }));
  }

  deleteWorkflow(clientId: string, workflowId: string): void {
    this.store.dispatch(deleteDeploymentWorkflow({ clientId, workflowId }));
  }

  /**
   * Approves a workflow an environment proposed or changed (workspace admins). `updatedAt` is the reviewed version:
   * the controller refuses (409) when the workflow changed since, and the page reloads it.
   */
  approveWorkflow(clientId: string, workflowId: string, updatedAt: string): void {
    this.store.dispatch(approveDeploymentWorkflow({ clientId, workflowId, updatedAt }));
  }

  trigger(clientId: string, workflowId: string, dto: TriggerDeploymentWorkflowDto): void {
    this.store.dispatch(triggerDeploymentWorkflow({ clientId, workflowId, dto }));
  }

  clearLastTriggeredRun(): void {
    this.store.dispatch(clearLastTriggeredDeploymentRun());
  }

  sync(clientId: string, workflowId: string): void {
    this.store.dispatch(syncDeploymentWorkflow({ clientId, workflowId }));
  }

  loadRuns(clientId: string, query: DeploymentRunsQuery = {}): void {
    this.store.dispatch(loadDeploymentRuns({ clientId, query }));
  }

  /** `refresh` reloads the opened run (jobs) without hiding the shown detail. */
  openRun(clientId: string, runId: string, options: { refresh?: boolean } = {}): void {
    this.store.dispatch(loadDeploymentRun({ clientId, runId, ...(options.refresh ? { refresh: true } : {}) }));
  }

  closeRun(): void {
    this.store.dispatch(clearSelectedDeploymentRun());
  }

  loadLogs(clientId: string, runId: string, jobId: string | null = null): void {
    this.store.dispatch(loadDeploymentRunLogs({ clientId, runId, jobId }));
  }

  clearLogs(): void {
    this.store.dispatch(clearDeploymentRunLogs());
  }

  cancelRun(clientId: string, runId: string): void {
    this.store.dispatch(cancelDeploymentRun({ clientId, runId }));
  }

  loadConnectionOptions(clientId: string): void {
    this.store.dispatch(loadDeploymentConnectionOptions({ clientId }));
  }

  clearError(): void {
    this.store.dispatch(clearWorkspaceDeploymentsError());
  }
}
