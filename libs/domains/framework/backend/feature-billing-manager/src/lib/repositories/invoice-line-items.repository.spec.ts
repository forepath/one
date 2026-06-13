import { InvoiceLineItemsRepository } from './invoice-line-items.repository';

describe('InvoiceLineItemsRepository', () => {
  let mockRepository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };

  beforeEach(() => {
    jest.resetAllMocks();
    mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
    };
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

  it('findByInvoiceId returns ordered line items', async () => {
    const lines = [{ id: 'line-1', invoiceId: 'inv-1', position: 0 }];

    mockRepository.find.mockResolvedValue(lines);

    const repository = new InvoiceLineItemsRepository(mockRepository as never);
    const result = await repository.findByInvoiceId('inv-1');

    expect(mockRepository.find).toHaveBeenCalledWith({
      where: { invoiceId: 'inv-1' },
      order: { position: 'ASC' },
    });
    expect(result).toEqual(lines);
  });
});
