import { UserRole } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException } from '@nestjs/common';

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
    mockUsersRepository.create.mockResolvedValue({
      id: 'user-2',
      email: 'new@example.com',
      role: UserRole.USER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    mockUsersRepository.update.mockResolvedValue({
      id: 'user-2',
      email: 'new@example.com',
      role: UserRole.USER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await service.create({ email: 'new@example.com', password: 'secret-pass' }, false);

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
    mockUsersRepository.create.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await service.create({ email: 'admin@example.com', password: 'secret-pass' }, true);

    expect(mockEmailDispatcher.publishEmail).not.toHaveBeenCalled();
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
});
