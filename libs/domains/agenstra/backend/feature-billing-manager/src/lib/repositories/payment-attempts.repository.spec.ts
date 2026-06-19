import { NotFoundException } from '@nestjs/common';
import { runWithTenantId } from '@forepath/shared/backend';

import { PaymentAttemptStatus } from '../entities/payment-attempt.entity';

import { PaymentAttemptsRepository } from './payment-attempts.repository';

describe('PaymentAttemptsRepository', () => {
  const mockGetOne = jest.fn();
  const mockInnerJoin = jest.fn().mockReturnThis();
  const mockWhere = jest.fn().mockReturnThis();
  const mockAndWhere = jest.fn().mockReturnThis();
  const mockOrderBy = jest.fn().mockReturnThis();
  const mockTake = jest.fn().mockReturnThis();
  const createQueryBuilderReturn = {
    innerJoin: mockInnerJoin,
    where: mockWhere,
    andWhere: mockAndWhere,
    orderBy: mockOrderBy,
    take: mockTake,
    getOne: mockGetOne,
  };
  let mockRepository: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilderReturn),
    };
    mockInnerJoin.mockReturnThis();
    mockWhere.mockReturnThis();
    mockAndWhere.mockReturnThis();
    mockTake.mockReturnThis();
    mockOrderBy.mockReturnThis();
  });

  it('create saves payment attempt', async () => {
    const dto = {
      invoiceId: 'inv-1',
      processor: 'stripe',
      externalId: 'cs_1',
      status: PaymentAttemptStatus.PENDING,
    };
    const created = { id: 'attempt-1', ...dto };

    mockRepository.create.mockReturnValue(created);
    mockRepository.save.mockResolvedValue(created);

    const repository = new PaymentAttemptsRepository(mockRepository as never);
    const result = await repository.create(dto);

    expect(result).toEqual(created);
  });

  it('findByExternalId queries processor and external id in tenant', async () => {
    mockGetOne.mockResolvedValue({ id: 'attempt-1' });

    const repository = new PaymentAttemptsRepository(mockRepository as never);
    const result = await runWithTenantId('default', () => repository.findByExternalId('stripe', 'cs_1'));

    expect(mockAndWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
    expect(mockInnerJoin).toHaveBeenNthCalledWith(1, 'attempt.invoice', 'inv');
    expect(mockInnerJoin).toHaveBeenNthCalledWith(2, 'users', 'user', 'user.id = inv.user_id');
    expect(result).toEqual({ id: 'attempt-1' });
  });

  it('findByIdempotencyKey queries idempotency key in tenant', async () => {
    mockGetOne.mockResolvedValue({ id: 'attempt-1' });

    const repository = new PaymentAttemptsRepository(mockRepository as never);
    const result = await runWithTenantId('default', () => repository.findByIdempotencyKey('idem-1'));

    expect(mockWhere).toHaveBeenCalledWith('attempt.idempotency_key = :key', { key: 'idem-1' });
    expect(mockAndWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
    expect(result).toEqual({ id: 'attempt-1' });
  });

  it('findLatestPendingByInvoiceId returns latest pending attempt in tenant', async () => {
    mockGetOne.mockResolvedValue({ id: 'attempt-1' });

    const repository = new PaymentAttemptsRepository(mockRepository as never);
    const result = await runWithTenantId('default', () => repository.findLatestPendingByInvoiceId('inv-1'));

    expect(mockWhere).toHaveBeenCalledWith('attempt.invoice_id = :invoiceId', { invoiceId: 'inv-1' });
    expect(mockAndWhere).toHaveBeenCalledWith('attempt.status = :status', { status: PaymentAttemptStatus.PENDING });
    expect(mockOrderBy).toHaveBeenCalledWith('attempt.createdAt', 'DESC');
    expect(mockTake).toHaveBeenCalledWith(1);
    expect(result).toEqual({ id: 'attempt-1' });
  });

  it('update saves changes when attempt exists in tenant', async () => {
    const existing = { id: 'attempt-1', status: PaymentAttemptStatus.PENDING };

    mockGetOne.mockResolvedValue(existing);
    mockRepository.save.mockResolvedValue({ ...existing, status: PaymentAttemptStatus.SUCCEEDED });

    const repository = new PaymentAttemptsRepository(mockRepository as never);
    const result = await runWithTenantId('default', () =>
      repository.update('attempt-1', { status: PaymentAttemptStatus.SUCCEEDED }),
    );

    expect(mockRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentAttemptStatus.SUCCEEDED }),
    );
    expect(result.status).toBe(PaymentAttemptStatus.SUCCEEDED);
  });

  it('update throws when attempt not found in tenant', async () => {
    mockGetOne.mockResolvedValue(null);

    const repository = new PaymentAttemptsRepository(mockRepository as never);

    await expect(
      runWithTenantId('default', () => repository.update('missing', { status: PaymentAttemptStatus.SUCCEEDED })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
