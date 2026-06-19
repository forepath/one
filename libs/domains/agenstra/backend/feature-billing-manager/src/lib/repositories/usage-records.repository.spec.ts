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
});
