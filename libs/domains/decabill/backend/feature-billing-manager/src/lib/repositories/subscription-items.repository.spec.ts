import { runWithTenantId } from '@forepath/shared/backend';

import { ProvisioningStatus } from '../entities/subscription-item.entity';

import { SubscriptionItemsRepository } from './subscription-items.repository';

describe('SubscriptionItemsRepository', () => {
  const mockGetMany = jest.fn();
  const mockGetOne = jest.fn();
  const mockGetRawMany = jest.fn();
  const mockInnerJoin = jest.fn().mockReturnThis();
  const mockAndWhere = jest.fn().mockReturnThis();
  const mockWhere = jest.fn().mockReturnThis();
  const mockInnerJoinAndSelect = jest.fn().mockReturnThis();
  const mockLeftJoinAndSelect = jest.fn().mockReturnThis();
  const mockSelect = jest.fn().mockReturnThis();
  const mockOrderBy = jest.fn().mockReturnThis();
  const mockTake = jest.fn().mockReturnThis();
  const createQueryBuilderReturn = {
    innerJoin: mockInnerJoin,
    innerJoinAndSelect: mockInnerJoinAndSelect,
    leftJoinAndSelect: mockLeftJoinAndSelect,
    select: mockSelect,
    orderBy: mockOrderBy,
    take: mockTake,
    where: mockWhere,
    andWhere: mockAndWhere,
    getMany: mockGetMany,
    getOne: mockGetOne,
    getRawMany: mockGetRawMany,
  };
  const mockCreateQueryBuilder = jest.fn(() => createQueryBuilderReturn);
  const mockRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: mockCreateQueryBuilder,
  };
  const repository = new SubscriptionItemsRepository(mockRepository as never);

  beforeEach(() => {
    jest.resetAllMocks();
    mockCreateQueryBuilder.mockImplementation(() => createQueryBuilderReturn);
    mockWhere.mockReturnThis();
    mockAndWhere.mockReturnThis();
    mockInnerJoin.mockReturnThis();
    mockInnerJoinAndSelect.mockReturnThis();
    mockLeftJoinAndSelect.mockReturnThis();
    mockSelect.mockReturnThis();
    mockOrderBy.mockReturnThis();
    mockTake.mockReturnThis();
  });

  it('creates subscription item', async () => {
    const dto = {
      subscriptionId: 'sub-1',
      serviceTypeId: 'stype-1',
      configSnapshot: { region: 'fsn1' },
      provisioningStatus: ProvisioningStatus.PENDING,
    };

    mockRepository.create.mockReturnValue(dto);
    mockRepository.save.mockResolvedValue({ id: 'item-1', ...dto });

    const result = await repository.create(dto);

    expect(result.id).toBe('item-1');
  });

  it('updates provider reference for tenant-scoped item', async () => {
    const existing = {
      id: 'item-1',
      subscriptionId: 'sub-1',
      providerReference: null,
    };

    mockGetOne.mockResolvedValue(existing);
    mockRepository.save.mockResolvedValue({ ...existing, providerReference: 'server-123' });

    const result = await runWithTenantId('default', () => repository.updateProviderReference('item-1', 'server-123'));

    expect(result.providerReference).toBe('server-123');
    expect(mockAndWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
  });

  it('throws when item not found for provider reference update', async () => {
    mockGetOne.mockResolvedValue(null);

    await expect(
      runWithTenantId('default', () => repository.updateProviderReference('nonexistent', 'server-123')),
    ).rejects.toThrow('Subscription item nonexistent not found');
  });

  it('finds items by subscription in tenant', async () => {
    const items = [
      { id: 'item-1', subscriptionId: 'sub-1', serviceType: { provider: 'hetzner' } },
      { id: 'item-2', subscriptionId: 'sub-1', serviceType: { provider: 'hetzner' } },
    ];

    mockGetMany.mockResolvedValue(items);

    const result = await runWithTenantId('default', () => repository.findBySubscription('sub-1'));

    expect(result).toEqual(items);
    expect(mockAndWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
  });

  it('findProvisionedWithSshKey returns tenant-scoped items', async () => {
    const items = [
      {
        id: 'item-1',
        subscriptionId: 'sub-1',
        providerReference: 'srv-1',
        sshPrivateKey: 'key',
        subscription: { status: 'active' },
        serviceType: { provider: 'hetzner' },
      },
    ];

    mockGetMany.mockResolvedValue(items);

    const result = await runWithTenantId('default', () => repository.findProvisionedWithSshKey());

    expect(mockAndWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
    expect(result).toEqual(items);
  });

  it('findPendingProvisioningIds returns ids of pending server items', async () => {
    mockGetRawMany.mockResolvedValue([{ id: 'item-1' }, { id: 'item-2' }]);

    const result = await runWithTenantId('default', () => repository.findPendingProvisioningIds(50));

    expect(result).toEqual(['item-1', 'item-2']);
    expect(mockWhere).toHaveBeenCalledWith('item.provisioning_status = :status', { status: 'pending' });
    expect(mockAndWhere).toHaveBeenCalledWith('item.provider_reference IS NULL');
    expect(mockAndWhere).toHaveBeenCalledWith('sub.status = :subStatus', { subStatus: 'active' });
    expect(mockAndWhere).toHaveBeenCalledWith('st.provider IN (:...providers)', {
      providers: ['hetzner', 'digital-ocean'],
    });
    expect(mockTake).toHaveBeenCalledWith(50);
  });
});
