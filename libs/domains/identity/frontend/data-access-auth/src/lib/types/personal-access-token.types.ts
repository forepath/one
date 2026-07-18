export interface PersonalAccessTokenScopeDto {
  scope: string;
}

export interface PersonalAccessTokenResponseDto {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  /** Present only on create. */
  token?: string;
}

export interface CreatePersonalAccessTokenDto {
  name: string;
  scopes: string[];
  expiresAt?: string;
}

export interface UpdatePersonalAccessTokenDto {
  name: string;
  scopes: string[];
}
