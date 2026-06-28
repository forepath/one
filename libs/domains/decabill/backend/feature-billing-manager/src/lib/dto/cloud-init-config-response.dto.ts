import type {
  CloudInitConfigEnvVariableDefinition,
  CloudInitProvisioningMode,
} from '../entities/cloud-init-config.entity';

export class CloudInitConfigResponseDto {
  id!: string;
  key!: string;
  name!: string;
  provisioningMode!: CloudInitProvisioningMode;
  description?: string | null;
  dockerImage?: string | null;
  containerPort!: number;
  hostPort!: number;
  workDir!: string;
  dockerComposeTemplate?: string | null;
  userDataTemplate?: string | null;
  environmentVariables!: CloudInitConfigEnvVariableDefinition[];
  /** Decrypted default values; only included on admin GET by id. */
  defaultValues?: Record<string, string>;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

export class CloudInitConfigOrderFieldDto {
  key!: string;
  label!: string;
  description?: string | null;
  required!: boolean;
  /** True when the admin configured a static or server-generated default; value is not exposed to customers. */
  hasDefault!: boolean;
}
