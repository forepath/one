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
    const invoice = { id: 'inv-1', userId: 'user-1', status: InvoiceStatus.ISSUED };

    mockQueryBuilder.getOne.mockResolvedValue(invoice);

    await expect(repository.findByIdForUser('inv-1', 'user-1')).resolves.toEqual(invoice);
  });

  it('findByIdForUser returns null when user mismatch', async () => {
    mockQueryBuilder.getOne.mockResolvedValue({ id: 'inv-1', userId: 'other-user', status: InvoiceStatus.ISSUED });

    await expect(repository.findByIdForUser('inv-1', 'user-1')).resolves.toBeNull();
  });

  it('findByIdForUser returns null for draft invoices', async () => {
    mockQueryBuilder.getOne.mockResolvedValue({ id: 'inv-1', userId: 'user-1', status: InvoiceStatus.DRAFT });

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

  it('findOpenOverdueByUserId filters open and overdue statuses', async () => {
    const items = [{ id: 'inv-1' }];

    mockQueryBuilder.getMany.mockResolvedValue(items);

    await expect(repository.findOpenOverdueByUserId('user-1')).resolves.toEqual(items);
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('inv.status IN (:...statuses)', {
      statuses: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
    });
  });

  it('findBySubscription excludes draft invoices', async () => {
    const items = [{ id: 'inv-1' }];

    mockQueryBuilder.getMany.mockResolvedValue(items);

    await expect(repository.findBySubscription('user-1', 'sub-1')).resolves.toEqual(items);
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('inv.status IN (:...statuses)', {
      statuses: [
        InvoiceStatus.ISSUED,
        InvoiceStatus.PARTIALLY_PAID,
        InvoiceStatus.OVERDUE,
        InvoiceStatus.PAID,
        InvoiceStatus.VOID,
      ],
    });
  });

  it('findByIdAndSubscriptionId excludes draft invoices', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(null);

    await expect(repository.findByIdAndSubscriptionId('inv-1', 'sub-1')).resolves.toBeNull();
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('inv.status IN (:...statuses)', {
      statuses: [
        InvoiceStatus.ISSUED,
        InvoiceStatus.PARTIALLY_PAID,
        InvoiceStatus.OVERDUE,
        InvoiceStatus.PAID,
        InvoiceStatus.VOID,
      ],
    });
  });

  it('findHistoryByUserId filters paid and void statuses', async () => {
    const items = [{ id: 'inv-2' }];

    mockQueryBuilder.getMany.mockResolvedValue(items);

    await expect(repository.findHistoryByUserId('user-1')).resolves.toEqual(items);
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('inv.status IN (:...statuses)', {
      statuses: [InvoiceStatus.PAID, InvoiceStatus.VOID],
    });
  });

  it('existsAuthorizedByPdfOrTimeReportStorageKey queries tenant-scoped storage keys', async () => {
    mockQueryBuilder.getCount.mockResolvedValue(1);

    await expect(repository.existsAuthorizedByPdfOrTimeReportStorageKey('sub/inv.pdf')).resolves.toBe(true);
    expect(mockQueryBuilder.where).toHaveBeenCalledWith(
      '(inv.pdf_storage_key = :storageKey OR inv.time_report_storage_key = :storageKey)',
      { storageKey: 'sub/inv.pdf' },
    );
    expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
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

  it('claimForAutoPayment returns null when no row was updated', async () => {
    const updateBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    mockRepository.createQueryBuilder.mockReturnValue(updateBuilder);

    await expect(repository.claimForAutoPayment('inv-1', 1)).resolves.toBeNull();
  });

  it('claimForAutoPayment returns invoice after successful claim', async () => {
    const invoice = { id: 'inv-1', autoPaymentStatus: 'in_progress' };
    const updateBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    mockRepository.createQueryBuilder.mockReturnValueOnce(updateBuilder).mockReturnValueOnce({
      ...createMockQueryBuilder(),
      getOne: jest.fn().mockResolvedValue(invoice),
    });

    await expect(repository.claimForAutoPayment('inv-1', 2)).resolves.toEqual(invoice);
    expect(updateBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        autoPaymentAttemptCount: 2,
      }),
    );
  });

  it('transitionAutoPaymentFromInProgress returns false when claim lost', async () => {
    const updateBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    mockRepository.createQueryBuilder.mockReturnValue(updateBuilder);

    await expect(
      repository.transitionAutoPaymentFromInProgress('inv-1', {
        autoPaymentStatus: 'retrying' as never,
        autoPaymentNextRetryAt: new Date(),
      }),
    ).resolves.toBe(false);
  });
});
