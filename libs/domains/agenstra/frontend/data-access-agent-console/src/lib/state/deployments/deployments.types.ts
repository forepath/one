// Types based on backend DTOs
export interface DeploymentConfiguration {
  id: string;
  agentId: string;
  providerType: string;
  repositoryId: string;
  defaultBranch?: string;
  workflowId?: string;
  providerBaseUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDeploymentConfigurationDto {
  providerType: string;
  repositoryId: string;
  defaultBranch?: string;
  workflowId?: string;
  providerToken: string;
  providerBaseUrl?: string;
}

export interface UpdateDeploymentConfigurationDto {
  repositoryId?: string;
  defaultBranch?: string;
  workflowId?: string;
  providerToken?: string;
  providerBaseUrl?: string;
}

export interface DeploymentRun {
  id: string;
  configurationId: string;
  providerRunId: string;
  runName: string;
  status: string;
  conclusion?: string;
  ref: string;
  sha: string;
  workflowId?: string;
  workflowName?: string;
  startedAt?: Date;
  completedAt?: Date;
  htmlUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Repository {
  id: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  url: string;
  private: boolean;
}

export interface Branch {
  name: string;
  sha: string;
  default: boolean;
}

export interface Workflow {
  id: string;
  name: string;
  path: string;
  state: string;
  canTrigger: boolean;
}

export interface Job {
  id: string;
  name: string;
  status: string;
  conclusion?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface TriggerWorkflowDto {
  workflowId: string;
  ref: string;
  inputs?: Record<string, string>;
}
