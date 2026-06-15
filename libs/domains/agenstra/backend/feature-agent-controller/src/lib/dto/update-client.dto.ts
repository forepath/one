import { AuthenticationType } from '@forepath/identity/backend';
import { IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

/**
 * DTO for updating an existing client.
 * All fields are optional to support partial updates.
 * API key can be updated but will never be included in responses.
 */
export class UpdateClientDto {
  @IsOptional()
  @IsString({ message: 'Name must be a string' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  @IsOptional()
  @IsUrl({}, { message: 'Endpoint must be a valid URL' })
  endpoint?: string;

  @IsOptional()
  @IsEnum(AuthenticationType, { message: 'Authentication type must be either api_key or keycloak' })
  authenticationType?: AuthenticationType;

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
  @IsInt({ message: 'Agent WebSocket port must be an integer' })
  @Min(1)
  @Max(65535)
  agentWsPort?: number;
}
