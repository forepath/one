import { UserRole } from '@forepath/identity/backend';
import { UnauthorizedException } from '@nestjs/common';

import { AuthService } from './auth.service';

describe('AuthService', () => {
  const mockUsersRepository = {
    findByEmail: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    countByTenant: jest.fn(),
    findByIdOrThrow: jest.fn(),
    incrementTokenVersion: jest.fn(),
  };
  const mockRevokedUserTokensRepository = {
    revoke: jest.fn(),
  };
  const mockUsersService = {
    create: jest.fn(),
    validatePassword: jest.fn(),
  };
  const mockJwtService = {
    sign: jest.fn().mockReturnValue('jwt-token'),
  };
  const mockPersonalAccessTokenService = {
    verifyToken: jest.fn(),
  };
  const mockEmailDispatcher = {
    publishEmail: jest.fn(),
  };
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmailDispatcher.publishEmail.mockResolvedValue(undefined);
    service = new AuthService(
      mockUsersRepository as any,
      mockRevokedUserTokensRepository as any,
      mockUsersService as any,
      mockJwtService as any,
      mockPersonalAccessTokenService as any,
      mockEmailDispatcher as any,
    );
  });

  it('rejects login when account is locked', async () => {
    mockUsersRepository.findByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'locked@example.com',
      role: UserRole.USER,
      emailConfirmedAt: new Date('2026-01-01T00:00:00.000Z'),
      lockedAt: new Date('2026-01-02T00:00:00.000Z'),
      passwordHash: '$2b$12$hash',
    });

    await expect(service.login('locked@example.com', 'password123')).rejects.toThrow(UnauthorizedException);
    await expect(service.login('locked@example.com', 'password123')).rejects.toThrow(
      'This account is locked. Please contact an administrator.',
    );
  });

  it('returns token for unlocked confirmed user with valid password', async () => {
    mockUsersRepository.findByEmail.mockResolvedValue({
      id: 'user-2',
      email: 'active@example.com',
      role: UserRole.ADMIN,
      emailConfirmedAt: new Date('2026-01-01T00:00:00.000Z'),
      lockedAt: null,
      passwordHash: '$2b$12$hash',
      tokenVersion: 0,
    });
    mockUsersService.validatePassword.mockResolvedValue(true);

    const result = await service.login('active@example.com', 'password123');

    expect(mockUsersService.validatePassword).toHaveBeenCalledWith('password123', '$2b$12$hash');
    expect(mockJwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'user-2',
        amr: ['pwd'],
      }),
      expect.any(Object),
    );
    expect(result).toEqual({
      access_token: 'jwt-token',
      user: { id: 'user-2', email: 'active@example.com', role: UserRole.ADMIN },
    });
  });

  it('rejects personal access token secrets on interactive login', async () => {
    await expect(service.login('user@example.com', 'fp_pat_abcdefghijklmnop')).rejects.toThrow(UnauthorizedException);
    expect(mockUsersRepository.findByEmail).not.toHaveBeenCalled();
  });

  it('exchanges a personal access token for a machine JWT', async () => {
    mockPersonalAccessTokenService.verifyToken.mockResolvedValue({
      user: {
        id: 'user-3',
        email: 'pat@example.com',
        role: UserRole.ADMIN,
        tokenVersion: 0,
      },
      scopes: ['usage:write'],
      patId: 'pat-1',
    });

    const result = await service.exchangePat('fp_pat_secret');

    expect(mockJwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'user-3',
        amr: ['pat'],
        scopes: ['usage:write'],
      }),
      expect.any(Object),
    );
    expect(result).toEqual({
      access_token: 'jwt-token',
      user: { id: 'user-3', email: 'pat@example.com', role: UserRole.ADMIN },
      scopes: ['usage:write'],
    });
  });

  it('rejects login when email is not confirmed after valid password', async () => {
    mockUsersRepository.findByEmail.mockResolvedValue({
      id: 'user-unconfirmed',
      email: 'pending@example.com',
      role: UserRole.USER,
      emailConfirmedAt: null,
      lockedAt: null,
      passwordHash: '$2b$12$hash',
    });
    mockUsersService.validatePassword.mockResolvedValue(true);

    await expect(service.login('pending@example.com', 'password123')).rejects.toThrow(UnauthorizedException);
    await expect(service.login('pending@example.com', 'password123')).rejects.toThrow(
      'Email not confirmed. Please confirm your email before logging in.',
    );
    expect(mockJwtService.sign).not.toHaveBeenCalled();
  });

  it('keeps invalid credentials response for non-existing user', async () => {
    mockUsersRepository.findByEmail.mockResolvedValue(null);

    await expect(service.login('missing@example.com', 'password123')).rejects.toThrow(UnauthorizedException);
    await expect(service.login('missing@example.com', 'password123')).rejects.toThrow('Invalid email or password');
    expect(mockUsersService.validatePassword).not.toHaveBeenCalled();
  });

  it('includes token version and jwtid when signing login tokens', async () => {
    mockUsersRepository.findByEmail.mockResolvedValue({
      id: 'user-2',
      email: 'active@example.com',
      role: UserRole.ADMIN,
      emailConfirmedAt: new Date('2026-01-01T00:00:00.000Z'),
      lockedAt: null,
      passwordHash: '$2b$12$hash',
      tokenVersion: 3,
    });
    mockUsersService.validatePassword.mockResolvedValue(true);

    await service.login('active@example.com', 'password123');

    expect(mockJwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({ tv: 3 }),
      expect.objectContaining({ jwtid: expect.any(String) }),
    );
  });

  it('revokes only the current session by default on logout', async () => {
    const expiresAt = new Date('2026-12-31T00:00:00.000Z');

    await service.logout('user-1', { jti: 'session-1', tokenExpiresAt: expiresAt });

    expect(mockRevokedUserTokensRepository.revoke).toHaveBeenCalledWith('session-1', 'user-1', expiresAt);
    expect(mockUsersRepository.incrementTokenVersion).not.toHaveBeenCalled();
  });

  it('invalidates all sessions when logout requests invalidateAllSessions', async () => {
    mockUsersRepository.incrementTokenVersion.mockResolvedValue(2);

    await service.logout('user-1', { invalidateAllSessions: true, jti: 'session-1' });

    expect(mockUsersRepository.incrementTokenVersion).toHaveBeenCalledWith('user-1');
    expect(mockRevokedUserTokensRepository.revoke).not.toHaveBeenCalled();
  });

  it('invalidates sessions and returns new token on changePassword', async () => {
    mockUsersRepository.findByIdOrThrow.mockResolvedValueOnce({
      id: 'user-1',
      email: 'a@b.com',
      role: UserRole.USER,
      passwordHash: '$2b$12$hash',
    });
    mockUsersService.validatePassword.mockResolvedValue(true);
    mockUsersRepository.update.mockResolvedValue(undefined);
    mockUsersRepository.incrementTokenVersion.mockResolvedValue(2);
    mockUsersRepository.findByIdOrThrow.mockResolvedValueOnce({
      id: 'user-1',
      email: 'a@b.com',
      role: UserRole.USER,
      tokenVersion: 2,
    });

    const result = await service.changePassword('user-1', 'old-pass', 'new-pass', 'new-pass');

    expect(mockUsersRepository.incrementTokenVersion).toHaveBeenCalledWith('user-1');
    expect(mockJwtService.sign).toHaveBeenCalledWith(expect.objectContaining({ tv: 2 }), expect.any(Object));
    expect(result).toEqual({
      message: 'Password changed successfully.',
      access_token: 'jwt-token',
    });
  });

  it('invalidates all sessions via invalidateAllSessions', async () => {
    mockUsersRepository.incrementTokenVersion.mockResolvedValue(1);

    const result = await service.invalidateAllSessions('user-1');

    expect(mockUsersRepository.incrementTokenVersion).toHaveBeenCalledWith('user-1');
    expect(result).toBe(1);
  });

  it('returns emailConfirmed true for the first registered account', async () => {
    mockUsersRepository.countByTenant.mockResolvedValue(0);
    mockUsersService.create.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      emailConfirmedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await service.register('admin@example.com', 'password123');

    expect(mockUsersService.create).toHaveBeenCalledWith(
      { email: 'admin@example.com', password: 'password123', role: UserRole.ADMIN },
      true,
    );
    expect(result).toEqual({
      user: { id: 'admin-1', email: 'admin@example.com', role: UserRole.ADMIN },
      message: 'Account created successfully. You can log in immediately.',
      emailConfirmed: true,
    });
  });

  it('returns emailConfirmed false for subsequent registrations', async () => {
    mockUsersRepository.countByTenant.mockResolvedValue(1);
    mockUsersService.create.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: UserRole.USER,
      emailConfirmedAt: null,
    });

    const result = await service.register('user@example.com', 'password123');

    expect(mockUsersService.create).toHaveBeenCalledWith(
      { email: 'user@example.com', password: 'password123', role: UserRole.USER },
      false,
    );
    expect(result).toEqual({
      user: { id: 'user-1', email: 'user@example.com', role: UserRole.USER },
      message:
        'Account created. Please confirm your email before logging in. Check your inbox for the confirmation code.',
      emailConfirmed: false,
    });
  });

  it('publishes password reset email when account exists', async () => {
    mockUsersRepository.findByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: '$2b$12$hash',
    });
    mockUsersRepository.update.mockResolvedValue(undefined);

    const result = await service.requestPasswordReset('user@example.com');

    expect(mockUsersRepository.update).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        passwordResetToken: expect.any(String),
        passwordResetTokenExpiresAt: expect.any(Date),
      }),
    );
    expect(mockEmailDispatcher.publishEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'user.password_reset_requested',
        to: 'user@example.com',
        templateKey: 'password-reset',
        templateContext: expect.objectContaining({ code: expect.any(String) }),
      }),
    );
    expect(result.message).toContain('password reset code');
  });

  it('does not publish password reset email when account does not exist', async () => {
    mockUsersRepository.findByEmail.mockResolvedValue(null);

    const result = await service.requestPasswordReset('missing@example.com');

    expect(mockEmailDispatcher.publishEmail).not.toHaveBeenCalled();
    expect(result.message).toContain('password reset code');
  });
});
