import { runWithTenantId } from '@forepath/shared/backend';
import { QueryFailedError } from 'typeorm';


import { OpenPositionsRepository } from './open-positions.repository';

describe('OpenPositionsRepository', () => {
  const mockGetMany = jest.fn();
  const mockGetCount = jest.fn();
  const mockGetOne = jest.fn();
  const mockSetLock = jest.fn().mockReturnThis();
  const mockOrderBy = jest.fn().mockReturnThis();
  const mockTake = jest.fn().mockReturnThis();
  const mockAndWhere = jest.fn().mockReturnThis();
  const mockWhere = jest.fn().mockReturnThis();
  const mockInnerJoin = jest.fn().mockReturnThis();
  const mockSelect = jest.fn().mockReturnThis();
  const mockUpdateExecute = jest.fn();
  const mockUpdateWhereInIds = jest.fn().mockReturnThis();
  const mockUpdateAndWhere = jest.fn().mockReturnThis();
  const mockUpdateSet = jest.fn().mockReturnThis();
  const mockUpdate = jest.fn(() => ({
    set: mockUpdateSet,
    whereInIds: mockUpdateWhereInIds,
    andWhere: mockUpdateAndWhere,
    execute: mockUpdateExecute,
  }));
  const createQueryBuilderReturn = {
    innerJoin: mockInnerJoin,
    where: mockWhere,
    andWhere: mockAndWhere,
    orderBy: mockOrderBy,
    take: mockTake,
    setLock: mockSetLock,
    select: mockSelect,
    getMany: mockGetMany,
    getCount: mockGetCount,
    getOne: mockGetOne,
    update: mockUpdate,
  };
  const mockCreateQueryBuilder = jest.fn(() => createQueryBuilderReturn);
  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: mockCreateQueryBuilder,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    mockCreateQueryBuilder.mockImplementation(() => createQueryBuilderReturn);
    mockInnerJoin.mockReturnThis();
    mockWhere.mockReturnThis();
    mockAndWhere.mockReturnThis();
    mockOrderBy.mockReturnThis();
    mockTake.mockReturnThis();
    mockSetLock.mockReturnThis();
    mockSelect.mockReturnThis();
    mockUpdateSet.mockReturnThis();
    mockUpdateWhereInIds.mockReturnThis();
    mockUpdateAndWhere.mockReturnThis();
  });

  describe('create', () => {
    it('creates and saves an open position', async () => {
      const dto = {
        subscriptionId: 'sub-1',
        userId: 'user-1',
        description: 'Subscription 123',
        billUntil: new Date('2024-02-01'),
        skipIfNoBillableAmount: true,
      };
      const created = { id: 'pos-1', ...dto, createdAt: new Date() };

      mockRepository.create.mockReturnValue(created);
      mockRepository.save.mockResolvedValue(created);

      const repository = new OpenPositionsRepository(mockRepository as never);
      const result = await repository.create(dto);

      expect(mockRepository.create).toHaveBeenCalledWith(dto);
      expect(mockRepository.save).toHaveBeenCalledWith(created);
      expect(result).toEqual(created);
    });
  });

  describe('createUniqueBySourceRef', () => {
    it('returns created true when save succeeds', async () => {
      const dto = {
        subscriptionId: 'sub-1',
        userId: 'user-1',
        sourceRef: 'config_change:change-1',
        billUntil: new Date('2024-02-01'),
        skipIfNoBillableAmount: true,
      };
      const saved = { id: 'pos-1', ...dto, createdAt: new Date() };

      mockRepository.create.mockReturnValue(saved);
      mockRepository.save.mockResolvedValue(saved);

      const repository = new OpenPositionsRepository(mockRepository as never);
      const result = await repository.createUniqueBySourceRef(dto);

      expect(result).toEqual({ entity: saved, created: true });
    });

    it('reloads by sourceRef when save hits a unique violation', async () => {
      const dto = {
        subscriptionId: 'sub-1',
        userId: 'user-1',
        sourceRef: 'config_change:change-1',
        billUntil: new Date('2024-02-01'),
        skipIfNoBillableAmount: true,
      };
      const existing = { id: 'pos-existing', ...dto, createdAt: new Date() };

      mockRepository.create.mockReturnValue(dto);
      mockRepository.save.mockRejectedValue(new QueryFailedError('INSERT', [], { code: '23505' } as never));
      mockGetOne.mockResolvedValue(existing);

      const repository = new OpenPositionsRepository(mockRepository as never);
      const result = await runWithTenantId('default', () => repository.createUniqueBySourceRef(dto));

      expect(result).toEqual({ entity: existing, created: false });
      expect(mockWhere).toHaveBeenCalledWith('pos.source_ref = :sourceRef', {
        sourceRef: 'config_change:change-1',
      });
    });
  });

  describe('findUnbilledByUserId', () => {
    it('finds positions with null invoiceRefId for user in tenant', async () => {
      const positions = [
        {
          id: 'pos-1',
          userId: 'user-1',
          subscriptionId: 'sub-1',
          invoiceRefId: null,
          createdAt: new Date(),
        },
      ];

      mockGetMany.mockResolvedValue(positions);

      const repository = new OpenPositionsRepository(mockRepository as never);
      const result = await runWithTenantId('default', () => repository.findUnbilledByUserId('user-1'));

      expect(mockCreateQueryBuilder).toHaveBeenCalledWith('pos');
      expect(mockAndWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
      expect(result).toEqual(positions);
    });
  });

  describe('hasUnbilledPeriodChargeForSubscription', () => {
    it('returns true when an unbilled period charge exists', async () => {
      mockGetCount.mockResolvedValue(1);

      const repository = new OpenPositionsRepository(mockRepository as never);
      const result = await runWithTenantId('default', () => repository.hasUnbilledPeriodChargeForSubscription('sub-1'));

      expect(result).toBe(true);
      expect(mockWhere).toHaveBeenCalledWith('pos.subscription_id = :subscriptionId', {
        subscriptionId: 'sub-1',
      });
      expect(mockAndWhere).toHaveBeenCalledWith('pos.invoice_ref_id IS NULL');
      expect(mockAndWhere).toHaveBeenCalledWith('pos.adjustment_net IS NULL');
      expect(mockAndWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
    });

    it('returns false when only unbilled adjustment positions exist', async () => {
      mockGetCount.mockResolvedValue(0);

      const repository = new OpenPositionsRepository(mockRepository as never);
      const result = await runWithTenantId('default', () => repository.hasUnbilledPeriodChargeForSubscription('sub-1'));

      expect(result).toBe(false);
      expect(mockAndWhere).toHaveBeenCalledWith('pos.adjustment_net IS NULL');
    });
  });

  describe('markBilled', () => {
    it('updates position with invoiceRefId when in tenant', async () => {
      const entity = {
        id: 'pos-1',
        userId: 'user-1',
        invoiceRefId: undefined as string | undefined,
      };

      mockGetOne.mockResolvedValue(entity);
      mockRepository.save.mockImplementation((e) => Promise.resolve({ ...e }));

      const repository = new OpenPositionsRepository(mockRepository as never);
      const result = await runWithTenantId('default', () => repository.markBilled('pos-1', 'ref-1'));

      expect(mockAndWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
      expect(entity.invoiceRefId).toBe('ref-1');
      expect(mockRepository.save).toHaveBeenCalledWith(entity);
      expect(result.invoiceRefId).toBe('ref-1');
    });

    it('throws when position not found in tenant', async () => {
      mockGetOne.mockResolvedValue(null);

      const repository = new OpenPositionsRepository(mockRepository as never);

      await expect(runWithTenantId('default', () => repository.markBilled('pos-missing', 'ref-1'))).rejects.toThrow(
        'Open position pos-missing not found',
      );
      expect(mockRepository.save).not.toHaveBeenCalled();
    });
  });
});
