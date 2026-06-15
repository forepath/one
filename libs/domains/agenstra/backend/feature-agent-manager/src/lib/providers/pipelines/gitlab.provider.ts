import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

import {
  Branch,
  Job,
  PipelineProvider,
  PipelineProviderCredentials,
  PipelineRun,
  Repository,
  Workflow,
} from '../pipeline-provider.interface';

/**
 * GitLab CI/CD provider implementation.
 * Handles GitLab CI/CD pipeline operations via GitLab REST API.
 * Supports both GitLab.com and self-hosted GitLab instances.
 */
@Injectable()
export class GitLabProvider implements PipelineProvider {
  private readonly logger = new Logger(GitLabProvider.name);
  private static readonly TYPE = 'gitlab';
  private static readonly API_BASE_URL = 'https://gitlab.com/api/v4';

  /**
   * Get the unique type identifier for this provider.
   * @returns 'gitlab'
   */
  getType(): string {
    return GitLabProvider.TYPE;
  }

  /**
   * Get the human-readable display name for this provider.
   * @returns 'GitLab CI/CD'
   */
  getDisplayName(): string {
    return 'GitLab CI/CD';
  }

  /**
   * Get the base URL for GitLab API.
   * Supports self-hosted GitLab instances via credentials.baseUrl.
   * Defaults to GitLab.com if not specified.
   */
  private getApiBaseUrl(credentials: PipelineProviderCredentials): string {
    if (credentials.baseUrl) {
      // Ensure baseUrl includes /api/v4 if not already present
      const baseUrl = credentials.baseUrl.replace(/\/$/, '');

      if (baseUrl.endsWith('/api/v4')) {
        return baseUrl;
      }

      if (baseUrl.endsWith('/api')) {
        return `${baseUrl}/v4`;
      }

      return `${baseUrl}/api/v4`;
    }

    return GitLabProvider.API_BASE_URL;
  }

  /**
   * Create axios instance with authentication headers.
   */
  private createApiClient(credentials: PipelineProviderCredentials) {
    const baseURL = this.getApiBaseUrl(credentials);

    return axios.create({
      baseURL,
      headers: {
        'PRIVATE-TOKEN': credentials.token,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Encode project path for use in GitLab API URLs.
   * GitLab requires project paths to be URL-encoded.
   */
  private encodeProjectPath(projectPath: string): string {
    return encodeURIComponent(projectPath);
  }

  /**
   * List repositories (projects) accessible with the provided credentials.
   */
  async listRepositories(credentials: PipelineProviderCredentials): Promise<Repository[]> {
    try {
      const api = this.createApiClient(credentials);
      const response = await api.get<
        Array<{
          id: number;
          path: string;
          path_with_namespace: string;
          default_branch: string;
          web_url: string;
          visibility: string;
        }>
      >('/projects', {
        params: {
          per_page: 100,
          order_by: 'last_activity_at',
          sort: 'desc',
          membership: true, // Only projects the user is a member of
        },
      });

      return response.data.map((project) => ({
        id: project.path_with_namespace,
        name: project.path,
        fullName: project.path_with_namespace,
        defaultBranch: project.default_branch || 'main',
        url: project.web_url,
        private: project.visibility !== 'public',
      }));
    } catch (error) {
      this.logger.error(`Failed to list repositories: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to list repositories: ${(error as AxiosError).message}`);
    }
  }

  /**
   * List branches for a repository (project).
   */
  async listBranches(credentials: PipelineProviderCredentials, repositoryId: string): Promise<Branch[]> {
    try {
      const api = this.createApiClient(credentials);
      const encodedPath = this.encodeProjectPath(repositoryId);
      // Get project info to find default branch
      const projectResponse = await api.get<{ default_branch: string }>(`/projects/${encodedPath}`);
      const defaultBranch = projectResponse.data.default_branch || 'main';
      // Get all branches
      const branchesResponse = await api.get<Array<{ name: string; commit: { id: string } }>>(
        `/projects/${encodedPath}/repository/branches`,
        {
          params: {
            per_page: 100,
          },
        },
      );

      return branchesResponse.data.map((branch) => ({
        name: branch.name,
        sha: branch.commit.id,
        default: branch.name === defaultBranch,
      }));
    } catch (error) {
      this.logger.error(`Failed to list branches for ${repositoryId}: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to list branches: ${(error as AxiosError).message}`);
    }
  }

  /**
   * List pipelines (workflows) for a repository (project).
   * GitLab doesn't have a direct "workflows" concept like GitHub Actions.
   * Instead, we list recent pipelines and extract unique pipeline configurations.
   */
  async listWorkflows(
    credentials: PipelineProviderCredentials,
    repositoryId: string,
    branch?: string,
  ): Promise<Workflow[]> {
    try {
      const api = this.createApiClient(credentials);
      const encodedPath = this.encodeProjectPath(repositoryId);
      // Get project info to determine default branch
      const projectResponse = await api.get<{ default_branch: string }>(`/projects/${encodedPath}`);
      const targetBranch = branch || projectResponse.data.default_branch || 'main';
      // Get recent pipelines to find pipeline configurations
      const pipelinesResponse = await api.get<
        Array<{
          id: number;
          ref: string;
          status: string;
          source: string;
        }>
      >(`/projects/${encodedPath}/pipelines`, {
        params: {
          per_page: 100,
          ref: targetBranch,
        },
      });
      // GitLab doesn't have a direct "workflow" concept, so we create a synthetic workflow
      // based on the pipeline source and ref. For manual triggers, we use "manual" as the workflow.
      const workflows: Workflow[] = [];

      // Create a default workflow for the branch
      workflows.push({
        id: `pipeline-${targetBranch}`,
        name: `Pipeline for ${targetBranch}`,
        path: `.gitlab-ci.yml`,
        state: 'active',
        canTrigger: true,
      });

      // If there are manual pipelines, add a manual workflow
      const hasManual = pipelinesResponse.data.some((p) => p.source === 'manual');

      if (hasManual) {
        workflows.push({
          id: 'manual',
          name: 'Manual Pipeline',
          path: `.gitlab-ci.yml`,
          state: 'active',
          canTrigger: true,
        });
      }

      return workflows;
    } catch (error) {
      this.logger.error(`Failed to list workflows for ${repositoryId}: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to list workflows: ${(error as AxiosError).message}`);
    }
  }

  /**
   * Trigger a pipeline run.
   * GitLab supports triggering pipelines via API with variables.
   */
  async triggerWorkflow(
    credentials: PipelineProviderCredentials,
    repositoryId: string,
    workflowId: string,
    ref: string,
    inputs?: Record<string, string>,
  ): Promise<PipelineRun> {
    try {
      const api = this.createApiClient(credentials);
      const encodedPath = this.encodeProjectPath(repositoryId);
      // GitLab uses POST to create a new pipeline
      // The endpoint is POST /projects/:id/pipeline (singular, not plural)
      // Variables are optional and should be an array of {key, value} objects
      const requestBody: { ref: string; variables?: Array<{ key: string; value: string }> } = {
        ref,
      };

      if (inputs && Object.keys(inputs).length > 0) {
        requestBody.variables = Object.entries(inputs).map(([key, value]) => ({
          key,
          value,
        }));
      }

      const response = await api.post<{
        id: number;
        ref: string;
        sha: string;
        status: string;
        web_url: string;
        created_at: string;
        updated_at: string;
        started_at: string | null;
        finished_at: string | null;
      }>(`/projects/${encodedPath}/pipeline`, requestBody);

      // Wait a bit for the pipeline to be fully created
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Get the full pipeline details
      const pipelineResponse = await api.get<{
        id: number;
        ref: string;
        sha: string;
        status: string;
        web_url: string;
        created_at: string;
        updated_at: string;
        started_at: string | null;
        finished_at: string | null;
      }>(`/projects/${encodedPath}/pipelines/${response.data.id}`);

      return this.mapRunToPipelineRun(pipelineResponse.data, workflowId, repositoryId);
    } catch (error) {
      this.logger.error(`Failed to trigger pipeline: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to trigger pipeline: ${(error as AxiosError).message}`);
    }
  }

  /**
   * Get the status of a pipeline run.
   */
  async getRunStatus(
    credentials: PipelineProviderCredentials,
    repositoryId: string,
    runId: string,
  ): Promise<PipelineRun> {
    try {
      const api = this.createApiClient(credentials);
      const encodedPath = this.encodeProjectPath(repositoryId);
      const response = await api.get<{
        id: number;
        ref: string;
        sha: string;
        status: string;
        web_url: string;
        created_at: string;
        updated_at: string;
        started_at: string | null;
        finished_at: string | null;
      }>(`/projects/${encodedPath}/pipelines/${runId}`);

      // Use a default workflow ID since GitLab doesn't have workflows
      return this.mapRunToPipelineRun(response.data, 'pipeline', repositoryId);
    } catch (error) {
      this.logger.error(`Failed to get pipeline status: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to get pipeline status: ${(error as AxiosError).message}`);
    }
  }

  /**
   * Get logs for a pipeline run.
   */
  async getRunLogs(credentials: PipelineProviderCredentials, repositoryId: string, runId: string): Promise<string> {
    try {
      const api = this.createApiClient(credentials);
      const encodedPath = this.encodeProjectPath(repositoryId);
      // Get jobs for the pipeline
      const jobsResponse = await api.get<Array<{ id: number }>>(`/projects/${encodedPath}/pipelines/${runId}/jobs`);
      // Fetch logs for each job
      const logPromises = jobsResponse.data.map((job) =>
        this.getJobLogs(credentials, repositoryId, runId, job.id.toString()),
      );
      const logs = await Promise.all(logPromises);

      return logs.join('\n\n---\n\n');
    } catch (error) {
      this.logger.error(`Failed to get pipeline logs: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to get pipeline logs: ${(error as AxiosError).message}`);
    }
  }

  /**
   * List jobs for a pipeline run.
   */
  async listRunJobs(credentials: PipelineProviderCredentials, repositoryId: string, runId: string): Promise<Job[]> {
    try {
      const api = this.createApiClient(credentials);
      const encodedPath = this.encodeProjectPath(repositoryId);
      const response = await api.get<
        Array<{
          id: number;
          name: string;
          status: string;
          started_at: string | null;
          finished_at: string | null;
        }>
      >(`/projects/${encodedPath}/pipelines/${runId}/jobs`);

      return response.data.map((job) => ({
        id: job.id.toString(),
        name: job.name,
        status: this.mapStatus(job.status),
        conclusion: this.mapConclusionFromStatus(job.status),
        startedAt: job.started_at ? new Date(job.started_at) : undefined,
        completedAt: job.finished_at ? new Date(job.finished_at) : undefined,
      }));
    } catch (error) {
      this.logger.error(`Failed to list jobs: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to list jobs: ${(error as AxiosError).message}`);
    }
  }

  /**
   * Get logs for a specific job.
   */
  async getJobLogs(
    credentials: PipelineProviderCredentials,
    repositoryId: string,
    runId: string,
    jobId: string,
  ): Promise<string> {
    try {
      const api = this.createApiClient(credentials);
      const encodedPath = this.encodeProjectPath(repositoryId);
      // GitLab provides job logs via the trace endpoint
      const response = await api.get(`/projects/${encodedPath}/jobs/${jobId}/trace`, {
        responseType: 'text',
      });

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get job logs: ${(error as AxiosError).message}`);

      // Return empty string if logs are not available yet
      if ((error as AxiosError).response?.status === 404) {
        return '';
      }

      throw new BadRequestException(`Failed to get job logs: ${(error as AxiosError).message}`);
    }
  }

  /**
   * Cancel a running pipeline.
   */
  async cancelRun(credentials: PipelineProviderCredentials, repositoryId: string, runId: string): Promise<void> {
    try {
      const api = this.createApiClient(credentials);
      const encodedPath = this.encodeProjectPath(repositoryId);

      await api.post(`/projects/${encodedPath}/pipelines/${runId}/cancel`);
    } catch (error) {
      this.logger.error(`Failed to cancel pipeline: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to cancel pipeline: ${(error as AxiosError).message}`);
    }
  }

  /**
   * Map GitLab pipeline status to our PipelineRun status.
   */
  private mapStatus(status: string): string {
    const statusMap: Record<string, string> = {
      pending: 'queued',
      running: 'in_progress',
      success: 'completed',
      failed: 'failure',
      canceled: 'cancelled',
      skipped: 'skipped',
      manual: 'queued',
      scheduled: 'queued',
    };

    return statusMap[status.toLowerCase()] || status;
  }

  /**
   * Map GitLab job status to our PipelineRun conclusion.
   */
  private mapConclusionFromStatus(status: string): string | undefined {
    const statusLower = status.toLowerCase();

    if (statusLower === 'success') {
      return 'success';
    }

    if (statusLower === 'failed') {
      return 'failure';
    }

    if (statusLower === 'canceled' || statusLower === 'cancelled') {
      return 'cancelled';
    }

    if (statusLower === 'skipped') {
      return 'skipped';
    }

    // For pending, running, manual, scheduled - no conclusion yet
    return undefined;
  }

  /**
   * Map GitLab pipeline data to PipelineRun.
   */
  private mapRunToPipelineRun(
    pipeline: {
      id: number;
      ref: string;
      sha: string;
      status: string;
      web_url: string;
      created_at: string;
      updated_at: string;
      started_at: string | null;
      finished_at: string | null;
    },
    workflowId: string,
    _: string,
  ): PipelineRun {
    return {
      id: pipeline.id.toString(),
      name: `Pipeline #${pipeline.id}`,
      status: this.mapStatus(pipeline.status),
      conclusion: this.mapConclusionFromStatus(pipeline.status),
      ref: pipeline.ref,
      sha: pipeline.sha,
      createdAt: new Date(pipeline.created_at),
      updatedAt: new Date(pipeline.updated_at),
      startedAt: pipeline.started_at ? new Date(pipeline.started_at) : undefined,
      completedAt: pipeline.finished_at ? new Date(pipeline.finished_at) : undefined,
      workflowId,
      workflowName: 'GitLab CI/CD Pipeline',
      htmlUrl: pipeline.web_url,
    };
  }
}
