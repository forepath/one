import { UserRole } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { UsersService } from './users.service';

describe('UsersService', () => {
  const mockUsersRepository = {
    findById: jest.fn(),
    findByIdForTenant: jest.fn(),
    update: jest.fn(),
    countByTenant: jest.fn(),
    count: jest.fn(),
    findAll: jest.fn(),
    findByEmail: jest.fn(),
    create: jest.fn(),
    createWithTenantBootstrap: jest.fn(),
    remove: jest.fn(),
    incrementTokenVersion: jest.fn(),
  };
  const mockStatisticsService = {
    recordEntityCreated: jest.fn().mockResolvedValue(undefined),
    recordEntityUpdated: jest.fn().mockResolvedValue(undefined),
    recordEntityDeleted: jest.fn().mockResolvedValue(undefined),
  };
  const mockEmailDispatcher = {
    publishEmail: jest.fn(),
  };
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmailDispatcher.publishEmail.mockResolvedValue(undefined);
    service = new UsersService(
      mockUsersRepository as any,
      mockStatisticsService as any,
      null,
      mockEmailDispatcher as any,
    );
  });

  it('locks a target user by setting lockedAt', async () => {
    mockUsersRepository.findByIdForTenant.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: UserRole.USER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      lockedAt: null,
    });
    mockUsersRepository.update.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: UserRole.USER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      lockedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    const result = await service.lockUser('user-1', 'admin-1');

    expect(mockUsersRepository.update).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ lockedAt: expect.any(Date) }),
    );
    expect(result.lockedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('unlocks a target user by setting lockedAt to null', async () => {
    mockUsersRepository.findByIdForTenant.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: UserRole.USER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      lockedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    mockUsersRepository.update.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: UserRole.USER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      lockedAt: null,
    });

    const result = await service.unlockUser('user-1', 'admin-1');

    expect(mockUsersRepository.update).toHaveBeenCalledWith('user-1', { lockedAt: null });
    expect(result.lockedAt).toBeNull();
  });

  it('rejects self-lock', async () => {
    await expect(service.lockUser('user-1', 'user-1')).rejects.toThrow(BadRequestException);
    await expect(service.lockUser('user-1', 'user-1')).rejects.toThrow('You cannot lock your own account');
    expect(mockUsersRepository.findByIdForTenant).not.toHaveBeenCalled();
  });

  it('rejects self-unlock', async () => {
    await expect(service.unlockUser('user-1', 'user-1')).rejects.toThrow(BadRequestException);
    await expect(service.unlockUser('user-1', 'user-1')).rejects.toThrow('You cannot unlock your own account');
    expect(mockUsersRepository.findByIdForTenant).not.toHaveBeenCalled();
  });

  it('throws not found when lock target does not exist', async () => {
    mockUsersRepository.findByIdForTenant.mockResolvedValue(null);

    await expect(service.lockUser('missing', 'admin-1')).rejects.toThrow(NotFoundException);
    await expect(service.lockUser('missing', 'admin-1')).rejects.toThrow('User not found');
  });

  it('invalidates sessions when admin updates password', async () => {
    mockUsersRepository.findByIdForTenant.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: UserRole.USER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    mockUsersRepository.update.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: UserRole.USER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    mockUsersRepository.incrementTokenVersion.mockResolvedValue(1);

    await service.update('user-1', { password: 'new-secret' });

    expect(mockUsersRepository.incrementTokenVersion).toHaveBeenCalledWith('user-1');
  });

  it('increments token version when role changes', async () => {
    mockUsersRepository.findByIdForTenant.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: UserRole.ADMIN,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    mockUsersRepository.update.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: UserRole.USER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    mockUsersRepository.incrementTokenVersion.mockResolvedValue(1);

    await service.update('user-1', { role: UserRole.USER });

    expect(mockUsersRepository.incrementTokenVersion).toHaveBeenCalledWith('user-1');
  });

  it('publishes confirmation email when creating a non-first user', async () => {
    mockUsersRepository.findByEmail.mockResolvedValue(null);
    mockUsersRepository.createWithTenantBootstrap.mockImplementation(async (build: (first: boolean) => object) => ({
      user: {
        id: 'user-2',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...build(false),
      },
      isFirstUser: false,
    }));
    mockUsersRepository.update.mockResolvedValue({
      id: 'user-2',
      email: 'new@example.com',
      role: UserRole.USER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await service.create({ email: 'new@example.com', password: 'secret-pass' });

    expect(mockEmailDispatcher.publishEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'user.email_confirmation_requested',
        to: 'new@example.com',
        templateKey: 'email-confirmation',
        templateContext: expect.objectContaining({ code: expect.any(String) }),
      }),
    );
  });

  it('does not publish confirmation email when creating the first user', async () => {
    mockUsersRepository.findByEmail.mockResolvedValue(null);
    mockUsersRepository.createWithTenantBootstrap.mockImplementation(async (build: (first: boolean) => object) => ({
      user: {
        id: 'user-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...build(true),
      },
      isFirstUser: true,
    }));

    const created = await service.create({ email: 'admin@example.com', password: 'secret-pass' });

    expect(mockEmailDispatcher.publishEmail).not.toHaveBeenCalled();
    // The first user of the tenant becomes admin and is confirmed immediately (decided inside the bootstrap lock).
    expect(created.role).toBe(UserRole.ADMIN);

    const build = mockUsersRepository.createWithTenantBootstrap.mock.calls[0][0] as (first: boolean) => {
      role: UserRole;
      emailConfirmedAt?: Date;
    };

    expect(build(false).role).toBe(UserRole.USER);
    expect(build(false).emailConfirmedAt).toBeUndefined();
    expect(build(true).emailConfirmedAt).toBeInstanceOf(Date);
  });

  it('publishes confirmation email when email changes', async () => {
    mockUsersRepository.findByIdForTenant.mockResolvedValue({
      id: 'user-1',
      email: 'old@example.com',
      role: UserRole.USER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    mockUsersRepository.findByEmail.mockResolvedValue(null);
    mockUsersRepository.update.mockResolvedValue({
      id: 'user-1',
      email: 'new@example.com',
      role: UserRole.USER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    await service.update('user-1', { email: 'new@example.com' });

    expect(mockEmailDispatcher.publishEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'user.email_confirmation_requested',
        to: 'new@example.com',
        templateKey: 'email-confirmation',
        templateContext: expect.objectContaining({ code: expect.any(String) }),
      }),
    );
  });

  describe('admin email confirmation options', () => {
    const mockBootstrap = (first = false) =>
      mockUsersRepository.createWithTenantBootstrap.mockImplementation(async (build: (first: boolean) => object) => ({
        user: {
          id: 'user-2',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          ...build(first),
        },
        isFirstUser: first,
      }));
    const existingUser = (overrides: Record<string, unknown> = {}) => ({
      id: 'user-1',
      email: 'old@example.com',
      role: UserRole.USER,
      emailConfirmedAt: new Date('2026-01-01T00:00:00.000Z'),
      emailConfirmationToken: undefined,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    });

    beforeEach(() => {
      mockUsersRepository.findByEmail.mockResolvedValue(null);
    });

    it('creates a pre-confirmed user without a code or email when emailConfirmed is true', async () => {
      mockBootstrap();

      const created = await service.create({
        email: 'managed@example.com',
        password: 'secret-pass',
        emailConfirmed: true,
      });

      expect(created.emailConfirmedAt).toEqual(expect.any(String));
      expect(created.role).toBe(UserRole.USER);
      expect(mockUsersRepository.update).not.toHaveBeenCalled();
      expect(mockEmailDispatcher.publishEmail).not.toHaveBeenCalled();
    });

    it('creates an unconfirmed user without a code or email when sendConfirmationEmail is false', async () => {
      mockBootstrap();

      const created = await service.create({
        email: 'managed@example.com',
        password: 'secret-pass',
        sendConfirmationEmail: false,
      });

      expect(created.emailConfirmedAt).toBeUndefined();
      expect(mockUsersRepository.update).not.toHaveBeenCalled();
      expect(mockEmailDispatcher.publishEmail).not.toHaveBeenCalled();
    });

    it('still sends the confirmation email when emailConfirmed is false and sendConfirmationEmail is true', async () => {
      mockBootstrap();
      mockUsersRepository.update.mockResolvedValue(existingUser());

      await service.create({
        email: 'new@example.com',
        password: 'secret-pass',
        emailConfirmed: false,
        sendConfirmationEmail: true,
      });

      expect(mockUsersRepository.update).toHaveBeenCalledWith('user-2', {
        emailConfirmationToken: expect.any(String),
      });
      expect(mockEmailDispatcher.publishEmail).toHaveBeenCalledTimes(1);
    });

    it('keeps a changed email confirmed without sending a code when emailConfirmed is true', async () => {
      mockUsersRepository.findByIdForTenant.mockResolvedValue(existingUser());
      mockUsersRepository.update.mockResolvedValue(existingUser({ email: 'new@example.com' }));

      await service.update('user-1', { email: 'new@example.com', emailConfirmed: true });

      expect(mockUsersRepository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          email: 'new@example.com',
          emailConfirmedAt: expect.any(Date),
          emailConfirmationToken: null,
        }),
      );
      expect(mockEmailDispatcher.publishEmail).not.toHaveBeenCalled();
    });

    it('unconfirms a changed email and clears any old code when sendConfirmationEmail is false', async () => {
      mockUsersRepository.findByIdForTenant.mockResolvedValue(existingUser({ emailConfirmationToken: 'old-hash' }));
      mockUsersRepository.update.mockResolvedValue(existingUser({ email: 'new@example.com', emailConfirmedAt: null }));

      await service.update('user-1', { email: 'new@example.com', sendConfirmationEmail: false });

      expect(mockUsersRepository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ email: 'new@example.com', emailConfirmedAt: null, emailConfirmationToken: null }),
      );
      expect(mockEmailDispatcher.publishEmail).not.toHaveBeenCalled();
    });

    it('ignores the options when the email does not change', async () => {
      mockUsersRepository.findByIdForTenant.mockResolvedValue(existingUser({ emailConfirmedAt: undefined }));
      mockUsersRepository.update.mockResolvedValue(existingUser({ emailConfirmedAt: undefined }));

      await service.update('user-1', { email: 'OLD@example.com', emailConfirmed: true, role: UserRole.USER });

      const data = mockUsersRepository.update.mock.calls[0][1];

      expect(data).not.toHaveProperty('emailConfirmedAt');
      expect(data).not.toHaveProperty('emailConfirmationToken');
      expect(mockEmailDispatcher.publishEmail).not.toHaveBeenCalled();
    });

    it('confirms an unconfirmed user and clears the outstanding code', async () => {
      mockUsersRepository.findByIdForTenant.mockResolvedValue(
        existingUser({ emailConfirmedAt: undefined, emailConfirmationToken: 'hash' }),
      );
      mockUsersRepository.update.mockResolvedValue(
        existingUser({ emailConfirmedAt: new Date('2026-01-03T00:00:00.000Z') }),
      );

      const result = await service.confirmEmail('user-1');

      expect(mockUsersRepository.update).toHaveBeenCalledWith('user-1', {
        emailConfirmedAt: expect.any(Date),
        emailConfirmationToken: null,
      });
      expect(result.emailConfirmedAt).toBe('2026-01-03T00:00:00.000Z');
      expect(mockStatisticsService.recordEntityUpdated).toHaveBeenCalledWith(
        'user',
        'user-1',
        { role: UserRole.USER },
        undefined,
      );
    });

    it('returns an already confirmed user unchanged', async () => {
      mockUsersRepository.findByIdForTenant.mockResolvedValue(existingUser());

      const result = await service.confirmEmail('user-1');

      expect(mockUsersRepository.update).not.toHaveBeenCalled();
      expect(result.emailConfirmedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('throws not found when the confirm target is not in the tenant', async () => {
      mockUsersRepository.findByIdForTenant.mockResolvedValue(null);

      await expect(service.confirmEmail('other-tenant-user')).rejects.toThrow(NotFoundException);
      expect(mockUsersRepository.update).not.toHaveBeenCalled();
    });
  });

  it('clears TOTP fields and invalidates sessions on admin clearTotp', async () => {
    mockUsersRepository.findByIdForTenant.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      totpSecret: 'SECRET',
      totpEnabledAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    mockUsersRepository.update.mockResolvedValue({});
    mockUsersRepository.incrementTokenVersion.mockResolvedValue(2);

    const result = await service.clearTotp('user-1');

    expect(mockUsersRepository.update).toHaveBeenCalledWith('user-1', {
      totpSecret: null,
      totpEnabledAt: null,
    });
    expect(mockUsersRepository.incrementTokenVersion).toHaveBeenCalledWith('user-1');
    expect(result.message).toContain('removed');
  });

  describe('manager restrictions', () => {
    const userEntity = (role: UserRole, id = `${role}-target`) => ({
      id,
      email: `${id}@example.com`,
      role,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      lockedAt: null,
      emailConfirmedAt: null,
      totpSecret: 'SECRET',
      totpEnabledAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const mockCreate = () =>
      mockUsersRepository.createWithTenantBootstrap.mockImplementation(async (build: (first: boolean) => object) => ({
        user: {
          id: 'created',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          ...build(false),
        },
        isFirstUser: false,
      }));

    beforeEach(() => {
      mockUsersRepository.findByEmail.mockResolvedValue(null);
      mockUsersRepository.update.mockImplementation(async (id: string, data: object) => ({
        ...userEntity(UserRole.USER, id),
        ...data,
      }));
    });

    it('lets a manager create a regular user (explicit or default role)', async () => {
      mockCreate();

      await expect(
        service.create({ email: 'a@example.com', password: 'secret-pass', role: UserRole.USER }, UserRole.MANAGER),
      ).resolves.toEqual(expect.objectContaining({ role: UserRole.USER }));
      await expect(
        service.create({ email: 'b@example.com', password: 'secret-pass' }, UserRole.MANAGER),
      ).resolves.toEqual(expect.objectContaining({ role: UserRole.USER }));
    });

    it('never lets a manager-created account become the bootstrap admin', async () => {
      mockCreate();
      await service.create({ email: 'a@example.com', password: 'secret-pass' }, UserRole.MANAGER);

      const build = mockUsersRepository.createWithTenantBootstrap.mock.calls[0][0] as (first: boolean) => {
        role: UserRole;
      };

      expect(build(true).role).toBe(UserRole.USER);
    });

    it.each([UserRole.MANAGER, UserRole.ADMIN, UserRole.CONTROLLER])(
      'rejects a manager creating a %s account',
      async (role) => {
        await expect(
          service.create({ email: 'x@example.com', password: 'secret-pass', role }, UserRole.MANAGER),
        ).rejects.toThrow(ForbiddenException);
        expect(mockUsersRepository.createWithTenantBootstrap).not.toHaveBeenCalled();
      },
    );

    it('lets admins create managers', async () => {
      mockCreate();

      await expect(
        service.create({ email: 'm@example.com', password: 'secret-pass', role: UserRole.MANAGER }, UserRole.ADMIN),
      ).resolves.toEqual(expect.objectContaining({ role: UserRole.MANAGER }));
    });

    it('lets a manager update a regular user but not promote them', async () => {
      mockUsersRepository.findByIdForTenant.mockResolvedValue(userEntity(UserRole.USER));

      await expect(
        service.update('user-target', { email: 'new@example.com' }, UserRole.MANAGER),
      ).resolves.toBeDefined();
      await expect(service.update('user-target', { role: UserRole.USER }, UserRole.MANAGER)).resolves.toBeDefined();

      mockUsersRepository.update.mockClear();

      for (const role of [UserRole.MANAGER, UserRole.ADMIN]) {
        await expect(service.update('user-target', { role }, UserRole.MANAGER)).rejects.toThrow(ForbiddenException);
      }

      expect(mockUsersRepository.update).not.toHaveBeenCalled();
    });

    it.each([UserRole.MANAGER, UserRole.ADMIN])('denies every manager action on %s accounts', async (role) => {
      mockUsersRepository.findByIdForTenant.mockResolvedValue(userEntity(role));

      await expect(service.update('t', { password: 'another-pass' }, UserRole.MANAGER)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.update('t', { role: UserRole.USER }, UserRole.MANAGER)).rejects.toThrow(ForbiddenException);
      await expect(service.lockUser('t', 'manager-1', UserRole.MANAGER)).rejects.toThrow(ForbiddenException);
      await expect(service.unlockUser('t', 'manager-1', UserRole.MANAGER)).rejects.toThrow(ForbiddenException);
      await expect(service.confirmEmail('t', UserRole.MANAGER)).rejects.toThrow(ForbiddenException);
      await expect(service.clearTotp('t', UserRole.MANAGER)).rejects.toThrow(ForbiddenException);
      await expect(service.remove('t', 'manager-1', UserRole.MANAGER)).rejects.toThrow(ForbiddenException);

      expect(mockUsersRepository.update).not.toHaveBeenCalled();
      expect(mockUsersRepository.remove).not.toHaveBeenCalled();
      expect(mockUsersRepository.incrementTokenVersion).not.toHaveBeenCalled();
    });

    it('allows every manager action on regular user accounts', async () => {
      mockUsersRepository.findByIdForTenant.mockResolvedValue(userEntity(UserRole.USER));

      await expect(service.lockUser('t', 'manager-1', UserRole.MANAGER)).resolves.toBeDefined();
      await expect(service.unlockUser('t', 'manager-1', UserRole.MANAGER)).resolves.toBeDefined();
      await expect(service.confirmEmail('t', UserRole.MANAGER)).resolves.toBeDefined();
      await expect(service.clearTotp('t', UserRole.MANAGER)).resolves.toBeDefined();
      await expect(service.remove('t', 'manager-1', UserRole.MANAGER)).resolves.toBeUndefined();
      expect(mockUsersRepository.remove).toHaveBeenCalledWith('t');
    });

    it('lets admins act on manager and admin accounts', async () => {
      mockUsersRepository.findByIdForTenant.mockResolvedValue(userEntity(UserRole.MANAGER));

      await expect(service.update('t', { role: UserRole.ADMIN }, UserRole.ADMIN)).resolves.toBeDefined();
      await expect(service.lockUser('t', 'admin-1', UserRole.ADMIN)).resolves.toBeDefined();
      await expect(service.remove('t', 'admin-1', UserRole.ADMIN)).resolves.toBeUndefined();
    });

    it('denies regular users (defense in depth behind the role guard)', async () => {
      mockUsersRepository.findByIdForTenant.mockResolvedValue(userEntity(UserRole.USER));

      await expect(service.lockUser('t', 'user-1', UserRole.USER)).rejects.toThrow(ForbiddenException);
      await expect(
        service.create({ email: 'x@example.com', password: 'secret-pass', role: UserRole.USER }, UserRole.USER),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.create({ email: 'y@example.com', password: 'secret-pass' }, UserRole.USER)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.update('t', { email: 'z@example.com' }, UserRole.USER)).rejects.toThrow(ForbiddenException);
    });
  });
});
