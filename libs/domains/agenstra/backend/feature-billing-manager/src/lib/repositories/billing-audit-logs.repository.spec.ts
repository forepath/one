import { BillingAuditLogsRepository } from './billing-audit-logs.repository';

describe('BillingAuditLogsRepository', () => {
  const typeOrmRepo = {
    findAndCount: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const repository = new BillingAuditLogsRepository(typeOrmRepo as never);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('findByInvoiceId returns paginated items', async () => {
    const items = [{ id: 'log-1', invoiceId: 'inv-1' }];

    typeOrmRepo.findAndCount.mockResolvedValue([items, 1]);

    const result = await repository.findByInvoiceId('inv-1', 10, 0);

    expect(result).toEqual({ items, total: 1 });
    expect(typeOrmRepo.findAndCount).toHaveBeenCalledWith({
      where: { invoiceId: 'inv-1' },
      order: { createdAt: 'DESC' },
      take: 10,
      skip: 0,
    });
  });
});
