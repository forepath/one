import { BadRequestException, NotFoundException } from '@nestjs/common';

import { CustomerProfilesAdminService } from './customer-profiles-admin.service';

describe('CustomerProfilesAdminService', () => {
  const customerProfilesRepository = {
    findAll: jest.fn(),
    findByIdOrThrow: jest.fn(),
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const customerProfilesService = { isProfileComplete: jest.fn().mockReturnValue(true) };
  const usersRepository = { findByIdForTenant: jest.fn() };
  const invoicesRepository = { countByUserId: jest.fn() };
  const subscriptionsRepository = { findAllByUser: jest.fn() };

  const service = new CustomerProfilesAdminService(
    customerProfilesRepository as never,
    customerProfilesService as never,
    usersRepository as never,
    invoicesRepository as never,
    subscriptionsRepository as never,
  );

  const profile = {
    id: 'profile-1',
    userId: 'user-1',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    usersRepository.findByIdForTenant.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);
  });

  it('create rejects duplicate profile for user', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue(profile);

    await expect(
      service.create({ userId: 'user-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('create rejects unknown user', async () => {
    usersRepository.findByIdForTenant.mockResolvedValue(null);

    await expect(
      service.create({ userId: 'user-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('delete rejects when user has invoices', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue(profile);
    invoicesRepository.countByUserId.mockResolvedValue(1);

    await expect(service.delete('profile-1')).rejects.toThrow(BadRequestException);
  });

  it('delete rejects when user has subscriptions', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue(profile);
    invoicesRepository.countByUserId.mockResolvedValue(0);
    subscriptionsRepository.findAllByUser.mockResolvedValue([{ id: 'sub-1' }]);

    await expect(service.delete('profile-1')).rejects.toThrow(BadRequestException);
  });

  it('delete removes profile when user has no invoices or subscriptions', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue(profile);
    invoicesRepository.countByUserId.mockResolvedValue(0);
    subscriptionsRepository.findAllByUser.mockResolvedValue([]);

    await service.delete('profile-1');

    expect(customerProfilesRepository.delete).toHaveBeenCalledWith('profile-1');
  });

  it('list maps profiles with user emails', async () => {
    customerProfilesRepository.findAll.mockResolvedValue({ items: [profile], total: 1 });

    const result = await service.list(10, 0);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].userEmail).toBe('user@example.com');
    expect(result.total).toBe(1);
  });

  it('getById returns profile with completeness', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue(profile);

    const result = await service.getById('profile-1');

    expect(result.id).toBe('profile-1');
    expect(result.isComplete).toBe(true);
    expect(result.userEmail).toBe('user@example.com');
  });

  it('create persists profile for valid user', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue(null);
    customerProfilesRepository.create.mockResolvedValue(profile);

    const result = await service.create({
      userId: 'user-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
    });

    expect(result.userId).toBe('user-1');
    expect(customerProfilesRepository.create).toHaveBeenCalled();
  });

  it('update persists profile changes', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue(profile);
    customerProfilesRepository.update.mockResolvedValue({ ...profile, country: 'DE' });

    const result = await service.update('profile-1', {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      country: 'DE',
    });

    expect(result.country).toBe('DE');
  });
});
