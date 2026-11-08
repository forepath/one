import { DEPLOYMENT_LIMITS, type DeploymentWorkflowScope } from '@forepath/agenstra/shared/util-opencode-config';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { IsDeploymentInputs } from './deployment-inputs.validator';

export const DEPLOYMENT_WORKFLOW_SCOPES: readonly DeploymentWorkflowScope[] = ['global', 'environments'];

/** Body of `POST /clients/:clientId/deployments/workflows` (workspace management). */
export class CreateDeploymentWorkflowDto {
  /** Deployment connection usable by this workspace. */
  @IsUUID('4')
  connectionId!: string;

  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(DEPLOYMENT_LIMITS.nameMaxLength)
  name!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(DEPLOYMENT_LIMITS.descriptionMaxLength)
  description?: string | null;

  /** Provider repository (`owner/repo`, GitLab project id or path, Jenkins job full name). */
  @IsString()
  @IsNotEmpty({ message: 'repository is required' })
  @MaxLength(DEPLOYMENT_LIMITS.repositoryMaxLength)
  repository!: string;

  /** GitHub workflow file or id (required for GitHub; ignored by GitLab and Jenkins). */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(DEPLOYMENT_LIMITS.workflowMaxLength)
  workflow?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(DEPLOYMENT_LIMITS.refMaxLength)
  defaultRef?: string | null;

  @IsOptional()
  @IsDeploymentInputs()
  defaultInputs?: Record<string, string>;

  @IsOptional()
  @IsIn(DEPLOYMENT_WORKFLOW_SCOPES)
  scope?: DeploymentWorkflowScope;

  /** Environments of this workspace (`scope: environments`, at least one). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DEPLOYMENT_LIMITS.assignedEnvironmentsMax)
  @IsUUID('4', { each: true })
  agentIds?: string[];

  /** Whether assigned environments may trigger and cancel runs through the MCP server. */
  @IsOptional()
  @IsBoolean()
  agentTriggerEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** Body of `PUT /clients/:clientId/deployments/workflows/:workflowId`; omitted fields stay unchanged. */
export class UpdateDeploymentWorkflowDto {
  @IsOptional()
  @IsUUID('4')
  connectionId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'name must not be empty' })
  @MaxLength(DEPLOYMENT_LIMITS.nameMaxLength)
  name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(DEPLOYMENT_LIMITS.descriptionMaxLength)
  description?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'repository must not be empty' })
  @MaxLength(DEPLOYMENT_LIMITS.repositoryMaxLength)
  repository?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(DEPLOYMENT_LIMITS.workflowMaxLength)
  workflow?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(DEPLOYMENT_LIMITS.refMaxLength)
  defaultRef?: string | null;

  @IsOptional()
  @IsDeploymentInputs()
  defaultInputs?: Record<string, string>;

  @IsOptional()
  @IsIn(DEPLOYMENT_WORKFLOW_SCOPES)
  scope?: DeploymentWorkflowScope;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DEPLOYMENT_LIMITS.assignedEnvironmentsMax)
  @IsUUID('4', { each: true })
  agentIds?: string[];

  @IsOptional()
  @IsBoolean()
  agentTriggerEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * Body of `POST /clients/:clientId/deployments/workflows/:workflowId/approval` (workspace management): the version
 * (`updatedAt` of the summary) the admin reviewed; a workflow changed since then is not approved (409).
 */
export class ApproveDeploymentWorkflowDto {
  @IsISO8601({}, { message: 'updatedAt must be the ISO timestamp of the reviewed workflow' })
  updatedAt!: string;
}
