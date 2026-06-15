import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

/**
 * DTO for creating or updating a deployment configuration.
 */
export class CreateDeploymentConfigurationDto {
  @IsNotEmpty({ message: 'Provider type is required' })
  @IsString({ message: 'Provider type must be a string' })
  providerType!: string;

  @IsNotEmpty({ message: 'Repository ID is required' })
  @IsString({ message: 'Repository ID must be a string' })
  repositoryId!: string;

  @IsOptional()
  @IsString({ message: 'Default branch must be a string' })
  defaultBranch?: string;

  @IsOptional()
  @IsString({ message: 'Workflow ID must be a string' })
  workflowId?: string;

  @IsNotEmpty({ message: 'Provider token is required' })
  @IsString({ message: 'Provider token must be a string' })
  providerToken!: string;

  @IsOptional()
  @IsUrl({}, { message: 'Provider base URL must be a valid URL' })
  providerBaseUrl?: string;
}

/**
 * DTO for updating a deployment configuration.
 */
export class UpdateDeploymentConfigurationDto {
  @IsOptional()
  @IsString({ message: 'Repository ID must be a string' })
  repositoryId?: string;

  @IsOptional()
  @IsString({ message: 'Default branch must be a string' })
  defaultBranch?: string;

  @IsOptional()
  @IsString({ message: 'Workflow ID must be a string' })
  workflowId?: string;

  @IsOptional()
  @IsString({ message: 'Provider token must be a string' })
  providerToken?: string;

  @IsOptional()
  @IsUrl({}, { message: 'Provider base URL must be a valid URL' })
  providerBaseUrl?: string;
}

/**
 * DTO for deployment configuration response.
 */
export class DeploymentConfigurationResponseDto {
  id!: string;
  agentId!: string;
  providerType!: string;
  repositoryId!: string;
  defaultBranch?: string;
  workflowId?: string;
  providerBaseUrl?: string;
  createdAt!: Date;
  updatedAt!: Date;
}
