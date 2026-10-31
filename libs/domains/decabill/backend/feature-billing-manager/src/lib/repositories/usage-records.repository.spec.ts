import { runWithTenantId } from '@forepath/shared/backend';

import { UsageRecordsRepository } from './usage-records.repository';

describe('UsageRecordsRepository', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockInnerJoin.mockReturnThis();
    mockWhere.mockReturnThis();
    mockAndWhere.mockReturnThis();
    mockOrderBy.mockReturnThis();
    mockTake.mockReturnThis();
  });

  it('findLatestForSubscription uses entity relation joins and property-based orderBy', async () => {
    const usage = { id: 'usage-1', subscriptionId: 'sub-1' };

    mockGetOne.mockResolvedValue(usage);

    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilderReturn),
    };
    const repository = new UsageRecordsRepository(mockRepository as never);
    const result = await runWithTenantId('default', () => repository.findLatestForSubscription('sub-1'));

    expect(mockInnerJoin).toHaveBeenNthCalledWith(1, 'usage.subscription', 'sub');
    expect(mockInnerJoin).toHaveBeenNthCalledWith(2, 'users', 'user', 'user.id = sub.user_id');
    expect(mockOrderBy).toHaveBeenCalledWith('usage.createdAt', 'DESC');
    expect(mockAndWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
    expect(result).toEqual(usage);
  });

  it('create saves a usage record', async () => {
    const dto = { subscriptionId: 'sub-1', usageSource: 'meter' };
    const created = { id: 'usage-1', ...dto };

    const mockRepository = {
      create: jest.fn().mockReturnValue(created),
      save: jest.fn().mockResolvedValue(created),
      createQueryBuilder: jest.fn(),
    };
    const repository = new UsageRecordsRepository(mockRepository as never);
    const result = await repository.create(dto);

    expect(mockRepository.create).toHaveBeenCalledWith(dto);
    expect(result).toEqual(created);
  });

  it('findLatestCollectorForMeter filters by collector source and attachment', async () => {
    const usage = { id: 'usage-1', usageSource: 'collector' };
    const mockAddOrderBy = jest.fn().mockReturnThis();
    mockGetOne.mockResolvedValue(usage);

    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        ...createQueryBuilderReturn,
        addOrderBy: mockAddOrderBy,
      }),
    };
    const repository = new UsageRecordsRepository(mockRepository as never);
    const result = await runWithTenantId('default', () =>
      repository.findLatestCollectorForMeter({
        subscriptionId: 'sub-1',
        meterId: 'meter-1',
        attachmentType: 'plan',
        addonId: null,
      }),
    );

    expect(mockAndWhere).toHaveBeenCalledWith('usage.usage_source = :usageSource', {
      usageSource: 'collector',
    });
    expect(mockAndWhere).toHaveBeenCalledWith('usage.addon_id IS NULL');
    expect(mockOrderBy).toHaveBeenCalledWith('usage.period_end', 'DESC');
    expect(result).toEqual(usage);
  });

  it('findMeteredForSubscriptionInRange filters by periodEnd and meter_id', async () => {
    const mockGetMany = jest.fn().mockResolvedValue([]);
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T23:59:59.999Z');

    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        ...createQueryBuilderReturn,
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: mockGetMany,
      }),
    };
    const repository = new UsageRecordsRepository(mockRepository as never);

    await runWithTenantId('default', () => repository.findMeteredForSubscriptionInRange('sub-1', from, to));

    expect(mockAndWhere).toHaveBeenCalledWith('usage.meter_id IS NOT NULL');
    expect(mockAndWhere).toHaveBeenCalledWith('usage.period_end >= :from', { from });
    expect(mockAndWhere).toHaveBeenCalledWith('usage.period_end <= :to', { to });
    expect(mockAndWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
  });

  it('findMeteredForSubscriptionPage pages with take / skip, counts the total and stays tenant-scoped', async () => {
    const mockSkip = jest.fn().mockReturnThis();
    const mockGetManyAndCount = jest.fn().mockResolvedValue([[{ id: 'usage-1' }], 42]);
    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        ...createQueryBuilderReturn,
        skip: mockSkip,
        getManyAndCount: mockGetManyAndCount,
      }),
    };
    const repository = new UsageRecordsRepository(mockRepository as never);

    const result = await runWithTenantId('default', () => repository.findMeteredForSubscriptionPage('sub-1', 25, 50));

    expect(mockWhere).toHaveBeenCalledWith('usage.subscription_id = :subscriptionId', { subscriptionId: 'sub-1' });
    expect(mockAndWhere).toHaveBeenCalledWith('usage.meter_id IS NOT NULL');
    expect(mockAndWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
    expect(mockOrderBy).toHaveBeenCalledWith('usage.createdAt', 'DESC');
    expect(mockTake).toHaveBeenCalledWith(25);
    expect(mockSkip).toHaveBeenCalledWith(50);
    expect(result).toEqual({ items: [{ id: 'usage-1' }], total: 42 });
  });
});
