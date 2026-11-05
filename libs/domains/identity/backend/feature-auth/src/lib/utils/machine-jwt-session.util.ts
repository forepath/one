import { UnauthorizedException } from '@nestjs/common';

import type { UsersJwtSessionPayload } from './users-jwt-session.util';

/** Live verifiers of machine JWTs (PAT exchange and app access tokens). */
export interface MachineJwtVerifiers {
  personalAccessTokenService: {
    assertPatJwtActive(patId: string, userId: string, jwtScopes: string[] | undefined): Promise<{ scopes: string[] }>;
  };
  appAuthorizationService: {
    assertAppJwtActive(input: {
      appSessionId?: string;
      appId?: string;
      userId: string;
      jwtScopes?: string[];
    }): Promise<{ scopes: string[] }>;
  };
}

export interface MachineJwtSession {
  scopes: string[];
  /** Set for PAT-exchanged JWTs. */
  patId?: string;
  /** Set for app access tokens (`amr` includes `app`). */
  appId?: string;
  appSessionId?: string;
}

/**
 * Machine JWTs: PAT-exchanged JWTs (`['pat']`) and app access tokens (`['pat', 'app']`).
 * `app` alone is treated as machine too (fail-closed; such tokens are never issued).
 */
export function isMachineJwtAmr(amr: readonly string[] | undefined): boolean {
  const values = amr ?? [];

  return values.includes('pat') || values.includes('app');
}

/** `amr` of a machine JWT, always including `pat` so every downstream PAT rule (no admin bypass, scopes) applies. */
export function normalizeMachineJwtAmr(amr: readonly string[] | undefined): string[] {
  const values = [...(amr ?? [])];

  return values.includes('pat') ? values : ['pat', ...values];
}

/**
 * Live check of a machine JWT shared by the HTTP guards and socket auth: the PAT / app session must still be
 * active and its current scopes must equal the JWT scopes. Returns the effective (live) scopes.
 * Callers verify the signature, the user (exists, not locked, tenant) and the token version first.
 */
export async function resolveMachineJwtSession(
  payload: UsersJwtSessionPayload,
  verifiers: MachineJwtVerifiers,
): Promise<MachineJwtSession> {
  const amr = payload.amr ?? [];

  if (amr.includes('app')) {
    const active = await verifiers.appAuthorizationService.assertAppJwtActive({
      appSessionId: payload.appSessionId,
      appId: payload.appId,
      userId: payload.sub,
      jwtScopes: payload.scopes,
    });

    return { scopes: active.scopes, appId: payload.appId, appSessionId: payload.appSessionId };
  }

  if (!payload.patId) {
    throw new UnauthorizedException('Session is no longer valid.');
  }

  const active = await verifiers.personalAccessTokenService.assertPatJwtActive(
    payload.patId,
    payload.sub,
    payload.scopes,
  );

  return { scopes: active.scopes, patId: payload.patId };
}
