import { InvoiceStatus } from '../constants/invoice-status.constants';

import { InvoicesRepository } from './invoices.repository';

const createMockQueryBuilder = () => ({
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  getRawOne: jest.fn(),
});

describe('InvoicesRepository', () => {
  let mockQueryBuilder: ReturnType<typeof createMockQueryBuilder>;
  let mockRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(() => {
    jest.resetAllMocks();
    mockQueryBuilder = createMockQueryBuilder();
    mockRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };
  });

  describe('findOpenOverdueSummaryByUserId', () => {
    it('returns count and totalBalance from query result', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ count: '2', total: '99.50' });
      const repository = new InvoicesRepository(mockRepository as never);
      const result = await repository.findOpenOverdueSummaryByUserId('user-1');

      expect(result).toEqual({ count: 2, totalBalance: 99.5 });
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('inv');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('inv.userId = :userId', { userId: 'user-1' });
    });

    it('returns zero count and total when getRawOne returns null', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue(null);
      const repository = new InvoicesRepository(mockRepository as never);
      const result = await repository.findOpenOverdueSummaryByUserId('user-1');

      expect(result).toEqual({ count: 0, totalBalance: 0 });
    });

    it('parses string total as float', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ count: '1', total: '42.25' });
      const repository = new InvoicesRepository(mockRepository as never);
      const result = await repository.findOpenOverdueSummaryByUserId('user-1');

      expect(result.totalBalance).toBe(42.25);
    });
  });

  describe('findByIdOrThrow', () => {
    it('returns invoice when found', async () => {
      const invoice = { id: 'inv-1' };

      mockRepository.findOne.mockResolvedValue(invoice);

      const repository = new InvoicesRepository(mockRepository as never);

      await expect(repository.findByIdOrThrow('inv-1')).resolves.toBe(invoice);
    });

    it('throws NotFoundException when missing', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const repository = new InvoicesRepository(mockRepository as never);

      await expect(repository.findByIdOrThrow('missing')).rejects.toThrow('Invoice missing not found');
    });
  });

  describe('create and update', () => {
    it('create persists new invoice entity', async () => {
      const dto = { subscriptionId: 'sub-1', userId: 'user-1' };
      const created = { id: 'inv-1', ...dto };

      mockRepository.create.mockReturnValue(created);
      mockRepository.save.mockResolvedValue(created);

      const repository = new InvoicesRepository(mockRepository as never);
      const result = await repository.create(dto);

      expect(result).toEqual(created);
    });

    it('update merges dto into existing entity', async () => {
      const entity = { id: 'inv-1', status: InvoiceStatus.ISSUED, balanceDue: 100 };

      mockRepository.findOne.mockResolvedValue(entity);
      mockRepository.save.mockImplementation(async (row) => row);

      const repository = new InvoicesRepository(mockRepository as never);
      const result = await repository.update('inv-1', { status: InvoiceStatus.PAID, balanceDue: 0 });

      expect(result.status).toBe(InvoiceStatus.PAID);
      expect(result.balanceDue).toBe(0);
    });
  });
});
