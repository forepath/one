import { BillingAdminService } from './billing-admin.service';

describe('BillingAdminService', () => {
  const subscriptionsRepository = { countByStatus: jest.fn() };
  const invoicesRepository = { findGlobalOpenOverdueSummary: jest.fn() };
  const openPositionsRepository = { findDistinctUserIdsWithUnbilled: jest.fn() };
  const invoiceCreationService = { getUnbilledTotalForUser: jest.fn() };
  const openPositionInvoiceJobHandler = { processUserOpenPositions: jest.fn() };
  const auditLog = { log: jest.fn() };
  const usersRepository = { findById: jest.fn() };
  const service = new BillingAdminService(
    subscriptionsRepository as never,
    invoicesRepository as never,
    openPositionsRepository as never,
    invoiceCreationService as never,
    openPositionInvoiceJobHandler as never,
    auditLog as never,
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

  it('billNow processes all users with unbilled positions', async () => {
    openPositionInvoiceJobHandler.processUserOpenPositions
      .mockResolvedValueOnce({ invoiceRefId: 'inv-1', skipped: false })
      .mockResolvedValueOnce({ skipped: true });

    const result = await service.billNow('admin-1', {});

    expect(result.usersProcessed).toBe(2);
    expect(result.invoicesCreated).toBe(1);
    expect(result.usersSkipped).toBe(1);
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ process: 'invoice.bill_now', invoiceId: 'inv-1' }),
    );
  });

  it('billNow processes single user when userId provided', async () => {
    openPositionInvoiceJobHandler.processUserOpenPositions.mockResolvedValue({
      invoiceRefId: 'inv-2',
      skipped: false,
    });

    const result = await service.billNow('admin-1', { userId: 'user-1' });

    expect(openPositionInvoiceJobHandler.processUserOpenPositions).toHaveBeenCalledWith('user-1');
    expect(result.invoicesCreated).toBe(1);
  });

  it('billNow collects per-user errors and continues', async () => {
    openPositionInvoiceJobHandler.processUserOpenPositions
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ skipped: true });

    const result = await service.billNow('admin-1', {});

    expect(result.errors).toEqual([{ userId: 'user-1', message: 'fail' }]);
    expect(result.usersProcessed).toBe(1);
  });
});
