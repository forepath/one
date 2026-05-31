import { UserRole } from '@forepath/identity/backend';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { UsersRepository } from '../repositories/users.repository';

import { UsersAuthGuard } from './users-auth.guard';

describe('UsersAuthGuard', () => {
  let guard: UsersAuthGuard;
  let jwtService: jest.Mocked<Pick<JwtService, 'verifyAsync'>>;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let usersRepository: jest.Mocked<Pick<UsersRepository, 'findById'>>;
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

    guard = new UsersAuthGuard(
      jwtService as unknown as JwtService,
      reflector as unknown as Reflector,
      usersRepository as unknown as UsersRepository,
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
      lockedAt: null,
    } as never);

    const ok = await guard.canActivate(createExecutionContext(request));

    expect(ok).toBe(true);
    expect(request['user']).toEqual({
      id: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.USER],
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
});
