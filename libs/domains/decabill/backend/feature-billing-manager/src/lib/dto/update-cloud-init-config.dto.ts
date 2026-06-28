import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import type { CloudInitProvisioningMode } from '../entities/cloud-init-config.entity';
import { CloudInitConfigEnvVariableDefinitionDto } from './create-cloud-init-config.dto';

const PROVISIONING_MODES: CloudInitProvisioningMode[] = ['simple', 'compose-template', 'user-data-template'];

export class UpdateCloudInitConfigDto {
  @IsOptional()
  @IsString({ message: 'Name must be a string' })
  name?: string;

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
  dockerComposeTemplate?: string | null;

  @IsOptional()
  @IsString({ message: 'User data template must be a string' })
  userDataTemplate?: string | null;

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
