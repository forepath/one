/**
 * Pipeline provider interface for implementing different CI/CD provider solutions.
 * This interface allows the system to support multiple CI/CD providers
 * (e.g., GitHub Actions, GitLab CI, Jenkins, etc.) through a unified API.
 */
export interface PipelineProvider {
  /**
   * Get the unique type identifier for this provider.
   * This is used to identify which provider to use for pipeline operations.
   * @returns The provider type string (e.g., 'github', 'gitlab', 'jenkins')
   */
  getType(): string;

  /**
   * Get the human-readable display name for this provider.
   * This is used in UI components to show a friendly name to users.
   * @returns The display name string (e.g., 'GitHub Actions', 'GitLab CI', 'Jenkins')
   */
  getDisplayName(): string;

  /**
   * List repositories accessible with the provided credentials.
   * @param credentials - Provider-specific credentials (e.g., API token)
   * @returns Array of repositories
   */
  listRepositories(credentials: PipelineProviderCredentials): Promise<Repository[]>;

  /**
   * List branches for a repository.
   * @param credentials - Provider-specific credentials
   * @param repositoryId - Repository identifier (e.g., 'owner/repo' for GitHub)
   * @returns Array of branches
   */
  listBranches(credentials: PipelineProviderCredentials, repositoryId: string): Promise<Branch[]>;

  /**
   * List workflows/pipelines for a repository.
   * @param credentials - Provider-specific credentials
   * @param repositoryId - Repository identifier
   * @param branch - Branch name (optional, defaults to default branch)
   * @returns Array of workflows/pipelines
   */
  listWorkflows(credentials: PipelineProviderCredentials, repositoryId: string, branch?: string): Promise<Workflow[]>;

  /**
   * Trigger a workflow/pipeline run.
   * @param credentials - Provider-specific credentials
   * @param repositoryId - Repository identifier
   * @param workflowId - Workflow/pipeline identifier
   * @param ref - Git reference (branch, tag, or commit SHA)
   * @param inputs - Optional workflow inputs
   * @returns The triggered run information
   */
  triggerWorkflow(
    credentials: PipelineProviderCredentials,
    repositoryId: string,
    workflowId: string,
    ref: string,
    inputs?: Record<string, string>,
  ): Promise<PipelineRun>;

  /**
   * Get the status of a pipeline run.
   * @param credentials - Provider-specific credentials
   * @param repositoryId - Repository identifier
   * @param runId - Run identifier
   * @returns Run status information
   */
  getRunStatus(credentials: PipelineProviderCredentials, repositoryId: string, runId: string): Promise<PipelineRun>;

  /**
   * Get logs for a pipeline run.
   * @param credentials - Provider-specific credentials
   * @param repositoryId - Repository identifier
   * @param runId - Run identifier
   * @returns Run logs as string
   */
  getRunLogs(credentials: PipelineProviderCredentials, repositoryId: string, runId: string): Promise<string>;

  /**
   * List jobs/steps for a pipeline run.
   * @param credentials - Provider-specific credentials
   * @param repositoryId - Repository identifier
   * @param runId - Run identifier
   * @returns Array of jobs/steps
   */
  listRunJobs(credentials: PipelineProviderCredentials, repositoryId: string, runId: string): Promise<Job[]>;

  /**
   * Get logs for a specific job/step.
   * @param credentials - Provider-specific credentials
   * @param repositoryId - Repository identifier
   * @param runId - Run identifier
   * @param jobId - Job identifier
   * @returns Job logs as string
   */
  getJobLogs(
    credentials: PipelineProviderCredentials,
    repositoryId: string,
    runId: string,
    jobId: string,
  ): Promise<string>;

  /**
   * Cancel a running pipeline.
   * @param credentials - Provider-specific credentials
   * @param repositoryId - Repository identifier
   * @param runId - Run identifier
   * @returns Promise that resolves when cancellation is complete
   */
  cancelRun(credentials: PipelineProviderCredentials, repositoryId: string, runId: string): Promise<void>;
}

/**
 * Provider-specific credentials.
 * Different providers may require different credential types.
 */
export interface PipelineProviderCredentials {
  /**
   * API token or access token for authentication
   */
  token: string;

  /**
   * Optional base URL for self-hosted instances (e.g., GitHub Enterprise)
   */
  baseUrl?: string;
}

/**
 * Repository information.
 */
export interface Repository {
  /**
   * Repository identifier (e.g., 'owner/repo' for GitHub)
   */
  id: string;

  /**
   * Repository name
   */
  name: string;

  /**
   * Repository full name (e.g., 'owner/repo')
   */
  fullName: string;

  /**
   * Default branch name
   */
  defaultBranch: string;

  /**
   * Repository URL
   */
  url: string;

  /**
   * Whether the repository is private
   */
  private: boolean;
}

/**
 * Branch information.
 */
export interface Branch {
  /**
   * Branch name
   */
  name: string;

  /**
   * Commit SHA
   */
  sha: string;

  /**
   * Whether this is the default branch
   */
  default: boolean;
}

/**
 * Workflow/pipeline information.
 */
export interface Workflow {
  /**
   * Workflow identifier
   */
  id: string;

  /**
   * Workflow name
   */
  name: string;

  /**
   * Workflow file path (e.g., '.github/workflows/deploy.yml')
   */
  path: string;

  /**
   * Workflow state (e.g., 'active', 'disabled')
   */
  state: string;

  /**
   * Whether the workflow can be manually triggered
   */
  canTrigger: boolean;
}

/**
 * Pipeline run information.
 */
export interface PipelineRun {
  /**
   * Run identifier
   */
  id: string;

  /**
   * Run name/title
   */
  name: string;

  /**
   * Run status (e.g., 'queued', 'in_progress', 'completed', 'cancelled', 'failure')
   */
  status: string;

  /**
   * Run conclusion (e.g., 'success', 'failure', 'cancelled', 'skipped')
   */
  conclusion?: string;

  /**
   * Git reference (branch, tag, or commit SHA)
   */
  ref: string;

  /**
   * Commit SHA
   */
  sha: string;

  /**
   * When the run was created
   */
  createdAt: Date;

  /**
   * When the run was updated
   */
  updatedAt: Date;

  /**
   * When the run started
   */
  startedAt?: Date;

  /**
   * When the run completed
   */
  completedAt?: Date;

  /**
   * Workflow that triggered this run
   */
  workflowId: string;

  /**
   * Workflow name
   */
  workflowName: string;

  /**
   * HTML URL for viewing the run
   */
  htmlUrl?: string;
}

/**
 * Job/step information within a pipeline run.
 */
export interface Job {
  /**
   * Job identifier
   */
  id: string;

  /**
   * Job name
   */
  name: string;

  /**
   * Job status (e.g., 'queued', 'in_progress', 'completed', 'cancelled', 'failure')
   */
  status: string;

  /**
   * Job conclusion (e.g., 'success', 'failure', 'cancelled', 'skipped')
   */
  conclusion?: string;

  /**
   * When the job started
   */
  startedAt?: Date;

  /**
   * When the job completed
   */
  completedAt?: Date;
}
