import {
  ATLASSIAN_CONNECTION_AUTH_TYPES,
  type ConnectionAuthType,
} from '@forepath/agenstra/shared/util-opencode-config';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/**
 * `authType` defaults to `app` (OAuth 2.0 client credentials of an Atlassian service account: `oauthClientId` +
 * `oauthClientSecret`). `token` requires `accountEmail` + `apiToken`. Required fields per type are enforced by
 * {@link AtlassianSiteConnectionService}; fields of the other type are ignored.
 */
export class CreateAtlassianSiteConnectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  @MaxLength(512)
  baseUrl!: string;

  @IsOptional()
  @IsIn(ATLASSIAN_CONNECTION_AUTH_TYPES)
  authType?: ConnectionAuthType;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  accountEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  apiToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  oauthClientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  oauthClientSecret?: string;
}
