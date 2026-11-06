import { IsString, Matches, MaxLength } from 'class-validator';

/** Redeems the one-time code from the SAML callback (`POST /auth/saml/token`). */
export class SamlTokenExchangeDto {
  @IsString()
  @MaxLength(128)
  code!: string;

  /** PKCE verifier (RFC 7636) matching the `code_challenge` sent to `GET /auth/saml/login`. */
  @IsString()
  @Matches(/^[A-Za-z0-9._~-]{43,128}$/)
  codeVerifier!: string;
}
