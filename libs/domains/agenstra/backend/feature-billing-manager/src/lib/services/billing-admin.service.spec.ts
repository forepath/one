import { BillingAdminService } from './billing-admin.service';

describe('BillingAdminService', () => {
  const subscriptionsRepository = { countByStatus: jest.fn() };
  const invoicesRepository = { findGlobalOpenOverdueSummary: jest.fn() };
  const openPositionsRepository = { findDistinctUserIdsWithUnbilled: jest.fn() };
  const invoiceCreationService = { getUnbilledTotalForUser: jest.fn() };
  const subscriptionService = { listSubscriptions: jest.fn() };
  const usersRepository = { findById: jest.fn() };
  const service = new BillingAdminService(
    subscriptionsRepository as never,
    invoicesRepository as never,
    openPositionsRepository as never,
    invoiceCreationService as never,
    subscriptionService as never,
    usersRepository as never,
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
    usersRepository.findById.mockResolvedValue({ id: 'user-1' });
    subscriptionService.listSubscriptions.mockResolvedValue([{ id: 'sub-1' }]);

    const result = await service.listUserSubscriptions('user-1', 100, 0);

    expect(subscriptionService.listSubscriptions).toHaveBeenCalledWith('user-1', 100, 0);
    expect(result).toEqual([{ id: 'sub-1' }]);
  });
});
