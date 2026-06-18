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
  const usersRepository = { findById: jest.fn() };
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
    usersRepository.findById.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
  });

  it('create rejects duplicate profile for user', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue(profile);

    await expect(
      service.create({ userId: 'user-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('create rejects unknown user', async () => {
    usersRepository.findById.mockResolvedValue(null);

    await expect(
      service.create({ userId: 'user-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('delete rejects when user has invoices', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue(profile);
    invoicesRepository.countByUserId.mockResolvedValue(1);

    await expect(service.delete('profile-1')).rejects.toThrow(BadRequestException);
  });
});
