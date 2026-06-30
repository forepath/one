import { runWithTenantId } from '@forepath/shared/backend';

import { ProjectTimeEntryEntity } from '../entities/project-time-entry.entity';

import { ProjectTimeEntriesRepository } from './project-time-entries.repository';

describe('ProjectTimeEntriesRepository', () => {
  const mockGetMany = jest.fn();
  const mockExecute = jest.fn();
  const mockAndWhere = jest.fn();
  const mockWhere = jest.fn();
  const mockSet = jest.fn();
  const mockUpdate = jest.fn();

  const mockQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    where: mockWhere.mockReturnThis(),
    andWhere: mockAndWhere.mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getMany: mockGetMany,
    update: mockUpdate,
  };

  mockUpdate.mockReturnValue({
    set: mockSet.mockReturnThis(),
    where: mockWhere.mockReturnThis(),
    andWhere: mockAndWhere.mockReturnThis(),
    execute: mockExecute,
  });

  const mockRepository = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  const mockManager = {
    getRepository: jest.fn(() => mockRepository),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockWhere.mockReturnThis();
    mockAndWhere.mockReturnThis();
    mockSet.mockReturnThis();
    mockUpdate.mockReturnValue({
      set: mockSet.mockReturnThis(),
      where: mockWhere.mockReturnThis(),
      andWhere: mockAndWhere.mockReturnThis(),
      execute: mockExecute,
    });
  });

  describe('findUnbilledByProjectInRangeForUpdate', () => {
    it('locks unbilled entries in range for update', async () => {
      const entries = [{ id: 'e1' }] as ProjectTimeEntryEntity[];

      mockGetMany.mockResolvedValue(entries);

      const repository = new ProjectTimeEntriesRepository(mockRepository as never);
      const result = await runWithTenantId('default', () =>
        repository.findUnbilledByProjectInRangeForUpdate(
          'p1',
          new Date('2026-06-01T08:00:00.000Z'),
          new Date('2026-06-01T17:00:00.000Z'),
          mockManager as never,
        ),
      );

      expect(mockManager.getRepository).toHaveBeenCalledWith(ProjectTimeEntryEntity);
      expect(mockQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(mockAndWhere).toHaveBeenCalledWith('entry.billed_at IS NULL');
      expect(result).toEqual(entries);
    });
  });

  describe('markBilled', () => {
    it('updates only rows that are still unbilled and returns affected count', async () => {
      mockExecute.mockResolvedValue({ affected: 2 });

      const repository = new ProjectTimeEntriesRepository(mockRepository as never);
      const billedAt = new Date('2026-06-02T10:00:00.000Z');
      const count = await repository.markBilled('p1', ['e1', 'e2'], 'inv-1', billedAt);

      expect(mockUpdate).toHaveBeenCalledWith(ProjectTimeEntryEntity);
      expect(mockAndWhere).toHaveBeenCalledWith('project_id = :projectId', { projectId: 'p1' });
      expect(mockAndWhere).toHaveBeenCalledWith('billed_at IS NULL');
      expect(mockSet).toHaveBeenCalledWith({ invoiceId: 'inv-1', billedAt });
      expect(count).toBe(2);
    });

    it('returns zero when no ids are provided', async () => {
      const repository = new ProjectTimeEntriesRepository(mockRepository as never);

      await expect(repository.markBilled('p1', [], 'inv-1', new Date())).resolves.toBe(0);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('uses transactional manager when provided', async () => {
      mockExecute.mockResolvedValue({ affected: 1 });

      const repository = new ProjectTimeEntriesRepository(mockRepository as never);
      await repository.markBilled('p1', ['e1'], 'inv-1', new Date(), mockManager as never);

      expect(mockManager.getRepository).toHaveBeenCalledWith(ProjectTimeEntryEntity);
      expect(mockExecute).toHaveBeenCalled();
    });
  });
});
