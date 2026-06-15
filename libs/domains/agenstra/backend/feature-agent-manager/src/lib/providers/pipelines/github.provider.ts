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
 * GitHub Actions provider implementation.
 * Handles GitHub Actions workflow operations via GitHub REST API.
 */
@Injectable()
export class GitHubProvider implements PipelineProvider {
  private readonly logger = new Logger(GitHubProvider.name);
  private static readonly TYPE = 'github';
  private static readonly API_BASE_URL = 'https://api.github.com';

  /**
   * Get the unique type identifier for this provider.
   * @returns 'github'
   */
  getType(): string {
    return GitHubProvider.TYPE;
  }

  /**
   * Get the human-readable display name for this provider.
   * @returns 'GitHub Actions'
   */
  getDisplayName(): string {
    return 'GitHub Actions';
  }

  /**
   * Get the base URL for GitHub API.
   * Supports GitHub Enterprise Server via credentials.baseUrl.
   */
  private getApiBaseUrl(credentials: PipelineProviderCredentials): string {
    return credentials.baseUrl || GitHubProvider.API_BASE_URL;
  }

  /**
   * Create axios instance with authentication headers.
   */
  private createApiClient(credentials: PipelineProviderCredentials) {
    const baseURL = this.getApiBaseUrl(credentials);

    return axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  }

  /**
   * List repositories accessible with the provided credentials.
   */
  async listRepositories(credentials: PipelineProviderCredentials): Promise<Repository[]> {
    try {
      const api = this.createApiClient(credentials);
      const response = await api.get<
        Array<{ full_name: string; name: string; default_branch: string; html_url: string; private: boolean }>
      >('/user/repos', {
        params: {
          per_page: 100,
          sort: 'updated',
          type: 'all',
        },
      });

      return response.data.map((repo) => ({
        id: repo.full_name,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
        url: repo.html_url,
        private: repo.private,
      }));
    } catch (error) {
      this.logger.error(`Failed to list repositories: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to list repositories: ${(error as AxiosError).message}`);
    }
  }

  /**
   * List branches for a repository.
   */
  async listBranches(credentials: PipelineProviderCredentials, repositoryId: string): Promise<Branch[]> {
    try {
      const api = this.createApiClient(credentials);
      const [owner, repo] = repositoryId.split('/');

      if (!owner || !repo) {
        throw new BadRequestException(`Invalid repository ID format: ${repositoryId}. Expected format: owner/repo`);
      }

      // Get default branch first
      const repoResponse = await api.get<{ default_branch: string }>(`/repos/${owner}/${repo}`);
      const defaultBranch = repoResponse.data.default_branch;
      // Get all branches
      const branchesResponse = await api.get<Array<{ name: string; commit: { sha: string } }>>(
        `/repos/${owner}/${repo}/branches`,
        {
          params: {
            per_page: 100,
          },
        },
      );

      return branchesResponse.data.map((branch) => ({
        name: branch.name,
        sha: branch.commit.sha,
        default: branch.name === defaultBranch,
      }));
    } catch (error) {
      this.logger.error(`Failed to list branches for ${repositoryId}: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to list branches: ${(error as AxiosError).message}`);
    }
  }

  /**
   * List workflows for a repository.
   */
  async listWorkflows(
    credentials: PipelineProviderCredentials,
    repositoryId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _branch?: string,
  ): Promise<Workflow[]> {
    try {
      const api = this.createApiClient(credentials);
      const [owner, repo] = repositoryId.split('/');

      if (!owner || !repo) {
        throw new BadRequestException(`Invalid repository ID format: ${repositoryId}. Expected format: owner/repo`);
      }

      const response = await api.get<{ workflows: Array<{ id: number; name: string; path: string; state: string }> }>(
        `/repos/${owner}/${repo}/actions/workflows`,
      );

      return response.data.workflows.map((workflow) => ({
        id: workflow.id.toString(),
        name: workflow.name,
        path: workflow.path,
        state: workflow.state,
        canTrigger: workflow.state === 'active',
      }));
    } catch (error) {
      this.logger.error(`Failed to list workflows for ${repositoryId}: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to list workflows: ${(error as AxiosError).message}`);
    }
  }

  /**
   * Trigger a workflow run.
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
      const [owner, repo] = repositoryId.split('/');

      if (!owner || !repo) {
        throw new BadRequestException(`Invalid repository ID format: ${repositoryId}. Expected format: owner/repo`);
      }

      // Verify the branch exists before attempting to trigger the workflow
      try {
        await api.get(`/repos/${owner}/${repo}/git/ref/heads/${ref}`);
      } catch (branchError) {
        const branchAxiosError = branchError as AxiosError;

        if (branchAxiosError.response?.status === 404) {
          throw new BadRequestException(`Branch '${ref}' does not exist in the repository`);
        }
        // If it's not a 404, continue - the branch check might have failed for other reasons
      }

      // GitHub returns 204 No Content on success, so we don't need the response
      await api.post(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
        ref,
        inputs: inputs || {},
      });

      // GitHub doesn't return the run immediately, so we need to fetch it
      // Wait a bit and then fetch the latest run
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Get workflow name first
      const workflowResponse = await api.get<{ name: string }>(
        `/repos/${owner}/${repo}/actions/workflows/${workflowId}`,
      );
      const workflowName = workflowResponse.data?.name || 'Unknown Workflow';
      const runsResponse = await api.get<{
        workflow_runs: Array<{
          id: number;
          name: string;
          status: string;
          conclusion: string | null;
          head_branch: string;
          head_sha: string;
          created_at: string;
          updated_at: string;
          run_started_at: string | null;
          workflow_id: number;
          html_url: string;
        }>;
      }>(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs`, {
        params: {
          per_page: 1,
        },
      });

      if (!runsResponse.data?.workflow_runs || runsResponse.data.workflow_runs.length === 0) {
        throw new BadRequestException('Failed to retrieve triggered workflow run');
      }

      const run = runsResponse.data.workflow_runs[0];

      return this.mapRunToPipelineRun(run, workflowId, workflowName, repositoryId);
    } catch (error) {
      // If it's already a BadRequestException (e.g., from branch validation), re-throw it
      if (error instanceof BadRequestException) {
        throw error;
      }

      const axiosError = error as AxiosError;
      let detailedMessage = axiosError.message || 'Unknown error';

      // Extract more detailed error information from GitHub's response
      if (axiosError.response) {
        // Safely access response.data, handling cases where it might be undefined or not an object
        const responseData = axiosError.response.data;

        if (responseData && typeof responseData === 'object' && !Array.isArray(responseData)) {
          const errorResponse = responseData as { message?: string; errors?: Array<{ message?: string }> };

          if (errorResponse.message) {
            detailedMessage = errorResponse.message;
          } else if (errorResponse.errors && Array.isArray(errorResponse.errors) && errorResponse.errors.length > 0) {
            detailedMessage = errorResponse.errors.map((e) => e.message || 'Unknown error').join('; ');
          }
        }

        // Provide user-friendly error messages for common issues
        if (axiosError.response.status === 422) {
          const userMessage = `Workflow cannot be triggered. This usually means the workflow does not support manual triggers (workflow_dispatch). Please ensure the workflow file includes 'workflow_dispatch' in its 'on:' triggers.`;

          this.logger.error(`Failed to trigger workflow ${workflowId}: ${detailedMessage}`);
          throw new BadRequestException(userMessage);
        }
      }

      this.logger.error(`Failed to trigger workflow ${workflowId}: ${detailedMessage}`);
      throw new BadRequestException(`Failed to trigger workflow: ${detailedMessage}`);
    }
  }

  /**
   * Get the status of a workflow run.
   */
  async getRunStatus(
    credentials: PipelineProviderCredentials,
    repositoryId: string,
    runId: string,
  ): Promise<PipelineRun> {
    try {
      const api = this.createApiClient(credentials);
      const [owner, repo] = repositoryId.split('/');

      if (!owner || !repo) {
        throw new BadRequestException(`Invalid repository ID format: ${repositoryId}. Expected format: owner/repo`);
      }

      const response = await api.get<{
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        head_branch: string;
        head_sha: string;
        created_at: string;
        updated_at: string;
        run_started_at: string | null;
        completed_at: string | null;
        workflow_id: number;
        html_url: string;
      }>(`/repos/${owner}/${repo}/actions/runs/${runId}`);
      // Get workflow name
      const workflowResponse = await api.get<{ name: string }>(
        `/repos/${owner}/${repo}/actions/workflows/${response.data.workflow_id}`,
      );
      const workflowName = workflowResponse.data.name;

      return this.mapRunToPipelineRun(response.data, response.data.workflow_id.toString(), workflowName, repositoryId);
    } catch (error) {
      this.logger.error(`Failed to get run status: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to get run status: ${(error as AxiosError).message}`);
    }
  }

  /**
   * Get logs for a workflow run.
   */
  async getRunLogs(credentials: PipelineProviderCredentials, repositoryId: string, runId: string): Promise<string> {
    try {
      const api = this.createApiClient(credentials);
      const [owner, repo] = repositoryId.split('/');

      if (!owner || !repo) {
        throw new BadRequestException(`Invalid repository ID format: ${repositoryId}. Expected format: owner/repo`);
      }

      // Get jobs first
      const jobsResponse = await api.get<{ jobs: Array<{ id: number }> }>(
        `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`,
      );
      // Fetch logs for each job
      const logPromises = jobsResponse.data.jobs.map((job) =>
        this.getJobLogs(credentials, repositoryId, runId, job.id.toString()),
      );
      const logs = await Promise.all(logPromises);

      return logs.join('\n\n---\n\n');
    } catch (error) {
      this.logger.error(`Failed to get run logs: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to get run logs: ${(error as AxiosError).message}`);
    }
  }

  /**
   * List jobs for a workflow run.
   */
  async listRunJobs(credentials: PipelineProviderCredentials, repositoryId: string, runId: string): Promise<Job[]> {
    try {
      const api = this.createApiClient(credentials);
      const [owner, repo] = repositoryId.split('/');

      if (!owner || !repo) {
        throw new BadRequestException(`Invalid repository ID format: ${repositoryId}. Expected format: owner/repo`);
      }

      const response = await api.get<{
        jobs: Array<{
          id: number;
          name: string;
          status: string;
          conclusion: string | null;
          started_at: string | null;
          completed_at: string | null;
        }>;
      }>(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`);

      return response.data.jobs.map((job) => ({
        id: job.id.toString(),
        name: job.name,
        status: this.mapStatus(job.status),
        conclusion: job.conclusion ? this.mapConclusion(job.conclusion) : undefined,
        startedAt: job.started_at ? new Date(job.started_at) : undefined,
        completedAt: job.completed_at ? new Date(job.completed_at) : undefined,
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
      const [owner, repo] = repositoryId.split('/');

      if (!owner || !repo) {
        throw new BadRequestException(`Invalid repository ID format: ${repositoryId}. Expected format: owner/repo`);
      }

      // GitHub provides logs as a zip file, we need to download and extract
      // For simplicity, we'll use the logs API endpoint which returns a redirect URL
      const response = await api.get(`/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`, {
        responseType: 'text',
        maxRedirects: 0,
        validateStatus: (status) => status === 200 || status === 302,
      });

      // If we get a redirect, follow it
      if (response.status === 302 && response.headers.location) {
        const logResponse = await axios.get(response.headers.location, {
          responseType: 'text',
        });

        return logResponse.data;
      }

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
   * Cancel a running workflow.
   */
  async cancelRun(credentials: PipelineProviderCredentials, repositoryId: string, runId: string): Promise<void> {
    try {
      const api = this.createApiClient(credentials);
      const [owner, repo] = repositoryId.split('/');

      if (!owner || !repo) {
        throw new BadRequestException(`Invalid repository ID format: ${repositoryId}. Expected format: owner/repo`);
      }

      await api.post(`/repos/${owner}/${repo}/actions/runs/${runId}/cancel`);
    } catch (error) {
      this.logger.error(`Failed to cancel run: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to cancel run: ${(error as AxiosError).message}`);
    }
  }

  /**
   * Map GitHub run status to our PipelineRun status.
   */
  private mapStatus(status: string): string {
    const statusMap: Record<string, string> = {
      queued: 'queued',
      in_progress: 'in_progress',
      completed: 'completed',
      cancelled: 'cancelled',
    };

    return statusMap[status] || status;
  }

  /**
   * Map GitHub conclusion to our PipelineRun conclusion.
   */
  private mapConclusion(conclusion: string): string {
    const conclusionMap: Record<string, string> = {
      success: 'success',
      failure: 'failure',
      cancelled: 'cancelled',
      skipped: 'skipped',
      neutral: 'skipped',
      timed_out: 'failure',
    };

    return conclusionMap[conclusion] || conclusion;
  }

  /**
   * Map GitHub run data to PipelineRun.
   */
  private mapRunToPipelineRun(
    run: {
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      head_branch: string;
      head_sha: string;
      created_at: string;
      updated_at: string;
      run_started_at: string | null;
      completed_at?: string | null;
      workflow_id: number;
      html_url: string;
    },
    workflowId: string,
    workflowName: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _repositoryId: string,
  ): PipelineRun {
    return {
      id: run.id.toString(),
      name: run.name,
      status: this.mapStatus(run.status),
      conclusion: run.conclusion ? this.mapConclusion(run.conclusion) : undefined,
      ref: run.head_branch,
      sha: run.head_sha,
      createdAt: new Date(run.created_at),
      updatedAt: new Date(run.updated_at),
      startedAt: run.run_started_at ? new Date(run.run_started_at) : undefined,
      completedAt: run.completed_at ? new Date(run.completed_at) : undefined,
      workflowId,
      workflowName,
      htmlUrl: run.html_url,
    };
  }
}
