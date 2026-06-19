import { NotFoundException } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';

import { InvoicesRepository } from './invoices.repository';

const createMockQueryBuilder = () => ({
  innerJoin: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  getCount: jest.fn(),
  getMany: jest.fn(),
  getOne: jest.fn(),
});

describe('InvoicesRepository', () => {
  let mockQueryBuilder: ReturnType<typeof createMockQueryBuilder>;
  let mockRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let repository: InvoicesRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    mockQueryBuilder = createMockQueryBuilder();
    mockRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn(async (entity) => entity),
      delete: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };
    repository = new InvoicesRepository(mockRepository as never);
  });

  it('findByIdForUser returns invoice when user owns it', async () => {
    const invoice = { id: 'inv-1', userId: 'user-1' };

    mockQueryBuilder.getOne.mockResolvedValue(invoice);

    await expect(repository.findByIdForUser('inv-1', 'user-1')).resolves.toEqual(invoice);
  });

  it('findByIdForUser returns null when user mismatch', async () => {
    mockQueryBuilder.getOne.mockResolvedValue({ id: 'inv-1', userId: 'other-user' });

    await expect(repository.findByIdForUser('inv-1', 'user-1')).resolves.toBeNull();
  });

  it('findByIdOrThrow throws when invoice missing', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(null);

    await expect(repository.findByIdOrThrow('missing')).rejects.toThrow(NotFoundException);
  });

  it('findByIdOrThrow returns invoice', async () => {
    const invoice = { id: 'inv-1', userId: 'user-1' };

    mockQueryBuilder.getOne.mockResolvedValue(invoice);

    await expect(repository.findByIdOrThrow('inv-1')).resolves.toEqual(invoice);
  });

  it('findAllForAdmin applies filters and pagination', async () => {
    const items = [{ id: 'inv-1' }];

    mockQueryBuilder.getCount.mockResolvedValue(1);
    mockQueryBuilder.getMany.mockResolvedValue(items);

    const result = await repository.findAllForAdmin({
      limit: 10,
      offset: 0,
      search: 'INV',
      userId: 'user-1',
    });

    expect(result).toEqual({ items, total: 1 });
    expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
  });

  it('countByUserId returns count', async () => {
    mockQueryBuilder.getCount.mockResolvedValue(3);

    await expect(repository.countByUserId('user-1')).resolves.toBe(3);
    expect(mockQueryBuilder.getCount).toHaveBeenCalled();
  });

  it('delete removes invoice', async () => {
    const invoice = { id: 'inv-1', userId: 'user-1', status: InvoiceStatus.DRAFT };

    mockQueryBuilder.getOne.mockResolvedValue(invoice);

    await repository.delete('inv-1');

    expect(mockRepository.delete).toHaveBeenCalledWith('inv-1');
  });

  it('update merges and saves invoice', async () => {
    const invoice = { id: 'inv-1', userId: 'user-agent', status: InvoiceStatus.DRAFT };

    mockQueryBuilder.getOne.mockResolvedValue(invoice);

    const result = await repository.update('inv-1', { status: InvoiceStatus.ISSUED });

    expect(result.status).toBe(InvoiceStatus.ISSUED);
    expect(mockRepository.save).toHaveBeenCalled();
  });

  it('create persists new invoice', async () => {
    const dto = { userId: 'user-1', status: InvoiceStatus.DRAFT };

    const result = await repository.create(dto);

    expect(result).toEqual(dto);
    expect(mockRepository.save).toHaveBeenCalled();
  });
});
