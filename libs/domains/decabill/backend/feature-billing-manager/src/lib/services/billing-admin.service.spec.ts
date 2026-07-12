import { BillingAdminService } from './billing-admin.service';

describe('BillingAdminService', () => {
  const subscriptionsRepository = { countByStatus: jest.fn(), findAllForAdmin: jest.fn(), findByIdOrThrow: jest.fn() };
  const invoicesRepository = { findGlobalOpenOverdueSummary: jest.fn() };
  const openPositionsRepository = { findDistinctUserIdsWithUnbilled: jest.fn() };
  const invoiceCreationService = { getUnbilledTotalForUser: jest.fn() };
  const subscriptionService = {
    listSubscriptions: jest.fn(),
    mapManyToResponses: jest.fn(),
    cancelSubscription: jest.fn(),
    withdrawSubscription: jest.fn(),
    resumeSubscription: jest.fn(),
  };
  const usersRepository = { findByIdForTenant: jest.fn() };
  const servicePlansRepository = { findById: jest.fn() };
  const service = new BillingAdminService(
    subscriptionsRepository as never,
    invoicesRepository as never,
    openPositionsRepository as never,
    invoiceCreationService as never,
    subscriptionService as never,
    usersRepository as never,
    servicePlansRepository as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    subscriptionsRepository.countByStatus.mockResolvedValue(5);
    invoicesRepository.findGlobalOpenOverdueSummary.mockResolvedValue({ count: 2, totalBalance: 100 });
    openPositionsRepository.findDistinctUserIdsWithUnbilled.mockResolvedValue(['user-1', 'user-2']);
    invoiceCreationService.getUnbilledTotalForUser.mockImplementation(async (id: string) => (id === 'user-1' ? 10 : 5));
  });

  it('getGlobalSummary aggregates KPIs', async () => {
    const result = await service.getGlobalSummary();

    expect(result).toEqual({
      activeSubscriptionsCount: 5,
      openOverdueCount: 2,
      openOverdueTotal: 100,
      unbilledTotal: 15,
    });
  });

  it('listUserSubscriptions returns subscriptions for an existing user', async () => {
    usersRepository.findByIdForTenant.mockResolvedValue({ id: 'user-1' });
    subscriptionService.listSubscriptions.mockResolvedValue([{ id: 'sub-1' }]);

    const result = await service.listUserSubscriptions('user-1', 100, 0);

    expect(subscriptionService.listSubscriptions).toHaveBeenCalledWith('user-1', 100, 0);
    expect(result).toEqual([{ id: 'sub-1' }]);
  });

  it('listSubscriptionsForAdmin maps subscriptions with user email and plan name', async () => {
    subscriptionsRepository.findAllForAdmin.mockResolvedValue({
      items: [{ id: 'sub-1', userId: 'user-1', planId: 'plan-1' }],
      total: 1,
    });
    subscriptionService.mapManyToResponses.mockResolvedValue([
      { id: 'sub-1', userId: 'user-1', planId: 'plan-1', number: 'SUB-001' },
    ]);
    usersRepository.findByIdForTenant.mockResolvedValue({ id: 'user-1', email: 'user@test.local' });
    servicePlansRepository.findById.mockResolvedValue({ id: 'plan-1', name: 'Basic Plan' });

    const result = await service.listSubscriptionsForAdmin({ limit: 10, offset: 0, search: 'promo' });

    expect(subscriptionsRepository.findAllForAdmin).toHaveBeenCalledWith({
      limit: 10,
      offset: 0,
      search: 'promo',
      userId: undefined,
    });
    expect(result.items[0]).toMatchObject({
      number: 'SUB-001',
      userEmail: 'user@test.local',
      planName: 'Basic Plan',
    });
    expect(result.total).toBe(1);
  });

  it('cancelSubscriptionForAdmin cancels on behalf of the subscription owner', async () => {
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: 'sub-1', userId: 'user-1' });
    subscriptionService.cancelSubscription.mockResolvedValue({ id: 'sub-1', userId: 'user-1', planId: 'plan-1' });
    subscriptionService.mapManyToResponses.mockResolvedValue([
      { id: 'sub-1', userId: 'user-1', planId: 'plan-1', status: 'pending_cancel' },
    ]);
    usersRepository.findByIdForTenant.mockResolvedValue({ id: 'user-1', email: 'user@test.local' });
    servicePlansRepository.findById.mockResolvedValue({ id: 'plan-1', name: 'Basic Plan' });

    const result = await service.cancelSubscriptionForAdmin('sub-1');

    expect(subscriptionService.cancelSubscription).toHaveBeenCalledWith('sub-1', 'user-1');
    expect(result.status).toBe('pending_cancel');
    expect(result.userEmail).toBe('user@test.local');
  });
});
