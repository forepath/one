import { runWithTenantId } from '@forepath/shared/backend';

import { InvoiceLineItemsRepository } from './invoice-line-items.repository';

describe('InvoiceLineItemsRepository', () => {
  const mockGetMany = jest.fn();
  const mockInnerJoin = jest.fn().mockReturnThis();
  const mockWhere = jest.fn().mockReturnThis();
  const mockAndWhere = jest.fn().mockReturnThis();
  const mockOrderBy = jest.fn().mockReturnThis();
  const createQueryBuilderReturn = {
    innerJoin: mockInnerJoin,
    where: mockWhere,
    andWhere: mockAndWhere,
    orderBy: mockOrderBy,
    getMany: mockGetMany,
  };
  const mockCreateQueryBuilder = jest.fn().mockReturnValue(createQueryBuilderReturn);
  let mockRepository: {
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateQueryBuilder.mockReturnValue(createQueryBuilderReturn);
    mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: mockCreateQueryBuilder,
    };
    mockInnerJoin.mockReturnThis();
    mockWhere.mockReturnThis();
    mockAndWhere.mockReturnThis();
    mockOrderBy.mockReturnThis();
  });

  it('createMany saves line items', async () => {
    const items = [{ invoiceId: 'inv-1', position: 0, description: 'Item' }];
    const saved = [{ id: 'line-1', ...items[0] }];

    mockRepository.create.mockReturnValue(saved);
    mockRepository.save.mockResolvedValue(saved);

    const repository = new InvoiceLineItemsRepository(mockRepository as never);
    const result = await repository.createMany(items);

    expect(mockRepository.create).toHaveBeenCalledWith(items);
    expect(result).toEqual(saved);
  });

  it('findByInvoiceId returns ordered tenant-scoped line items', async () => {
    const lines = [{ id: 'line-1', invoiceId: 'inv-1', position: 0 }];

    mockGetMany.mockResolvedValue(lines);

    const repository = new InvoiceLineItemsRepository(mockRepository as never);
    const result = await runWithTenantId('default', () => repository.findByInvoiceId('inv-1'));

    expect(mockAndWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
    expect(mockInnerJoin).toHaveBeenNthCalledWith(1, 'line.invoice', 'inv');
    expect(mockInnerJoin).toHaveBeenNthCalledWith(2, 'users', 'user', 'user.id = inv.user_id');
    expect(result).toEqual(lines);
  });

  it('deleteByInvoiceId removes tenant-scoped line items', async () => {
    const lines = [{ id: 'line-1' }, { id: 'line-2' }];

    mockGetMany.mockResolvedValue(lines);

    const repository = new InvoiceLineItemsRepository(mockRepository as never);
    await runWithTenantId('default', () => repository.deleteByInvoiceId('inv-1'));

    expect(mockRepository.delete).toHaveBeenCalledWith(['line-1', 'line-2']);
  });

  it('deleteByInvoiceId is a no-op when no lines exist', async () => {
    mockGetMany.mockResolvedValue([]);

    const repository = new InvoiceLineItemsRepository(mockRepository as never);
    await runWithTenantId('default', () => repository.deleteByInvoiceId('inv-1'));

    expect(mockRepository.delete).not.toHaveBeenCalled();
  });
});
