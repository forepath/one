import { UserEntity } from '@forepath/identity/backend';
import { UnauthorizedException } from '@nestjs/common';

import { RevokedUserTokensRepository } from '../repositories/revoked-user-tokens.repository';

export interface UsersJwtSessionPayload {
  sub: string;
  email: string;
  roles: string[];
  /** Authentication method reference: `pwd` (console) or `pat` (machine). */
  amr?: string[];
  /** Capability scopes present only for PAT-issued JWTs. */
  scopes?: string[];
  /** Personal access token id for live revoke/scope checks (`amr: pat` only). */
  patId?: string;
  /** App id for app access tokens (`amr: ['pat', 'app']`). */
  appId?: string;
  /** App session id for live revoke/scope checks of app access tokens. */
  appSessionId?: string;
  tv?: number;
  jti?: string;
  exp?: number;
}

export async function assertUsersJwtSessionValid(
  payload: UsersJwtSessionPayload,
  user: UserEntity,
  revokedUserTokensRepository: RevokedUserTokensRepository,
): Promise<void> {
  const tokenVersion = payload.tv ?? 0;
  const userTokenVersion = user.tokenVersion ?? 0;

  if (tokenVersion !== userTokenVersion) {
    throw new UnauthorizedException('Session is no longer valid.');
  }

  if (payload.jti && (await revokedUserTokensRepository.isRevoked(payload.jti))) {
    throw new UnauthorizedException('Session is no longer valid.');
  }
}

/**
 * Interactive app session JWTs are only valid for the method that issued them: `pwd` (users mode) or `saml`
 * (saml mode). Switching AUTHENTICATION_METHOD therefore ends sessions created under the other method even though
 * they are signed with the same JWT_SECRET. Machine JWTs (`pat` / `app`) are checked separately.
 */
export function isInteractiveAmrAllowedForMethod(amr: readonly string[] | undefined, method: string): boolean {
  const values = amr && amr.length > 0 ? amr : ['pwd'];

  if (method === 'saml') {
    return values.includes('saml');
  }

  if (method === 'users') {
    return values.includes('pwd');
  }

  return false;
}
