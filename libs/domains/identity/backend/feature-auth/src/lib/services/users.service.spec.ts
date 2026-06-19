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
  };
  const mockEmailService = {
    sendConfirmationEmail: jest.fn(),
  };
  const mockStatisticsService = {
    recordEntityCreated: jest.fn().mockResolvedValue(undefined),
    recordEntityUpdated: jest.fn().mockResolvedValue(undefined),
    recordEntityDeleted: jest.fn().mockResolvedValue(undefined),
  };
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(mockUsersRepository as any, mockEmailService as any, mockStatisticsService as any);
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
});
