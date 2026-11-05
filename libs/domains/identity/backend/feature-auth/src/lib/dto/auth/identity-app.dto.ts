import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { APP_STATE_MAX_LENGTH } from '../../constants/app.constants';

export class CreateIdentityAppDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  returnUrl!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  scopes!: string[];
}

export class UpdateIdentityAppDto extends CreateIdentityAppDto {}

/** Query of the grant page (what the app asked for). */
export class AppAuthorizationRequestQueryDto {
  @IsUUID()
  app_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(APP_STATE_MAX_LENGTH)
  state?: string;

  /** PKCE S256 challenge (base64url SHA-256 of the verifier). */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  code_challenge?: string;

  @IsOptional()
  @IsIn(['S256'])
  code_challenge_method?: 'S256';
}

export class AppAuthorizationDecisionDto {
  @IsUUID()
  appId!: string;

  @IsIn(['approve', 'deny'])
  decision!: 'approve' | 'deny';

  @IsOptional()
  @IsString()
  @MaxLength(APP_STATE_MAX_LENGTH)
  state?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  codeChallenge?: string;

  @IsOptional()
  @IsIn(['S256'])
  codeChallengeMethod?: 'S256';

  /** Second factor (TOTP or email code) when the user has 2FA. */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  code?: string;
}

/** Token endpoint body (snake_case, OAuth style). Accepts JSON or form-encoded bodies. */
export class AppTokenRequestDto {
  @IsIn(['authorization_code', 'refresh_token'])
  grant_type!: 'authorization_code' | 'refresh_token';

  @IsString()
  @MaxLength(64)
  app_id!: string;

  @IsString()
  @MaxLength(256)
  app_secret!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  code?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._~-]{43,128}$/)
  code_verifier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  refresh_token?: string;
}
