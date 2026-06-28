import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import type { CloudInitProvisioningMode } from '../entities/cloud-init-config.entity';

const PROVISIONING_MODES: CloudInitProvisioningMode[] = ['simple', 'compose-template', 'user-data-template'];

export class CloudInitConfigEnvVariableDefinitionDto {
  @IsNotEmpty({ message: 'Environment variable key is required' })
  @IsString({ message: 'Environment variable key must be a string' })
  key!: string;

  @IsNotEmpty({ message: 'Environment variable label is required' })
  @IsString({ message: 'Environment variable label must be a string' })
  label!: string;

  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  @IsBoolean({ message: 'showInOrderForm must be a boolean' })
  showInOrderForm!: boolean;

  @IsOptional()
  @IsBoolean({ message: 'useRandomDefault must be a boolean' })
  useRandomDefault?: boolean;

  @IsOptional()
  @IsInt({ message: 'randomDefaultLength must be an integer' })
  @Min(21, { message: 'randomDefaultLength must be at least 21' })
  randomDefaultLength?: number;

  @IsOptional()
  @IsBoolean({ message: 'randomDefaultSpecialChars must be a boolean' })
  randomDefaultSpecialChars?: boolean;
}

export class CreateCloudInitConfigDto {
  @IsNotEmpty({ message: 'Key is required' })
  @IsString({ message: 'Key must be a string' })
  key!: string;

  @IsNotEmpty({ message: 'Name is required' })
  @IsString({ message: 'Name must be a string' })
  name!: string;

  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  @IsOptional()
  @IsIn(PROVISIONING_MODES, { message: 'Invalid provisioning mode' })
  provisioningMode?: CloudInitProvisioningMode;

  @IsOptional()
  @IsString({ message: 'Docker image must be a string' })
  dockerImage?: string;

  @IsOptional()
  @IsInt({ message: 'Container port must be an integer' })
  @Min(1)
  @Max(65535)
  containerPort?: number;

  @IsOptional()
  @IsInt({ message: 'Host port must be an integer' })
  @Min(1)
  @Max(65535)
  hostPort?: number;

  @IsOptional()
  @IsString({ message: 'Work directory must be a string' })
  workDir?: string;

  @IsOptional()
  @IsString({ message: 'Docker compose template must be a string' })
  dockerComposeTemplate?: string;

  @IsOptional()
  @IsString({ message: 'User data template must be a string' })
  userDataTemplate?: string;

  @IsOptional()
  @IsArray({ message: 'Environment variables must be an array' })
  @ValidateNested({ each: true })
  @Type(() => CloudInitConfigEnvVariableDefinitionDto)
  environmentVariables?: CloudInitConfigEnvVariableDefinitionDto[];

  @IsOptional()
  @IsObject({ message: 'Default values must be an object' })
  defaultValues?: Record<string, string>;

  @IsOptional()
  @IsBoolean({ message: 'isActive must be a boolean' })
  isActive?: boolean;
}
