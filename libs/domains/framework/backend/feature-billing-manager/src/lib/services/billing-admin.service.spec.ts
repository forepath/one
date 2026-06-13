import { BillingAdminService } from './billing-admin.service';

describe('BillingAdminService', () => {
  const subscriptionsRepository = { countByStatus: jest.fn() };
  const invoicesRepository = { findGlobalOpenOverdueSummary: jest.fn() };
  const openPositionsRepository = { findDistinctUserIdsWithUnbilled: jest.fn() };
  const invoiceCreationService = { getUnbilledTotalForUser: jest.fn() };
  const service = new BillingAdminService(
    subscriptionsRepository as never,
    invoicesRepository as never,
    openPositionsRepository as never,
    invoiceCreationService as never,
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
});
