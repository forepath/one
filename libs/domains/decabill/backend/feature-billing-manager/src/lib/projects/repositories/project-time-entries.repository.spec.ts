import { NotFoundException } from '@nestjs/common';
import { runWithTenantId } from '@forepath/shared/backend';

import { ProjectTimeEntryEntity } from '../entities/project-time-entry.entity';

import { ProjectTimeEntriesRepository } from './project-time-entries.repository';

describe('ProjectTimeEntriesRepository', () => {
  const mockGetMany = jest.fn();
  const mockGetOne = jest.fn();
  const mockGetCount = jest.fn();
  const mockGetRawOne = jest.fn();
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
    take: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    getMany: mockGetMany,
    getOne: mockGetOne,
    getCount: mockGetCount,
    getRawOne: mockGetRawOne,
    update: mockUpdate,
  };

  const mockRepository = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
    create: jest.fn((dto) => dto),
    save: jest.fn(async (entity) => entity),
    delete: jest.fn(),
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

  describe('findByIdOrThrow', () => {
    it('returns entry', async () => {
      const entry = { id: 'e1' } as ProjectTimeEntryEntity;
      mockGetOne.mockResolvedValue(entry);

      const repository = new ProjectTimeEntriesRepository(mockRepository as never);
      await expect(runWithTenantId('default', () => repository.findByIdOrThrow('e1'))).resolves.toEqual(entry);
    });

    it('throws when missing', async () => {
      mockGetOne.mockResolvedValue(null);

      const repository = new ProjectTimeEntriesRepository(mockRepository as never);
      await expect(runWithTenantId('default', () => repository.findByIdOrThrow('missing'))).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAllByProject', () => {
    it('returns paginated entries with optional ticket filter', async () => {
      const entries = [{ id: 'e1' }] as ProjectTimeEntryEntity[];
      mockGetCount.mockResolvedValue(1);
      mockGetMany.mockResolvedValue(entries);

      const repository = new ProjectTimeEntriesRepository(mockRepository as never);
      const result = await runWithTenantId('default', () => repository.findAllByProject('p1', 10, 0, 't1'));

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('entry.ticket_id = :ticketId', { ticketId: 't1' });
      expect(result).toEqual({ items: entries, total: 1 });
    });
  });

  describe('range and invoice queries', () => {
    it('findUnbilledByProject returns unbilled entries', async () => {
      const entries = [{ id: 'e1' }] as ProjectTimeEntryEntity[];
      mockGetMany.mockResolvedValue(entries);

      const repository = new ProjectTimeEntriesRepository(mockRepository as never);
      const result = await runWithTenantId('default', () => repository.findUnbilledByProject('p1'));

      expect(result).toEqual(entries);
    });

    it('findByProjectInRange filters unbilled only when requested', async () => {
      mockGetMany.mockResolvedValue([]);

      const repository = new ProjectTimeEntriesRepository(mockRepository as never);
      await runWithTenantId('default', () =>
        repository.findByProjectInRange('p1', new Date('2026-06-01'), new Date('2026-06-02'), { unbilledOnly: true }),
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('entry.billed_at IS NULL');
    });

    it('findByInvoiceId returns invoice entries', async () => {
      const entries = [{ id: 'e1' }] as ProjectTimeEntryEntity[];
      mockGetMany.mockResolvedValue(entries);

      const repository = new ProjectTimeEntriesRepository(mockRepository as never);
      const result = await runWithTenantId('default', () => repository.findByInvoiceId('inv-1'));

      expect(result).toEqual(entries);
    });
  });

  describe('findUnbilledTimeBounds', () => {
    it('parses raw bounds', async () => {
      mockGetRawOne.mockResolvedValue({
        minStarted: '2026-06-01T08:00:00.000Z',
        maxEnded: '2026-06-01T17:00:00.000Z',
        entryCount: '2',
      });

      const repository = new ProjectTimeEntriesRepository(mockRepository as never);
      const bounds = await runWithTenantId('default', () => repository.findUnbilledTimeBounds('p1'));

      expect(bounds.entryCount).toBe(2);
      expect(bounds.from).toEqual(new Date('2026-06-01T08:00:00.000Z'));
    });
  });

  describe('sumDurationMinutes', () => {
    it('filters unbilled totals', async () => {
      mockGetRawOne.mockResolvedValue({ total: '90' });

      const repository = new ProjectTimeEntriesRepository(mockRepository as never);
      const total = await runWithTenantId('default', () => repository.sumDurationMinutes('p1', false));

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('entry.billed_at IS NULL');
      expect(total).toBe(90);
    });
  });

  describe('create update delete', () => {
    it('creates and updates entries', async () => {
      const entry = { id: 'e1', billedAt: null, description: 'Work' } as ProjectTimeEntryEntity;
      mockGetOne.mockResolvedValue({ id: 'e1', billedAt: null });

      const repository = new ProjectTimeEntriesRepository(mockRepository as never);
      const created = await repository.create({ projectId: 'p1' });
      const updated = await runWithTenantId('default', () => repository.update('e1', { description: 'Work' }));

      expect(created).toEqual(expect.objectContaining({ projectId: 'p1' }));
      expect(updated.description).toBe('Work');
    });

    it('delete rejects billed entries', async () => {
      mockGetOne.mockResolvedValue({ id: 'e1', billedAt: new Date() } as ProjectTimeEntryEntity);

      const repository = new ProjectTimeEntriesRepository(mockRepository as never);
      await expect(runWithTenantId('default', () => repository.delete('e1'))).rejects.toThrow(NotFoundException);
      expect(mockRepository.delete).not.toHaveBeenCalled();
    });

    it('delete removes unbilled entry', async () => {
      mockGetOne.mockResolvedValue({ id: 'e1', billedAt: null } as ProjectTimeEntryEntity);

      const repository = new ProjectTimeEntriesRepository(mockRepository as never);
      await runWithTenantId('default', () => repository.delete('e1'));

      expect(mockRepository.delete).toHaveBeenCalledWith('e1');
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
