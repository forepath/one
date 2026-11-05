export interface IdentityAppResponseDto {
  id: string;
  name: string;
  description: string | null;
  returnUrl: string;
  scopes: string[];
  secretPrefix: string;
  secretRotatedAt: string | null;
  grantCount: number;
  createdAt: string;
  updatedAt: string;
  /** Plaintext secret; present only on create and rotate. */
  secret?: string;
}

export interface IdentityAppInputDto {
  name: string;
  description?: string;
  returnUrl: string;
  scopes: string[];
}

export interface IdentityAppGrantResponseDto {
  id: string;
  appId: string;
  appName: string;
  appDescription: string | null;
  userId: string;
  userEmail: string;
  consentedScopes: string[];
  /** Scopes app tokens currently carry. */
  scopes: string[];
  needsReauthorization: boolean;
  sessionCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Query the app sends the user to `/authorize` with. */
export interface AppAuthorizationRequestDto {
  app_id: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: 'S256';
}

export type AppSecondFactorMethod = 'email' | 'totp';

export interface AppAuthorizationInfoDto {
  app: { id: string; name: string; description: string | null; returnUrl: string };
  grantableScopes: string[];
  ungrantableScopes: string[];
  alreadyAuthorized: boolean;
  secondFactor: AppSecondFactorMethod | null;
}

export interface AppAuthorizationDecisionDto {
  appId: string;
  decision: 'approve' | 'deny';
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256';
  code?: string;
}

export interface AppAuthorizationDecisionResponseDto {
  redirectUrl: string;
}
