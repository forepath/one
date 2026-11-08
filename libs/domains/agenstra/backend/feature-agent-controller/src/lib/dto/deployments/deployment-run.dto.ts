import { DEPLOYMENT_LIMITS } from '@forepath/agenstra/shared/util-opencode-config';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { IsDeploymentInputs } from './deployment-inputs.validator';

/** Body of `POST /clients/:clientId/deployments/workflows/:workflowId/trigger`. */
export class TriggerDeploymentRunDto {
  /** Branch / tag; defaults to the workflow default ref, then the repository default branch. */
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'ref must not be empty' })
  @MaxLength(DEPLOYMENT_LIMITS.refMaxLength)
  ref?: string;

  /** Overrides of the workflow default inputs. */
  @IsOptional()
  @IsDeploymentInputs()
  inputs?: Record<string, string>;

  /** Environment the run is triggered for (the workflow must be global or assigned to it). */
  @IsOptional()
  @IsUUID('4')
  agentId?: string;
}

/** Default / maximum page size of `GET /clients/:clientId/deployments/runs`. */
export const DEPLOYMENT_RUNS_DEFAULT_LIMIT = 25;
export const DEPLOYMENT_RUNS_MAX_LIMIT = 100;

/** Default / maximum page size of `GET /clients/:clientId/deployments/workflows`. */
export const DEPLOYMENT_WORKFLOWS_DEFAULT_LIMIT = 50;
export const DEPLOYMENT_WORKFLOWS_MAX_LIMIT = 200;
