import {
  ATLASSIAN_CONNECTION_AUTH_TYPES,
  type ConnectionAuthType,
} from '@forepath/agenstra/shared/util-opencode-config';
import { IsEmail, IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/**
 * All fields optional. Omitted secrets (`apiToken`, `oauthClientSecret`) keep the stored ones; switching `authType`
 * requires the credentials of the new type.
 */
export class UpdateAtlassianSiteConnectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string | null;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(512)
  baseUrl?: string;

  @IsOptional()
  @IsIn(ATLASSIAN_CONNECTION_AUTH_TYPES)
  authType?: ConnectionAuthType;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  accountEmail?: string;

  /** When omitted, existing token is kept. */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  apiToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  oauthClientId?: string;

  /** When omitted, existing secret is kept. */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  oauthClientSecret?: string;
}
