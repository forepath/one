import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  cancelRun,
  createDeploymentConfiguration,
  deleteDeploymentConfiguration,
  loadBranches,
  loadDeploymentConfiguration,
  loadJobLogs,
  loadRepositories,
  loadRunJobs,
  loadRunLogs,
  loadRunStatus,
  loadRuns,
  loadWorkflows,
  triggerWorkflow,
  updateDeploymentConfiguration,
} from './deployments.actions';
import {
  selectBranches,
  selectCancelingRun,
  selectCreatingConfiguration,
  selectDeletingConfiguration,
  selectDeploymentConfiguration,
  selectDeploymentsError,
  selectJobById,
  selectJobLogs,
  selectJobs,
  selectJobsByStatus,
  selectLoadingDeploymentBranches,
  selectLoadingConfiguration,
  selectLoadingJobLogs,
  selectLoadingRepositories,
  selectLoadingRunJobs,
  selectLoadingRunLogs,
  selectLoadingRunStatus,
  selectLoadingRuns,
  selectLoadingWorkflows,
  selectRepositories,
  selectRunById,
  selectRunLogs,
  selectRuns,
  selectRunsByConclusion,
  selectRunsByStatus,
  selectTriggeringWorkflow,
  selectUpdatingConfiguration,
  selectWorkflows,
} from './deployments.selectors';
import type {
  Branch,
  CreateDeploymentConfigurationDto,
  DeploymentConfiguration,
  DeploymentRun,
  Job,
  Repository,
  TriggerWorkflowDto,
  UpdateDeploymentConfigurationDto,
  Workflow,
} from './deployments.types';

/**
 * Facade for deployments state management.
 * Provides a clean API for components to interact with deployments state
 * without directly accessing the NgRx store.
 */
@Injectable({
  providedIn: 'root',
})
export class DeploymentsFacade {
  private readonly store = inject(Store);

  // State observables
  readonly configuration$: Observable<DeploymentConfiguration | null> =
    this.store.select(selectDeploymentConfiguration);
  readonly repositories$: Observable<Repository[]> = this.store.select(selectRepositories);
  readonly branches$: Observable<Branch[]> = this.store.select(selectBranches);
  readonly workflows$: Observable<Workflow[]> = this.store.select(selectWorkflows);
  readonly runs$: Observable<DeploymentRun[]> = this.store.select(selectRuns);
  readonly jobs$: Observable<Job[]> = this.store.select(selectJobs);
  readonly runLogs$: Observable<string | null> = this.store.select(selectRunLogs);
  readonly jobLogs$: Observable<string | null> = this.store.select(selectJobLogs);

  // Loading state observables
  readonly loadingConfiguration$: Observable<boolean> = this.store.select(selectLoadingConfiguration);
  readonly loadingRepositories$: Observable<boolean> = this.store.select(selectLoadingRepositories);
  readonly loadingBranches$: Observable<boolean> = this.store.select(selectLoadingDeploymentBranches);
  readonly loadingWorkflows$: Observable<boolean> = this.store.select(selectLoadingWorkflows);
  readonly loadingRuns$: Observable<boolean> = this.store.select(selectLoadingRuns);
  readonly loadingRunStatus$: Observable<boolean> = this.store.select(selectLoadingRunStatus);
  readonly loadingRunLogs$: Observable<boolean> = this.store.select(selectLoadingRunLogs);
  readonly loadingRunJobs$: Observable<boolean> = this.store.select(selectLoadingRunJobs);
  readonly loadingJobLogs$: Observable<boolean> = this.store.select(selectLoadingJobLogs);
  readonly creatingConfiguration$: Observable<boolean> = this.store.select(selectCreatingConfiguration);
  readonly updatingConfiguration$: Observable<boolean> = this.store.select(selectUpdatingConfiguration);
  readonly deletingConfiguration$: Observable<boolean> = this.store.select(selectDeletingConfiguration);
  readonly triggeringWorkflow$: Observable<boolean> = this.store.select(selectTriggeringWorkflow);
  readonly cancelingRun$: Observable<boolean> = this.store.select(selectCancelingRun);

  // Error observable
  readonly error$: Observable<string | null> = this.store.select(selectDeploymentsError);

  /**
   * Load deployment configuration for an agent.
   */
  loadConfiguration(clientId: string, agentId: string): void {
    this.store.dispatch(loadDeploymentConfiguration({ clientId, agentId }));
  }

  /**
   * Create deployment configuration for an agent.
   */
  createConfiguration(clientId: string, agentId: string, dto: CreateDeploymentConfigurationDto): void {
    this.store.dispatch(createDeploymentConfiguration({ clientId, agentId, dto }));
  }

  /**
   * Update deployment configuration for an agent.
   */
  updateConfiguration(clientId: string, agentId: string, dto: UpdateDeploymentConfigurationDto): void {
    this.store.dispatch(updateDeploymentConfiguration({ clientId, agentId, dto }));
  }

  /**
   * Delete deployment configuration for an agent.
   */
  deleteConfiguration(clientId: string, agentId: string): void {
    this.store.dispatch(deleteDeploymentConfiguration({ clientId, agentId }));
  }

  /**
   * Load repositories accessible with the agent's deployment configuration.
   */
  loadRepositories(clientId: string, agentId: string): void {
    this.store.dispatch(loadRepositories({ clientId, agentId }));
  }

  /**
   * Load branches for a repository.
   */
  loadBranches(clientId: string, agentId: string, repositoryId: string): void {
    this.store.dispatch(loadBranches({ clientId, agentId, repositoryId }));
  }

  /**
   * Load workflows for a repository.
   */
  loadWorkflows(clientId: string, agentId: string, repositoryId: string, branch?: string): void {
    this.store.dispatch(loadWorkflows({ clientId, agentId, repositoryId, branch }));
  }

  /**
   * Load deployment runs for an agent.
   */
  loadRuns(clientId: string, agentId: string, limit?: number, offset?: number): void {
    this.store.dispatch(loadRuns({ clientId, agentId, limit, offset }));
  }

  /**
   * Trigger a workflow run.
   */
  triggerWorkflow(clientId: string, agentId: string, dto: TriggerWorkflowDto): void {
    this.store.dispatch(triggerWorkflow({ clientId, agentId, dto }));
  }

  /**
   * Load the status of a pipeline run.
   */
  loadRunStatus(clientId: string, agentId: string, runId: string): void {
    this.store.dispatch(loadRunStatus({ clientId, agentId, runId }));
  }

  /**
   * Load logs for a pipeline run.
   */
  loadRunLogs(clientId: string, agentId: string, runId: string): void {
    this.store.dispatch(loadRunLogs({ clientId, agentId, runId }));
  }

  /**
   * Cancel a running pipeline.
   */
  cancelRun(clientId: string, agentId: string, runId: string): void {
    this.store.dispatch(cancelRun({ clientId, agentId, runId }));
  }

  /**
   * Load jobs/steps for a pipeline run.
   */
  loadRunJobs(clientId: string, agentId: string, runId: string): void {
    this.store.dispatch(loadRunJobs({ clientId, agentId, runId }));
  }

  /**
   * Load logs for a specific job/step.
   */
  loadJobLogs(clientId: string, agentId: string, runId: string, jobId: string): void {
    this.store.dispatch(loadJobLogs({ clientId, agentId, runId, jobId }));
  }

  /**
   * Get a specific run by ID.
   */
  getRunById$(runId: string): Observable<DeploymentRun | undefined> {
    return this.store.select(selectRunById(runId));
  }

  /**
   * Get runs filtered by status.
   */
  getRunsByStatus$(status: string): Observable<DeploymentRun[]> {
    return this.store.select(selectRunsByStatus(status));
  }

  /**
   * Get runs filtered by conclusion.
   */
  getRunsByConclusion$(conclusion: string): Observable<DeploymentRun[]> {
    return this.store.select(selectRunsByConclusion(conclusion));
  }

  /**
   * Get a specific job by ID.
   */
  getJobById$(jobId: string): Observable<Job | undefined> {
    return this.store.select(selectJobById(jobId));
  }

  /**
   * Get jobs filtered by status.
   */
  getJobsByStatus$(status: string): Observable<Job[]> {
    return this.store.select(selectJobsByStatus(status));
  }
}
