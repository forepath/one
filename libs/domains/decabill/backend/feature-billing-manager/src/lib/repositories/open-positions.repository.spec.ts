import { runWithTenantId } from '@forepath/shared/backend';

import { OpenPositionsRepository } from './open-positions.repository';

describe('OpenPositionsRepository', () => {
  const mockGetMany = jest.fn();
  const mockGetCount = jest.fn();
  const mockGetOne = jest.fn();
  const mockSetLock = jest.fn().mockReturnThis();
  const mockOrderBy = jest.fn().mockReturnThis();
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
