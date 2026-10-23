import { NotFoundException } from '@nestjs/common';

import { SubscriptionStatus } from '../entities/subscription.entity';

import { SubscriptionsRepository } from './subscriptions.repository';

const createMockQueryBuilder = () => ({
  innerJoin: jest.fn().mockReturnThis(),
  innerJoinAndMapOne: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
  getOne: jest.fn(),
  getCount: jest.fn(),
});

describe('SubscriptionsRepository', () => {
  let mockQueryBuilder: ReturnType<typeof createMockQueryBuilder>;
  let mockRepository: any;
  let repository: SubscriptionsRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    mockQueryBuilder = createMockQueryBuilder();
    mockRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      findBy: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };
    repository = new SubscriptionsRepository(mockRepository);
  });

  it('finds subscription by id or throws', async () => {
    const subscription = { id: 'sub-1', status: SubscriptionStatus.ACTIVE };

    mockRepository.findOne.mockResolvedValue(subscription);
    mockQueryBuilder.getOne.mockResolvedValue(subscription);

    const result = await repository.findByIdOrThrow('sub-1');

    expect(result).toEqual(subscription);
  });

  it('throws when subscription not found', async () => {
    mockRepository.findOne.mockResolvedValue(null);
    mockQueryBuilder.getOne.mockResolvedValue(null);

    await expect(repository.findByIdOrThrow('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('finds subscription by id without throwing', async () => {
    const subscription = { id: 'sub-1', status: SubscriptionStatus.ACTIVE };

    mockRepository.findOne.mockResolvedValue(subscription);
    mockQueryBuilder.getOne.mockResolvedValue(subscription);

    const result = await repository.findById('sub-1');

    expect(result).toEqual(subscription);
  });

  it('returns null when not found', async () => {
    mockRepository.findOne.mockResolvedValue(null);
    mockQueryBuilder.getOne.mockResolvedValue(null);

    const result = await repository.findById('nonexistent');

    expect(result).toBeNull();
  });

  it('finds all by user with pagination', async () => {
    const subscriptions = [{ id: 'sub-1' }, { id: 'sub-2' }];

    mockQueryBuilder.getMany.mockResolvedValue(subscriptions);

    const result = await repository.findAllByUser('user-1', 10, 0);

    expect(result).toEqual(subscriptions);
    expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
    expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
  });

  it('findAllByUser uses OpenSearch ids when search service returns hits', async () => {
    const billingSearchIndexService = {
      searchIds: jest.fn().mockResolvedValue({ ids: ['sub-2', 'sub-1'], total: 2 }),
    };
    const searchRepository = new SubscriptionsRepository(mockRepository, billingSearchIndexService as never);

    mockRepository.findBy.mockResolvedValue([
      { id: 'sub-1', userId: 'user-1' },
      { id: 'sub-2', userId: 'user-1' },
    ]);

    const result = await searchRepository.findAllByUser('user-1', 10, 0, 'acme');

    expect(billingSearchIndexService.searchIds).toHaveBeenCalledWith(
      'subscriptions',
      'acme',
      expect.objectContaining({ extraFilters: { userId: 'user-1' }, limit: 10, offset: 0 }),
    );
    expect(result.map((row) => row.id)).toEqual(['sub-2', 'sub-1']);
  });

  it('creates subscription', async () => {
    const dto = { userId: 'user-1', planId: 'plan-1', status: SubscriptionStatus.ACTIVE };

    mockRepository.create.mockReturnValue(dto);
    mockRepository.save.mockResolvedValue({ id: 'sub-1', ...dto });

    const result = await repository.create(dto);

    expect(result.id).toBe('sub-1');
  });

  it('updates subscription', async () => {
    const existing = { id: 'sub-1', status: SubscriptionStatus.ACTIVE };

    mockRepository.findOne.mockResolvedValue(existing);
    mockQueryBuilder.getOne.mockResolvedValue(existing);
    mockRepository.save.mockResolvedValue({ ...existing, status: SubscriptionStatus.PENDING_CANCEL });

    const result = await repository.update('sub-1', { status: SubscriptionStatus.PENDING_CANCEL });

    expect(result.status).toBe(SubscriptionStatus.PENDING_CANCEL);
  });

  it('finds subscriptions due for billing', async () => {
    const subscriptions = [{ id: 'sub-1', status: SubscriptionStatus.ACTIVE }];

    mockQueryBuilder.getMany.mockResolvedValue(subscriptions);

    const now = new Date();
    const result = await repository.findDueForBilling(now, 100);

    expect(result).toEqual(subscriptions);
    expect(mockQueryBuilder.where).toHaveBeenCalledWith('subscription.status = :status', {
      status: 'active',
    });
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
  });

  it('finds subscriptions due for cancellation', async () => {
    const subscriptions = [{ id: 'sub-1', status: SubscriptionStatus.PENDING_CANCEL }];

    mockQueryBuilder.getMany.mockResolvedValue(subscriptions);

    const now = new Date();
    const result = await repository.findDueForCancellation(now, 100);

    expect(result).toEqual(subscriptions);
    expect(mockQueryBuilder.where).toHaveBeenCalledWith('subscription.status = :status', {
      status: 'pending_cancel',
    });
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('subscription.cancelEffectiveAt <= :now', { now });
  });

  it('filters subscriptions still in a teardown grace period out of the cancellation batch', async () => {
    type Row = { id: string; status: string; cancelEffectiveAt: Date; teardownNotBefore: Date | null };
    const now = new Date('2026-10-20T12:00:00Z');
    const day = 24 * 60 * 60 * 1000;
    const batchSize = 5;
    // More grace-period Loadweaver subscriptions than the batch holds, all with an earlier effective date ...
    const rows: Row[] = Array.from({ length: batchSize + 3 }, (_, i) => ({
      id: `grace-${i}`,
      status: 'pending_cancel',
      cancelEffectiveAt: new Date(now.getTime() - (10 - i) * 60_000 - day),
      teardownNotBefore: new Date(now.getTime() + 6 * day),
    }));

    // ... plus a due Loadweaver subscription (grace over) and a due plain one.
    rows.push(
      {
        id: 'due-loadweaver',
        status: 'pending_cancel',
        cancelEffectiveAt: new Date(now.getTime() - 8 * day),
        teardownNotBefore: new Date(now.getTime() - day),
      },
      {
        id: 'due-plain',
        status: 'pending_cancel',
        cancelEffectiveAt: new Date(now.getTime() - 1000),
        teardownNotBefore: null,
      },
      {
        id: 'future',
        status: 'pending_cancel',
        cancelEffectiveAt: new Date(now.getTime() + day),
        teardownNotBefore: null,
      },
    );

    // Minimal evaluator for exactly the conditions the repository builds (unknown conditions fail the test).
    const predicates: Record<string, (row: Row, p: Record<string, unknown>) => boolean> = {
      'subscription.status = :status': (row, p) => row.status === p['status'],
      'subscription.cancelEffectiveAt <= :now': (row, p) => row.cancelEffectiveAt <= (p['now'] as Date),
      'COALESCE(subscription.teardownNotBefore, subscription.cancelEffectiveAt) <= :now': (row, p) =>
        (row.teardownNotBefore ?? row.cancelEffectiveAt) <= (p['now'] as Date),
    };
    const conditions: Array<[string, Record<string, unknown>]> = [];
    let limit = Infinity;

    mockQueryBuilder.where.mockImplementation((c: string, p: Record<string, unknown>) => {
      conditions.push([c, p]);

      return mockQueryBuilder;
    });
    mockQueryBuilder.andWhere.mockImplementation((c: string | object, p: Record<string, unknown>) => {
      if (typeof c === 'string' && !c.includes('tenant')) conditions.push([c, p]);

      return mockQueryBuilder;
    });
    mockQueryBuilder.take.mockImplementation((n: number) => {
      limit = n;

      return mockQueryBuilder;
    });
    mockQueryBuilder.getMany.mockImplementation(async () =>
      rows
        .filter((row) =>
          conditions.every(([c, p]) => {
            const predicate = predicates[c];

            if (!predicate) throw new Error(`unexpected condition ${c}`);

            return predicate(row, p);
          }),
        )
        .sort((a, b) => a.cancelEffectiveAt.getTime() - b.cancelEffectiveAt.getTime())
        .slice(0, limit),
    );

    const result = await repository.findDueForCancellation(now, batchSize);

    expect(result.map((row) => row.id)).toEqual(['due-loadweaver', 'due-plain']);
    expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('subscription.cancelEffectiveAt', 'ASC');
    expect(limit).toBe(batchSize);
  });

  it('finds subscriptions due for withdrawal', async () => {
    const subscriptions = [{ id: 'sub-1', status: SubscriptionStatus.PENDING_WITHDRAWAL }];

    mockQueryBuilder.getMany.mockResolvedValue(subscriptions);

    const now = new Date();
    const result = await repository.findDueForWithdrawal(now, 100);

    expect(result).toEqual(subscriptions);
    expect(mockQueryBuilder.where).toHaveBeenCalledWith('subscription.status = :status', {
      status: 'pending_withdrawal',
    });
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('subscription.withdrawnAt <= :now', { now });
  });

  it('finds subscriptions due for instant cancel', async () => {
    const subscriptions = [{ id: 'sub-1', status: SubscriptionStatus.PENDING_INSTANT_CANCEL }];

    mockQueryBuilder.getMany.mockResolvedValue(subscriptions);

    const now = new Date();
    const result = await repository.findDueForInstantCancel(now, 100);

    expect(result).toEqual(subscriptions);
    expect(mockQueryBuilder.where).toHaveBeenCalledWith('subscription.status = :status', {
      status: 'pending_instant_cancel',
    });
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('subscription.instantRemoval = :instantRemoval', {
      instantRemoval: true,
    });
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('subscription.instantCanceledAt <= :now', { now });
  });

  it('finds subscription with billing profile by number', async () => {
    const subscription = {
      id: 'sub-1',
      number: 'SUB-000001',
      profile: { email: 'billing@example.com' },
    };

    mockQueryBuilder.getOne.mockResolvedValue(subscription);

    const result = await repository.findByNumberWithBillingProfile('SUB-000001');

    expect(mockQueryBuilder.innerJoinAndMapOne).toHaveBeenCalled();
    expect(result).toEqual({
      subscription,
      profile: subscription.profile,
    });
  });

  it('returns null when subscription number not found', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(null);

    const result = await repository.findByNumberWithBillingProfile('SUB-000099');

    expect(result).toBeNull();
  });

  it('finds upcoming renewals within days', async () => {
    const subscriptions = [{ id: 'sub-1', status: SubscriptionStatus.ACTIVE }];

    mockQueryBuilder.getMany.mockResolvedValue(subscriptions);

    const now = new Date('2024-01-01');
    const result = await repository.findUpcomingRenewals(3, now, 100);

    expect(result).toEqual(subscriptions);
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('subscription.nextBillingAt > :now', {
      now,
    });
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'subscription.nextBillingAt <= :futureDate',
      expect.objectContaining({ futureDate: expect.any(Date) }),
    );
  });
});
