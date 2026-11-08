import {
  CONNECTION_AUTH_TYPES,
  DEPLOYMENT_LIMITS,
  DEPLOYMENT_PROVIDERS,
  type ConnectionAuthType,
  type DeploymentConnectionWorkspaceAccess,
  type DeploymentProvider,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

const WORKSPACE_ACCESS: readonly DeploymentConnectionWorkspaceAccess[] = ['all', 'selected'];

/**
 * Admin create body. `authType` defaults per provider (GitHub: `app`; GitLab / Jenkins: `token`). Required fields per
 * auth type are enforced by `DeploymentConnectionsService`:
 * - GitHub `app`: `appId`, `installationId`, `privateKey`; GitHub / GitLab `token`: `token`
 * - Jenkins: `baseUrl`, `username`, `token`
 */
export class CreateDeploymentConnectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(DEPLOYMENT_LIMITS.labelMaxLength)
  label!: string;

  @IsIn(DEPLOYMENT_PROVIDERS)
  provider!: DeploymentProvider;

  @IsOptional()
  @IsString()
  @MaxLength(DEPLOYMENT_LIMITS.baseUrlMaxLength)
  baseUrl?: string | null;

  @IsOptional()
  @IsIn(CONNECTION_AUTH_TYPES)
  authType?: ConnectionAuthType;

  @IsOptional()
  @IsString()
  @MaxLength(DEPLOYMENT_LIMITS.tokenMaxLength)
  token?: string;

  @IsOptional()
  @IsString()
  @MaxLength(DEPLOYMENT_LIMITS.usernameMaxLength)
  username?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'appId must be numeric' })
  @MaxLength(DEPLOYMENT_LIMITS.appIdMaxLength)
  appId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'installationId must be numeric' })
  @MaxLength(DEPLOYMENT_LIMITS.appIdMaxLength)
  installationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(DEPLOYMENT_LIMITS.privateKeyMaxLength)
  privateKey?: string;

  @IsOptional()
  @IsIn(WORKSPACE_ACCESS)
  workspaceAccess?: DeploymentConnectionWorkspaceAccess;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DEPLOYMENT_LIMITS.allowedWorkspacesMax)
  @IsUUID('4', { each: true })
  allowedClientIds?: string[];
}

/** Admin update body: all optional, `provider` is immutable. Omitted secrets keep the stored ones. */
export class UpdateDeploymentConnectionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(DEPLOYMENT_LIMITS.labelMaxLength)
  label?: string;

  /** `null` or empty string resets to the provider default (not allowed for Jenkins). */
  @IsOptional()
  @IsString()
  @MaxLength(DEPLOYMENT_LIMITS.baseUrlMaxLength)
  baseUrl?: string | null;

  @IsOptional()
  @IsIn(CONNECTION_AUTH_TYPES)
  authType?: ConnectionAuthType;

  @IsOptional()
  @IsString()
  @MaxLength(DEPLOYMENT_LIMITS.tokenMaxLength)
  token?: string;

  @IsOptional()
  @IsString()
  @MaxLength(DEPLOYMENT_LIMITS.usernameMaxLength)
  username?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'appId must be numeric' })
  @MaxLength(DEPLOYMENT_LIMITS.appIdMaxLength)
  appId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'installationId must be numeric' })
  @MaxLength(DEPLOYMENT_LIMITS.appIdMaxLength)
  installationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(DEPLOYMENT_LIMITS.privateKeyMaxLength)
  privateKey?: string;

  @IsOptional()
  @IsIn(WORKSPACE_ACCESS)
  workspaceAccess?: DeploymentConnectionWorkspaceAccess;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DEPLOYMENT_LIMITS.allowedWorkspacesMax)
  @IsUUID('4', { each: true })
  allowedClientIds?: string[];
}
