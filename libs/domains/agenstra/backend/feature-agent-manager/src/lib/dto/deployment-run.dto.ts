import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * DTO for triggering a workflow run.
 */
export class TriggerWorkflowDto {
  @IsNotEmpty({ message: 'Workflow ID is required' })
  @IsString({ message: 'Workflow ID must be a string' })
  workflowId!: string;

  @IsNotEmpty({ message: 'Ref is required' })
  @IsString({ message: 'Ref must be a string' })
  ref!: string;

  @IsOptional()
  @IsObject({ message: 'Inputs must be an object' })
  inputs?: Record<string, string>;
}

/**
 * DTO for deployment run response.
 */
export class DeploymentRunResponseDto {
  id!: string;
  configurationId!: string;
  providerRunId!: string;
  runName!: string;
  status!: string;
  conclusion?: string;
  ref!: string;
  sha!: string;
  workflowId?: string;
  workflowName?: string;
  startedAt?: Date;
  completedAt?: Date;
  htmlUrl?: string;
  createdAt!: Date;
  updatedAt!: Date;
}

/**
 * DTO for listing repositories.
 */
export class RepositoryResponseDto {
  id!: string;
  name!: string;
  fullName!: string;
  defaultBranch!: string;
  url!: string;
  private!: boolean;
}

/**
 * DTO for listing branches.
 */
export class BranchResponseDto {
  name!: string;
  sha!: string;
  default!: boolean;
}

/**
 * DTO for listing workflows.
 */
export class WorkflowResponseDto {
  id!: string;
  name!: string;
  path!: string;
  state!: string;
  canTrigger!: boolean;
}

/**
 * DTO for listing jobs/steps.
 */
export class JobResponseDto {
  id!: string;
  name!: string;
  status!: string;
  conclusion?: string;
  startedAt?: Date;
  completedAt?: Date;
}
