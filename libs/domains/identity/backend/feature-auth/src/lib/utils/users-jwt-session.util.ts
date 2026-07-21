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
