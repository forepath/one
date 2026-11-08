import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/agenstra/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';
import type {
  DeploymentBranchSummary,
  DeploymentConnectionOption,
  DeploymentProviderWorkflowSummary,
  DeploymentRepositorySummary,
  DeploymentRunDetail,
  DeploymentRunLogs,
  DeploymentRunSummary,
  DeploymentWorkflowSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Observable } from 'rxjs';

import type {
  CreateDeploymentWorkflowDto,
  DeploymentRunListResponseDto,
  DeploymentRunsQuery,
  DeploymentWorkflowsQuery,
  DeploymentWorkflowSyncResponseDto,
  TriggerDeploymentWorkflowDto,
  UpdateDeploymentWorkflowDto,
} from '../state/workspace-deployments/workspace-deployments.types';

function withParams(entries: Record<string, string | number | null | undefined>): HttpParams {
  let params = new HttpParams();

  for (const [key, value] of Object.entries(entries)) {
    if (value === null || value === undefined) {
      continue;
    }

    const text = String(value).trim();

    if (text) {
      params = params.set(key, text);
    }
  }

  return params;
}

/**
 * Deployment workflows and runs of a workspace (agent-controller `/clients/:clientId/deployments`). Reads, trigger,
 * cancel and sync are open to every workspace member; workflow management and connection browsing (connections,
 * repositories, branches, provider workflows) need workspace management rights.
 */
@Injectable({
  providedIn: 'root',
})
export class WorkspaceDeploymentsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private baseUrl(clientId: string): string {
    return `${this.environment.console.urls.restApi}/clients/${clientId}/deployments`;
  }

  // --- connection browsing (workspace admins) ----------------------------------------------------------------

  listConnections(clientId: string): Observable<DeploymentConnectionOption[]> {
    return this.http.get<DeploymentConnectionOption[]>(`${this.baseUrl(clientId)}/connections`);
  }

  listRepositories(clientId: string, connectionId: string, search?: string): Observable<DeploymentRepositorySummary[]> {
    return this.http.get<DeploymentRepositorySummary[]>(
      `${this.baseUrl(clientId)}/connections/${connectionId}/repositories`,
      { params: withParams({ search }) },
    );
  }

  listBranches(clientId: string, connectionId: string, repository: string): Observable<DeploymentBranchSummary[]> {
    return this.http.get<DeploymentBranchSummary[]>(`${this.baseUrl(clientId)}/connections/${connectionId}/branches`, {
      params: withParams({ repository }),
    });
  }

  listProviderWorkflows(
    clientId: string,
    connectionId: string,
    repository: string,
  ): Observable<DeploymentProviderWorkflowSummary[]> {
    return this.http.get<DeploymentProviderWorkflowSummary[]>(
      `${this.baseUrl(clientId)}/connections/${connectionId}/workflows`,
      { params: withParams({ repository }) },
    );
  }

  // --- workflows -----------------------------------------------------------------------------------------------

  listWorkflows(clientId: string, query: DeploymentWorkflowsQuery = {}): Observable<DeploymentWorkflowSummary[]> {
    return this.http.get<DeploymentWorkflowSummary[]>(`${this.baseUrl(clientId)}/workflows`, {
      params: withParams({
        agentId: query.agentId,
        approvalStatus: query.approvalStatus,
        search: query.search,
        limit: query.limit,
        offset: query.offset || null,
      }),
    });
  }

  getWorkflow(clientId: string, workflowId: string): Observable<DeploymentWorkflowSummary> {
    return this.http.get<DeploymentWorkflowSummary>(`${this.baseUrl(clientId)}/workflows/${workflowId}`);
  }

  createWorkflow(clientId: string, dto: CreateDeploymentWorkflowDto): Observable<DeploymentWorkflowSummary> {
    return this.http.post<DeploymentWorkflowSummary>(`${this.baseUrl(clientId)}/workflows`, dto);
  }

  updateWorkflow(
    clientId: string,
    workflowId: string,
    dto: UpdateDeploymentWorkflowDto,
  ): Observable<DeploymentWorkflowSummary> {
    return this.http.put<DeploymentWorkflowSummary>(`${this.baseUrl(clientId)}/workflows/${workflowId}`, dto);
  }

  /** Deletes the workflow and its run history. */
  deleteWorkflow(clientId: string, workflowId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl(clientId)}/workflows/${workflowId}`);
  }

  /**
   * Approves a workflow an environment proposed or changed (workspace admins). `updatedAt` is the version the admin
   * reviewed: 409 when the workflow changed since.
   */
  approveWorkflow(clientId: string, workflowId: string, updatedAt: string): Observable<DeploymentWorkflowSummary> {
    return this.http.post<DeploymentWorkflowSummary>(`${this.baseUrl(clientId)}/workflows/${workflowId}/approval`, {
      updatedAt,
    });
  }

  /** 409 when the workflow is disabled or waits for approval. */
  triggerWorkflow(
    clientId: string,
    workflowId: string,
    dto: TriggerDeploymentWorkflowDto,
  ): Observable<DeploymentRunSummary> {
    return this.http.post<DeploymentRunSummary>(`${this.baseUrl(clientId)}/workflows/${workflowId}/trigger`, dto);
  }

  /** Imports recent provider runs (`external`) and refreshes active ones. */
  syncWorkflow(clientId: string, workflowId: string): Observable<DeploymentWorkflowSyncResponseDto> {
    return this.http.post<DeploymentWorkflowSyncResponseDto>(
      `${this.baseUrl(clientId)}/workflows/${workflowId}/sync`,
      {},
    );
  }

  // --- runs ----------------------------------------------------------------------------------------------------

  /** Newest first. */
  listRuns(
    clientId: string,
    query: DeploymentRunsQuery = {},
  ): Observable<DeploymentRunListResponseDto<DeploymentRunSummary>> {
    return this.http.get<DeploymentRunListResponseDto<DeploymentRunSummary>>(`${this.baseUrl(clientId)}/runs`, {
      params: withParams({
        workflowId: query.workflowId,
        agentId: query.agentId,
        status: query.status,
        search: query.search,
        limit: query.limit,
        offset: query.offset || null,
      }),
    });
  }

  /** Active runs are refreshed from the provider first. */
  getRun(clientId: string, runId: string): Observable<DeploymentRunDetail> {
    return this.http.get<DeploymentRunDetail>(`${this.baseUrl(clientId)}/runs/${runId}`);
  }

  /** Tail of the run (or one job) logs, capped by the controller. */
  getRunLogs(clientId: string, runId: string, jobId?: string | null): Observable<DeploymentRunLogs> {
    return this.http.get<DeploymentRunLogs>(`${this.baseUrl(clientId)}/runs/${runId}/logs`, {
      params: withParams({ jobId }),
    });
  }

  cancelRun(clientId: string, runId: string): Observable<DeploymentRunSummary> {
    return this.http.post<DeploymentRunSummary>(`${this.baseUrl(clientId)}/runs/${runId}/cancel`, {});
  }
}
