import { BillingAuditLogService } from './billing-audit-log.service';

describe('BillingAuditLogService', () => {
  const auditLogsRepository = {
    create: jest.fn().mockResolvedValue({ id: 'log-1' }),
    findByInvoiceId: jest.fn(),
  };
  const service = new BillingAuditLogService(auditLogsRepository as never);

  beforeEach(() => {
    jest.resetAllMocks();
    auditLogsRepository.create.mockResolvedValue({ id: 'log-1' });
  });

  it('persists audit log entries', async () => {
    await service.log({
      process: 'invoice.create',
      level: 'info',
      message: 'Created invoice draft',
      invoiceId: 'inv-1',
      userId: 'user-1',
      context: { totalGross: 119 },
    });

    expect(auditLogsRepository.create).toHaveBeenCalledWith({
      process: 'invoice.create',
      level: 'info',
      message: 'Created invoice draft',
      invoiceId: 'inv-1',
      userId: 'user-1',
      correlationId: undefined,
      tenantId: 'default',
      context: { totalGross: 119 },
    });
  });

  it('defaults context to empty object', async () => {
    await service.log({
      process: 'payment.init',
      level: 'warn',
      message: 'Retry',
    });

    expect(auditLogsRepository.create).toHaveBeenCalledWith(expect.objectContaining({ context: {}, level: 'warn' }));
  });

  it('listForInvoice maps repository rows', async () => {
    auditLogsRepository.findByInvoiceId.mockResolvedValue({
      items: [
        {
          id: 'log-1',
          process: 'invoice.void',
          level: 'info',
          message: 'Voided',
          context: {},
          createdAt: new Date('2025-01-01'),
        },
      ],
      total: 1,
    });

    const result = await service.listForInvoice('inv-1', 10, 0);

    expect(result.total).toBe(1);
    expect(result.items[0].process).toBe('invoice.void');
  });
});
