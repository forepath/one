import { NotFoundException } from '@nestjs/common';
import { runWithTenantId } from '@forepath/shared/backend';

import { ServicePlansRepository } from './service-plans.repository';

describe('ServicePlansRepository', () => {
  const mockGetOne = jest.fn();
  const mockGetMany = jest.fn();
  const mockInnerJoinAndSelect = jest.fn().mockReturnThis();
  const mockWhere = jest.fn().mockReturnThis();
  const mockAndWhere = jest.fn().mockReturnThis();
  const mockOrderBy = jest.fn().mockReturnThis();
  const mockTake = jest.fn().mockReturnThis();
  const mockSkip = jest.fn().mockReturnThis();
  const createQueryBuilderReturn = {
    innerJoinAndSelect: mockInnerJoinAndSelect,
    where: mockWhere,
    andWhere: mockAndWhere,
    orderBy: mockOrderBy,
    take: mockTake,
    skip: mockSkip,
    getOne: mockGetOne,
    getMany: mockGetMany,
  };
  let mockRepository: {
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilderReturn),
    };
    mockInnerJoinAndSelect.mockReturnThis();
    mockWhere.mockReturnThis();
    mockAndWhere.mockReturnThis();
    mockOrderBy.mockReturnThis();
    mockTake.mockReturnThis();
    mockSkip.mockReturnThis();
  });

  it('findById scopes query to tenant service type', async () => {
    const plan = { id: 'plan-1' };

    mockGetOne.mockResolvedValue(plan);

    const repository = new ServicePlansRepository(mockRepository as never);
    const result = await runWithTenantId('default', () => repository.findById('plan-1'));

    expect(mockAndWhere).toHaveBeenCalledWith('st.tenant_id = :tenantId', { tenantId: 'default' });
    expect(result).toEqual(plan);
  });

  it('findByIdOrThrow throws when plan is missing in tenant', async () => {
    mockGetOne.mockResolvedValue(null);

    const repository = new ServicePlansRepository(mockRepository as never);

    await expect(runWithTenantId('default', () => repository.findByIdOrThrow('missing'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('findAll applies tenant filter and pagination', async () => {
    mockGetMany.mockResolvedValue([{ id: 'plan-1' }]);

    const repository = new ServicePlansRepository(mockRepository as never);
    const result = await runWithTenantId('acme', () => repository.findAll(5, 10));

    expect(mockTake).toHaveBeenCalledWith(5);
    expect(mockSkip).toHaveBeenCalledWith(10);
    expect(mockAndWhere).toHaveBeenCalledWith('st.tenant_id = :tenantId', { tenantId: 'acme' });
    expect(result).toHaveLength(1);
  });

  it('findActiveWithServiceType filters by service type when provided', async () => {
    mockGetMany.mockResolvedValue([]);

    const repository = new ServicePlansRepository(mockRepository as never);
    await runWithTenantId('default', () => repository.findActiveWithServiceType(10, 0, 'type-1'));

    expect(mockAndWhere).toHaveBeenCalledWith('plan.service_type_id = :serviceTypeId', { serviceTypeId: 'type-1' });
  });

  it('update saves tenant-scoped plan changes', async () => {
    const existing = { id: 'plan-1', name: 'Old' };
    const updated = { ...existing, name: 'New' };

    mockGetOne.mockResolvedValue(existing);
    mockRepository.save.mockResolvedValue(updated);

    const repository = new ServicePlansRepository(mockRepository as never);
    const result = await runWithTenantId('default', () => repository.update('plan-1', { name: 'New' }));

    expect(mockRepository.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'New' }));
    expect(result).toEqual(updated);
  });

  it('delete removes tenant-scoped plan', async () => {
    const existing = { id: 'plan-1' };

    mockGetOne.mockResolvedValue(existing);

    const repository = new ServicePlansRepository(mockRepository as never);
    await runWithTenantId('default', () => repository.delete('plan-1'));

    expect(mockRepository.remove).toHaveBeenCalledWith(existing);
  });
});
