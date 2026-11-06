import { AuthenticationType } from '@forepath/identity/backend';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

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
  @IsEnum(AuthenticationType, { message: 'Authentication type must be either api_key or oidc' })
  authenticationType!: AuthenticationType;

  @IsOptional()
  @IsString({ message: 'API key must be a string' })
  apiKey?: string;

  @IsOptional()
  @IsString({ message: 'OIDC client ID must be a string' })
  @MaxLength(255)
  oidcClientId?: string;

  @IsOptional()
  @IsString({ message: 'OIDC client secret must be a string' })
  @MaxLength(512)
  oidcClientSecret?: string;

  /** OpenID provider issuer; defaults to the controller's `OIDC_ISSUER`. */
  @IsOptional()
  @IsUrl(
    { require_tld: false, require_protocol: true, protocols: ['http', 'https'] },
    { message: 'OIDC issuer must be a valid http(s) URL' },
  )
  @MaxLength(1024)
  oidcIssuer?: string;

  /** Optional space separated scopes for the client credentials grant. */
  @IsOptional()
  @IsString({ message: 'OIDC scope must be a string' })
  @MaxLength(1024)
  oidcScope?: string;
}
