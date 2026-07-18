import { UserRole } from '@forepath/identity/backend';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { PatBearerAuthGuard } from './pat-bearer-auth.guard';

describe('PatBearerAuthGuard', () => {
  let guard: PatBearerAuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let usersRepository: { findById: jest.Mock };
  let revokedUserTokensRepository: { isRevoked: jest.Mock };
  let personalAccessTokenService: { assertPatJwtActive: jest.Mock };
  let originalAuthMethod: string | undefined;
  const createContext = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as never;

  beforeEach(() => {
    originalAuthMethod = process.env.AUTHENTICATION_METHOD;
    process.env.AUTHENTICATION_METHOD = 'keycloak';
    jwtService = { verifyAsync: jest.fn() };
    usersRepository = { findById: jest.fn() };
    revokedUserTokensRepository = { isRevoked: jest.fn().mockResolvedValue(false) };
    personalAccessTokenService = { assertPatJwtActive: jest.fn() };
    guard = new PatBearerAuthGuard(
      jwtService as unknown as JwtService,
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector,
      usersRepository as never,
      revokedUserTokensRepository as never,
      personalAccessTokenService as never,
    );
  });

  afterEach(() => {
    if (originalAuthMethod !== undefined) {
      process.env.AUTHENTICATION_METHOD = originalAuthMethod;
    } else {
      delete process.env.AUTHENTICATION_METHOD;
    }
  });

  it('no-ops when AUTHENTICATION_METHOD is not keycloak', async () => {
    process.env.AUTHENTICATION_METHOD = 'users';
    const request = { headers: { authorization: 'Bearer x' } };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('passes through when bearer is not an app JWT', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));
    const request = { headers: { authorization: 'Bearer keycloak-access-token' } };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request).not.toHaveProperty('patAuthenticated', true);
  });

  it('passes through when app JWT is not a PAT session', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'u1', amr: ['pwd'] });
    const request = { headers: { authorization: 'Bearer pwd-jwt' } };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request).not.toHaveProperty('patAuthenticated', true);
  });

  it('authenticates PAT JWTs and sets patAuthenticated', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'u1',
      amr: ['pat'],
      patId: 't1',
      scopes: ['usage:write'],
      jti: 'j1',
      exp: 9999999999,
      tv: 0,
    });
    usersRepository.findById.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      role: UserRole.ADMIN,
      lockedAt: null,
      tenantId: 'default',
      tokenVersion: 0,
    });
    personalAccessTokenService.assertPatJwtActive.mockResolvedValue({ scopes: ['usage:write'] });

    const request: Record<string, unknown> = { headers: { authorization: 'Bearer pat-jwt' } };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.patAuthenticated).toBe(true);
    expect(request.user).toMatchObject({
      id: 'u1',
      amr: ['pat'],
      scopes: ['usage:write'],
      patId: 't1',
      roles: [UserRole.ADMIN],
    });
  });

  it('rejects revoked or inactive PAT JWTs', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'u1',
      amr: ['pat'],
      patId: 't1',
      scopes: ['usage:write'],
      tv: 0,
    });
    usersRepository.findById.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      role: UserRole.ADMIN,
      lockedAt: null,
      tenantId: 'default',
      tokenVersion: 0,
    });
    personalAccessTokenService.assertPatJwtActive.mockRejectedValue(
      new UnauthorizedException('Session is no longer valid.'),
    );

    const request = { headers: { authorization: 'Bearer pat-jwt' } };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(UnauthorizedException);
  });
});
