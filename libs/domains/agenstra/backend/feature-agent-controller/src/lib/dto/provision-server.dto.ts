import { GitRepositorySetupMode } from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType } from '@forepath/identity/backend';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * DTO for provisioning a new server through a cloud provider.
 */
export class ProvisionServerDto {
  @IsNotEmpty({ message: 'Provider type is required' })
  @IsString({ message: 'Provider type must be a string' })
  providerType!: string;

  @IsNotEmpty({ message: 'Server type is required' })
  @IsString({ message: 'Server type must be a string' })
  serverType!: string;

  @IsNotEmpty({ message: 'Name is required' })
  @IsString({ message: 'Name must be a string' })
  name!: string;

  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  @IsOptional()
  @IsString({ message: 'Location must be a string' })
  location?: string;

  @IsNotEmpty({ message: 'Authentication type is required' })
  @IsEnum(AuthenticationType, { message: 'Authentication type must be either api_key or keycloak' })
  authenticationType!: AuthenticationType;

  @IsOptional()
  @IsString({ message: 'API key must be a string' })
  apiKey?: string;

  @IsOptional()
  @IsString({ message: 'Keycloak client ID must be a string' })
  keycloakClientId?: string;

  @IsOptional()
  @IsString({ message: 'Keycloak client secret must be a string' })
  keycloakClientSecret?: string;

  @IsOptional()
  @IsString({ message: 'Keycloak realm must be a string' })
  keycloakRealm?: string;

  @IsOptional()
  @IsString({ message: 'Keycloak auth server URL must be a string' })
  keycloakAuthServerUrl?: string;

  @IsOptional()
  @IsInt({ message: 'Agent WebSocket port must be an integer' })
  @Min(1)
  @Max(65535)
  agentWsPort?: number;

  @IsOptional()
  @IsEnum(GitRepositorySetupMode, {
    message: 'Git repository setup mode must be one of: clone, empty',
  })
  gitRepositorySetupMode?: GitRepositorySetupMode;

  @IsOptional()
  @IsString({ message: 'Git repository URL must be a string' })
  gitRepositoryUrl?: string;

  @IsOptional()
  @IsString({ message: 'Git username must be a string' })
  gitUsername?: string;

  @IsOptional()
  @IsString({ message: 'Git token must be a string' })
  gitToken?: string;

  @IsOptional()
  @IsString({ message: 'Git password must be a string' })
  gitPassword?: string;

  @IsOptional()
  @IsString({ message: 'Git private key must be a string' })
  gitPrivateKey?: string;

  @IsOptional()
  @IsString({ message: 'Cursor API key must be a string' })
  cursorApiKey?: string;

  @IsOptional()
  @IsString({ message: 'Agent default image must be a string' })
  agentDefaultImage?: string;

  @IsOptional()
  @IsString({ message: 'AUTO_ENRICH_ENABLED_GLOBAL must be a string' })
  @IsIn(['true', 'false'], { message: 'autoEnrichEnabledGlobal must be "true" or "false"' })
  autoEnrichEnabledGlobal?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 8 }, { message: 'autoEnrichVectorMaxCosineDistance must be a number' })
  @Min(0, { message: 'autoEnrichVectorMaxCosineDistance must be between 0 and 2' })
  @Max(2, { message: 'autoEnrichVectorMaxCosineDistance must be between 0 and 2' })
  autoEnrichVectorMaxCosineDistance?: number;
}
