import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

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
} from '../state/deployments/deployments.types';

@Injectable({
  providedIn: 'root',
})
export class DeploymentsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  /**
   * Get the base URL for the API.
   */
  private get apiUrl(): string {
    return this.environment.controller.restApiUrl;
  }

  /**
   * Get deployment configuration for an agent.
   * Returns null if no configuration exists (404 is treated as "no configuration").
   */
  getConfiguration(clientId: string, agentId: string): Observable<DeploymentConfiguration | null> {
    return this.http
      .get<DeploymentConfiguration | null>(
        `${this.apiUrl}/clients/${clientId}/agents/${agentId}/deployments/configuration`,
      )
      .pipe(
        catchError((error: unknown) => {
          // Treat 404 as "no configuration exists" rather than an error
          if (error instanceof HttpErrorResponse && error.status === 404) {
            return of(null);
          }

          // Re-throw other errors
          throw error;
        }),
      );
  }

  /**
   * Create or update deployment configuration for an agent.
   */
  createConfiguration(
    clientId: string,
    agentId: string,
    dto: CreateDeploymentConfigurationDto,
  ): Observable<DeploymentConfiguration> {
    return this.http.post<DeploymentConfiguration>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/deployments/configuration`,
      dto,
    );
  }

  /**
   * Update deployment configuration for an agent.
   */
  updateConfiguration(
    clientId: string,
    agentId: string,
    dto: UpdateDeploymentConfigurationDto,
  ): Observable<DeploymentConfiguration> {
    return this.http.post<DeploymentConfiguration>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/deployments/configuration`,
      dto,
    );
  }

  /**
   * Delete deployment configuration for an agent.
   */
  deleteConfiguration(clientId: string, agentId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/deployments/configuration`);
  }

  /**
   * List repositories accessible with the agent's deployment configuration.
   */
  listRepositories(clientId: string, agentId: string): Observable<Repository[]> {
    return this.http.get<Repository[]>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/deployments/repositories`);
  }

  /**
   * List branches for a repository.
   */
  listBranches(clientId: string, agentId: string, repositoryId: string): Observable<Branch[]> {
    return this.http.get<Branch[]>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/deployments/repositories/${encodeURIComponent(repositoryId)}/branches`,
    );
  }

  /**
   * List workflows for a repository.
   */
  listWorkflows(clientId: string, agentId: string, repositoryId: string, branch?: string): Observable<Workflow[]> {
    let params = new HttpParams();

    if (branch) {
      params = params.set('branch', branch);
    }

    return this.http.get<Workflow[]>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/deployments/repositories/${encodeURIComponent(repositoryId)}/workflows`,
      { params },
    );
  }

  /**
   * List deployment runs for an agent.
   */
  listRuns(clientId: string, agentId: string, limit?: number, offset?: number): Observable<DeploymentRun[]> {
    let params = new HttpParams();

    if (limit !== undefined) {
      params = params.set('limit', limit.toString());
    }

    if (offset !== undefined) {
      params = params.set('offset', offset.toString());
    }

    return this.http.get<DeploymentRun[]>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/deployments/runs`, {
      params,
    });
  }

  /**
   * Trigger a workflow run.
   */
  triggerWorkflow(clientId: string, agentId: string, dto: TriggerWorkflowDto): Observable<DeploymentRun> {
    return this.http.post<DeploymentRun>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/deployments/workflows/trigger`,
      dto,
    );
  }

  /**
   * Get the status of a pipeline run.
   */
  getRunStatus(clientId: string, agentId: string, runId: string): Observable<DeploymentRun> {
    return this.http.get<DeploymentRun>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/deployments/runs/${encodeURIComponent(runId)}`,
    );
  }

  /**
   * Get logs for a pipeline run.
   */
  getRunLogs(clientId: string, agentId: string, runId: string): Observable<{ logs: string }> {
    return this.http.get<{ logs: string }>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/deployments/runs/${encodeURIComponent(runId)}/logs`,
    );
  }

  /**
   * Cancel a running pipeline.
   */
  cancelRun(clientId: string, agentId: string, runId: string): Observable<void> {
    return this.http.post<void>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/deployments/runs/${encodeURIComponent(runId)}/cancel`,
      {},
    );
  }

  /**
   * List jobs/steps for a pipeline run.
   */
  listRunJobs(clientId: string, agentId: string, runId: string): Observable<Job[]> {
    return this.http.get<Job[]>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/deployments/runs/${encodeURIComponent(runId)}/jobs`,
    );
  }

  /**
   * Get logs for a specific job/step.
   */
  getJobLogs(clientId: string, agentId: string, runId: string, jobId: string): Observable<{ logs: string }> {
    return this.http.get<{ logs: string }>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/deployments/runs/${encodeURIComponent(runId)}/jobs/${encodeURIComponent(jobId)}/logs`,
    );
  }
}
