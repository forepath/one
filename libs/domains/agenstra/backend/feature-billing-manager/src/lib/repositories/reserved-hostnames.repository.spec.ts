import { runWithTenantId } from '@forepath/shared/backend';

import { ReservedHostnamesRepository } from './reserved-hostnames.repository';

describe('ReservedHostnamesRepository', () => {
  const mockGetCount = jest.fn();
  const mockGetOne = jest.fn();
  const mockInnerJoin = jest.fn().mockReturnThis();
  const mockWhere = jest.fn().mockReturnThis();
  const mockAndWhere = jest.fn().mockReturnThis();
  const createQueryBuilderReturn = {
    innerJoin: mockInnerJoin,
    where: mockWhere,
    andWhere: mockAndWhere,
    getCount: mockGetCount,
    getOne: mockGetOne,
  };
  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilderReturn),
  };
  let reservedHostnamesRepository: ReservedHostnamesRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRepository.createQueryBuilder.mockReturnValue(createQueryBuilderReturn);
    mockInnerJoin.mockReturnThis();
    mockWhere.mockReturnThis();
    mockAndWhere.mockReturnThis();
    reservedHostnamesRepository = new ReservedHostnamesRepository(mockRepository as never);
  });

  it('existsByHostname returns true when count > 0 in tenant', async () => {
    mockGetCount.mockResolvedValue(1);

    const result = await runWithTenantId('default', () => reservedHostnamesRepository.existsByHostname('foo'));

    expect(result).toBe(true);
    expect(mockInnerJoin).toHaveBeenNthCalledWith(1, 'host.subscriptionItem', 'item');
    expect(mockInnerJoin).toHaveBeenNthCalledWith(2, 'item.subscription', 'sub');
    expect(mockInnerJoin).toHaveBeenNthCalledWith(3, 'users', 'user', 'user.id = sub.user_id');
    expect(mockAndWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
  });

  it('existsByHostname returns false when count is 0', async () => {
    mockGetCount.mockResolvedValue(0);

    const result = await runWithTenantId('default', () => reservedHostnamesRepository.existsByHostname('foo'));

    expect(result).toBe(false);
  });

  it('create saves entity with hostname and subscriptionItemId', async () => {
    const entity = { id: 'e1', hostname: 'bar', subscriptionItemId: 'sub-1' };

    mockRepository.create.mockReturnValue(entity);
    mockRepository.save.mockResolvedValue(entity);
    const result = await reservedHostnamesRepository.create('bar', 'sub-1');

    expect(mockRepository.create).toHaveBeenCalledWith({ hostname: 'bar', subscriptionItemId: 'sub-1' });
    expect(result).toEqual(entity);
  });

  it('deleteBySubscriptionItemId deletes tenant-scoped row', async () => {
    const entity = { id: 'e1', hostname: 'bar', subscriptionItemId: 'sub-1' };

    mockGetOne.mockResolvedValue(entity);
    mockRepository.delete.mockResolvedValue({ affected: 1 });

    await runWithTenantId('default', () => reservedHostnamesRepository.deleteBySubscriptionItemId('sub-1'));

    expect(mockRepository.delete).toHaveBeenCalledWith('e1');
  });

  it('deleteBySubscriptionItemId is a no-op when hostname is not found', async () => {
    mockGetOne.mockResolvedValue(null);

    await runWithTenantId('default', () => reservedHostnamesRepository.deleteBySubscriptionItemId('sub-1'));

    expect(mockRepository.delete).not.toHaveBeenCalled();
  });

  it('findBySubscriptionItemId returns entity when found in tenant', async () => {
    const entity = { id: 'e1', hostname: 'bar', subscriptionItemId: 'sub-1' };

    mockGetOne.mockResolvedValue(entity);

    const result = await runWithTenantId('default', () =>
      reservedHostnamesRepository.findBySubscriptionItemId('sub-1'),
    );

    expect(result).toEqual(entity);
    expect(mockAndWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
  });

  it('findBySubscriptionItemId returns null when not found', async () => {
    mockGetOne.mockResolvedValue(null);

    const result = await runWithTenantId('default', () =>
      reservedHostnamesRepository.findBySubscriptionItemId('sub-1'),
    );

    expect(result).toBeNull();
  });
});
