import { AuthenticationType } from '@forepath/identity/backend';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

/**
 * DTO for creating a new client.
 * API key can be provided or will be auto-generated for API_KEY authentication type.
 * The API key is returned in the creation response but excluded from subsequent responses.
 */
export class CreateClientDto {
  @IsNotEmpty({ message: 'Name is required' })
  @IsString({ message: 'Name must be a string' })
  name!: string;

  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  @IsNotEmpty({ message: 'Endpoint is required' })
  @IsUrl({}, { message: 'Endpoint must be a valid URL' })
  endpoint!: string;

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
  @IsInt({ message: 'Agent WebSocket port must be an integer' })
  @Min(1)
  @Max(65535)
  agentWsPort?: number;
}
