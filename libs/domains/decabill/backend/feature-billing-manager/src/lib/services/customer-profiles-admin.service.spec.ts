import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

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
  const customerProfilesService = {
    isProfileComplete: jest.fn().mockReturnValue(true),
    upsert: jest.fn(),
    revalidateVatId: jest.fn(),
    markVatIdValidatedByAdmin: jest.fn(),
  };
  const usersRepository = { findByIdForTenant: jest.fn() };
  const invoicesRepository = { countByUserId: jest.fn() };
  const subscriptionsRepository = { findAllByUser: jest.fn() };
  const customerTrustScoreService = {
    ensureFreshSnapshot: jest.fn(),
    getSummaryForProfileId: jest.fn(),
    recomputeForProfileId: jest.fn(),
  };
  const billingNotificationPublisher = { publish: jest.fn() };
  const datevDebtorAccountsRepository = { findByTenantAndUserId: jest.fn() };
  const billingSearchIndexService = { scheduleUpsert: jest.fn(), scheduleDelete: jest.fn() };
  const offerProfileSummaryService = {
    getAdminCountsByStatus: jest.fn().mockResolvedValue({
      draft: 0,
      archived: 1,
      accepted: 0,
      declined: 0,
      expired: 0,
      revoked: 0,
    }),
  };

  const service = new CustomerProfilesAdminService(
    customerProfilesRepository as never,
    customerProfilesService as never,
    usersRepository as never,
    invoicesRepository as never,
    subscriptionsRepository as never,
    customerTrustScoreService as never,
    billingNotificationPublisher as never,
    datevDebtorAccountsRepository as never,
    billingSearchIndexService as never,
    offerProfileSummaryService as never,
  );

  const profile = {
    id: 'profile-1',
    userId: 'user-1',
    customerNumber: 'CUS-000001',
    numberScope: '__shared__',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    customData: {} as Record<string, string>,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    usersRepository.findByIdForTenant.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);
    customerProfilesService.upsert.mockReset();
    customerTrustScoreService.ensureFreshSnapshot.mockImplementation(async (value: unknown) => value);
    datevDebtorAccountsRepository.findByTenantAndUserId.mockResolvedValue(null);
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
    expect(result.items[0].customerNumber).toBe('CUS-000001');
    expect(result.total).toBe(1);
    expect(result.items[0]).not.toHaveProperty('customData');
    expect(result.items[0]).not.toHaveProperty('datevDebtorNumber');
  });

  it('getById returns profile with completeness, customData, and null DATEV debtor', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue({
      ...profile,
      customData: { erpId: 'ERP-1' },
    });

    const result = await service.getById('profile-1');

    expect(result.id).toBe('profile-1');
    expect(result.isComplete).toBe(true);
    expect(result.userEmail).toBe('user@example.com');
    expect(result.customerNumber).toBe('CUS-000001');
    expect(result.numberScope).toBe('__shared__');
    expect(result.datevDebtorNumber).toBeNull();
    expect(result.customData).toEqual({ erpId: 'ERP-1' });
    expect(result.offerCounts).toEqual({
      draft: 0,
      archived: 1,
      accepted: 0,
      declined: 0,
      expired: 0,
      revoked: 0,
    });
  });

  it('getById includes datevDebtorNumber when DATEV debtor account exists', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue(profile);
    datevDebtorAccountsRepository.findByTenantAndUserId.mockResolvedValue({ debtorNumber: 10001 });

    const result = await service.getById('profile-1');

    expect(result.datevDebtorNumber).toBe(10001);
    expect(datevDebtorAccountsRepository.findByTenantAndUserId).toHaveBeenCalledWith('default', 'user-1');
  });

  it('create persists profile for valid user without customData on customer response', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue(null);
    customerProfilesService.upsert.mockResolvedValue({ ...profile, customData: { secret: 'x' } });

    const result = await service.create({
      userId: 'user-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
    });

    expect(result.userId).toBe('user-1');
    expect(result).not.toHaveProperty('customData');
    expect(customerProfilesService.upsert).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      }),
    );
  });

  it('update persists profile changes without customData on customer response', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue(profile);
    customerProfilesService.upsert.mockResolvedValue({ ...profile, country: 'DE', customData: { secret: 'x' } });

    const result = await service.update('profile-1', {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      country: 'DE',
    } as never);

    expect(result.country).toBe('DE');
    expect(result).not.toHaveProperty('customData');
    expect(customerProfilesService.upsert).toHaveBeenCalledWith('user-1', expect.objectContaining({ country: 'DE' }));
  });

  it('getTrustScore returns recomputed trust detail', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue(profile);
    customerTrustScoreService.getSummaryForProfileId.mockResolvedValue({
      score: 125,
      level: 'green',
      baseScore: 100,
      factors: [],
      computedAt: new Date(),
      sources: ['internal_billing'],
    });

    const result = await service.getTrustScore('profile-1');

    expect(result.profileId).toBe('profile-1');
    expect(result.score).toBe(125);
    expect(customerTrustScoreService.getSummaryForProfileId).toHaveBeenCalledWith('profile-1');
  });

  it('recomputeTrustScore forces a fresh trust snapshot', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue(profile);
    customerTrustScoreService.recomputeForProfileId.mockResolvedValue({
      score: 118,
      level: 'yellow',
      baseScore: 100,
      factors: [],
      computedAt: new Date(),
      sources: ['internal_billing'],
    });

    const result = await service.recomputeTrustScore('profile-1');

    expect(result.profileId).toBe('profile-1');
    expect(result.score).toBe(118);
    expect(customerTrustScoreService.recomputeForProfileId).toHaveBeenCalledWith('profile-1');
  });

  it('addCustomData stores a new key and publishes webhook without value', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue({ ...profile, customData: {} });
    customerProfilesRepository.update.mockResolvedValue({
      ...profile,
      customData: { erpId: 'ERP-1' },
    });

    const result = await service.addCustomData('profile-1', 'erpId', 'ERP-1');

    expect(result.customData).toEqual({ erpId: 'ERP-1' });
    expect(customerProfilesRepository.update).toHaveBeenCalledWith('profile-1', {
      customData: { erpId: 'ERP-1' },
    });
    expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
      'customer_profile.custom_data_added',
      { profileId: 'profile-1', userId: 'user-1', key: 'erpId' },
      'user-1',
    );
    expect(JSON.stringify(billingNotificationPublisher.publish.mock.calls[0][1])).not.toContain('ERP-1');
  });

  it('addCustomData rejects duplicate keys', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue({
      ...profile,
      customData: { erpId: 'ERP-1' },
    });

    await expect(service.addCustomData('profile-1', 'erpId', 'ERP-2')).rejects.toThrow(ConflictException);
    expect(customerProfilesRepository.update).not.toHaveBeenCalled();
  });

  it('updateCustomData updates an existing key', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue({
      ...profile,
      customData: { erpId: 'ERP-1' },
    });
    customerProfilesRepository.update.mockResolvedValue({
      ...profile,
      customData: { erpId: 'ERP-2' },
    });

    const result = await service.updateCustomData('profile-1', 'erpId', 'ERP-2');

    expect(result.customData).toEqual({ erpId: 'ERP-2' });
    expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
      'customer_profile.custom_data_updated',
      { profileId: 'profile-1', userId: 'user-1', key: 'erpId' },
      'user-1',
    );
  });

  it('updateCustomData rejects missing keys', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue({ ...profile, customData: {} });

    await expect(service.updateCustomData('profile-1', 'missing', 'x')).rejects.toThrow(NotFoundException);
  });

  it('deleteCustomData removes an existing key', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue({
      ...profile,
      customData: { erpId: 'ERP-1', other: 'y' },
    });
    customerProfilesRepository.update.mockResolvedValue({
      ...profile,
      customData: { other: 'y' },
    });

    const result = await service.deleteCustomData('profile-1', 'erpId');

    expect(result.customData).toEqual({ other: 'y' });
    expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
      'customer_profile.custom_data_deleted',
      { profileId: 'profile-1', userId: 'user-1', key: 'erpId' },
      'user-1',
    );
  });

  it('deleteCustomData rejects missing keys', async () => {
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue({ ...profile, customData: {} });

    await expect(service.deleteCustomData('profile-1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('rejects invalid custom data keys', async () => {
    await expect(service.addCustomData('profile-1', 'bad key!', 'x')).rejects.toThrow(BadRequestException);
  });
});
