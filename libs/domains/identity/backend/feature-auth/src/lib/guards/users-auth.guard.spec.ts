import { UserRole } from '@forepath/identity/backend';
import { runWithTenantId } from '@forepath/shared/backend';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { RevokedUserTokensRepository } from '../repositories/revoked-user-tokens.repository';
import { UsersRepository } from '../repositories/users.repository';

import { UsersAuthGuard } from './users-auth.guard';

describe('UsersAuthGuard', () => {
  let guard: UsersAuthGuard;
  let jwtService: jest.Mocked<Pick<JwtService, 'verifyAsync'>>;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let usersRepository: jest.Mocked<Pick<UsersRepository, 'findById'>>;
  let revokedUserTokensRepository: jest.Mocked<Pick<RevokedUserTokensRepository, 'isRevoked'>>;
  let originalAuthMethod: string | undefined;
  const createExecutionContext = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as Parameters<UsersAuthGuard['canActivate']>[0];

  beforeEach(() => {
    originalAuthMethod = process.env.AUTHENTICATION_METHOD;
    process.env.AUTHENTICATION_METHOD = 'users';

    jwtService = { verifyAsync: jest.fn() };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    usersRepository = { findById: jest.fn() };
    revokedUserTokensRepository = { isRevoked: jest.fn().mockResolvedValue(false) };
    const personalAccessTokenService = {
      assertPatJwtActive: jest.fn().mockResolvedValue({ scopes: ['usage:write'] }),
    };

    guard = new UsersAuthGuard(
      jwtService as unknown as JwtService,
      reflector as unknown as Reflector,
      usersRepository as unknown as UsersRepository,
      revokedUserTokensRepository as unknown as RevokedUserTokensRepository,
      personalAccessTokenService as never,
    );
  });

  afterEach(() => {
    if (originalAuthMethod !== undefined) {
      process.env.AUTHENTICATION_METHOD = originalAuthMethod;
    } else {
      delete process.env.AUTHENTICATION_METHOD;
    }

    jest.clearAllMocks();
  });

  it('rejects when token jti is revoked', async () => {
    const request = { headers: { authorization: 'Bearer valid.jwt.token' } };

    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.USER],
      tv: 1,
      jti: 'session-1',
    });
    usersRepository.findById.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      role: UserRole.USER,
      tenantId: 'default',
      lockedAt: null,
      tokenVersion: 1,
    } as never);
    revokedUserTokensRepository.isRevoked.mockResolvedValue(true);

    await expect(guard.canActivate(createExecutionContext(request))).rejects.toThrow('Session is no longer valid.');
  });

  it('rejects when token version does not match user token version', async () => {
    const request = { headers: { authorization: 'Bearer valid.jwt.token' } };

    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.USER],
      tv: 0,
    });
    usersRepository.findById.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      role: UserRole.USER,
      tenantId: 'default',
      lockedAt: null,
      tokenVersion: 1,
    } as never);

    await expect(guard.canActivate(createExecutionContext(request))).rejects.toThrow('Session is no longer valid.');
  });

  it('accepts legacy JWT without tv claim when user token version is 0', async () => {
    const request = { headers: { authorization: 'Bearer valid.jwt.token' } };

    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.USER],
    });
    usersRepository.findById.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      role: UserRole.USER,
      tenantId: 'default',
      lockedAt: null,
      tokenVersion: 0,
    } as never);

    const ok = await guard.canActivate(createExecutionContext(request));

    expect(ok).toBe(true);
  });

  it('allows request when JWT is valid and user is not locked', async () => {
    const request = { headers: { authorization: 'Bearer valid.jwt.token' } };

    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.USER],
    });
    usersRepository.findById.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      role: UserRole.USER,
      tenantId: 'default',
      lockedAt: null,
    } as never);

    const ok = await guard.canActivate(createExecutionContext(request));

    expect(ok).toBe(true);
    expect(request['user']).toEqual({
      id: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.USER],
      amr: ['pwd'],
      scopes: undefined,
      patId: undefined,
      jti: undefined,
      exp: undefined,
    });
  });

  it('uses live DB role instead of JWT roles claim (demotion)', async () => {
    const request = { headers: { authorization: 'Bearer valid.jwt.token' } };
    const personalAccessTokenService = {
      assertPatJwtActive: jest.fn().mockResolvedValue({ scopes: ['invoices:read'] }),
    };

    guard = new UsersAuthGuard(
      jwtService as unknown as JwtService,
      reflector as unknown as Reflector,
      usersRepository as unknown as UsersRepository,
      revokedUserTokensRepository as unknown as RevokedUserTokensRepository,
      personalAccessTokenService as never,
    );

    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.ADMIN],
      amr: ['pat'],
      scopes: ['invoices:read'],
      patId: 'pat-1',
      tv: 1,
    });
    usersRepository.findById.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      role: UserRole.USER,
      tenantId: 'default',
      lockedAt: null,
      tokenVersion: 1,
    } as never);

    const ok = await guard.canActivate(createExecutionContext(request));

    expect(ok).toBe(true);
    expect(request['user']).toEqual(
      expect.objectContaining({
        roles: [UserRole.USER],
        amr: ['pat'],
        scopes: ['invoices:read'],
      }),
    );
  });

  it('rejects when user tenant does not match request tenant', async () => {
    const request = { headers: { authorization: 'Bearer valid.jwt.token' } };

    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.USER],
    });
    usersRepository.findById.mockResolvedValue({
      id: 'user-1',
      tenantId: 'default',
      lockedAt: null,
    } as never);

    await runWithTenantId('other', async () => {
      await expect(guard.canActivate(createExecutionContext(request))).rejects.toThrow('Session is no longer valid.');
    });
  });

  it('rejects when user is locked', async () => {
    const request = { headers: { authorization: 'Bearer valid.jwt.token' } };

    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.USER],
    });
    usersRepository.findById.mockResolvedValue({
      id: 'user-1',
      lockedAt: new Date(),
    } as never);

    await expect(guard.canActivate(createExecutionContext(request))).rejects.toThrow(
      'This account is locked. Please contact an administrator.',
    );
  });

  it('rejects when user no longer exists', async () => {
    const request = { headers: { authorization: 'Bearer valid.jwt.token' } };

    jwtService.verifyAsync.mockResolvedValue({
      sub: 'missing',
      email: 'a@b.com',
      roles: [UserRole.USER],
    });
    usersRepository.findById.mockResolvedValue(null);

    await expect(guard.canActivate(createExecutionContext(request))).rejects.toThrow('Session is no longer valid.');
  });

  it('skips JWT path when request.user is already set', async () => {
    const request = {
      headers: {},
      user: { id: 'api-key-user', roles: ['admin'] },
    };
    const ok = await guard.canActivate(createExecutionContext(request));

    expect(ok).toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    expect(usersRepository.findById).not.toHaveBeenCalled();
  });

  it('allows Bull Board paths without JWT (HTTP Basic on board routes)', async () => {
    const request = {
      originalUrl: '/admin/queues/api/queues/agent-controller/jobs/clean',
      headers: { authorization: 'Basic YWRtaW46YnVsbG1x' },
    };
    const ok = await guard.canActivate(createExecutionContext(request));

    expect(ok).toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('allows public routes without JWT', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    const ok = await guard.canActivate(createExecutionContext({ headers: {} }));

    expect(ok).toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('under keycloak requires synced user id without verifying JWT locally', async () => {
    process.env.AUTHENTICATION_METHOD = 'keycloak';

    await expect(guard.canActivate(createExecutionContext({ headers: {} }))).rejects.toThrow(
      'Missing or invalid authorization token',
    );

    const ok = await guard.canActivate(
      createExecutionContext({ headers: {}, user: { id: 'synced-user', roles: ['admin'] } }),
    );

    expect(ok).toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('under keycloak accepts patAuthenticated sessions', async () => {
    process.env.AUTHENTICATION_METHOD = 'keycloak';

    const ok = await guard.canActivate(
      createExecutionContext({ headers: {}, patAuthenticated: true, user: { id: 'u1', amr: ['pat'] } }),
    );

    expect(ok).toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects when authorization token is missing', async () => {
    await expect(guard.canActivate(createExecutionContext({ headers: {} }))).rejects.toThrow(
      'Missing or invalid authorization token',
    );
  });

  it('rejects when JWT verification fails with a generic error', async () => {
    const request = { headers: { authorization: 'Bearer bad.token' } };

    jwtService.verifyAsync.mockRejectedValue(new Error('jwt malformed'));

    await expect(guard.canActivate(createExecutionContext(request))).rejects.toThrow('Invalid or expired token');
  });

  it('rejects PAT JWT when underlying token was revoked', async () => {
    const request = { headers: { authorization: 'Bearer valid.jwt.token' } };
    const personalAccessTokenService = {
      assertPatJwtActive: jest.fn().mockRejectedValue(new UnauthorizedException('Session is no longer valid.')),
    };

    guard = new UsersAuthGuard(
      jwtService as unknown as JwtService,
      reflector as unknown as Reflector,
      usersRepository as unknown as UsersRepository,
      revokedUserTokensRepository as unknown as RevokedUserTokensRepository,
      personalAccessTokenService as never,
    );

    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.ADMIN],
      amr: ['pat'],
      scopes: ['usage:write'],
      patId: 'pat-1',
      tv: 1,
      jti: 'session-1',
    });
    usersRepository.findById.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      role: UserRole.USER,
      tenantId: 'default',
      lockedAt: null,
      tokenVersion: 1,
    } as never);

    await expect(guard.canActivate(createExecutionContext(request))).rejects.toThrow('Session is no longer valid.');
    expect(personalAccessTokenService.assertPatJwtActive).toHaveBeenCalledWith('pat-1', 'user-1', ['usage:write']);
  });

  it('uses request.tenantId when validating user tenant', async () => {
    const request = {
      headers: { authorization: 'Bearer valid.jwt.token' },
      tenantId: 'acme',
    };

    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.USER],
    });
    usersRepository.findById.mockResolvedValue({
      id: 'user-1',
      tenantId: 'default',
      lockedAt: null,
    } as never);

    await expect(guard.canActivate(createExecutionContext(request))).rejects.toThrow('Session is no longer valid.');
  });
});
