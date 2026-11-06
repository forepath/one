import { AuthenticationType } from '@forepath/identity/backend';
import { IsEnum, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

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
  @IsEnum(AuthenticationType, { message: 'Authentication type must be either api_key or oidc' })
  authenticationType?: AuthenticationType;

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
