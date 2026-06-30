import { NotFoundException } from '@nestjs/common';
import { runWithTenantId } from '@forepath/shared/backend';

import { ProjectTicketStatus } from '../entities/project.enums';
import { ProjectTicketEntity } from '../entities/project-ticket.entity';

import { ProjectTicketsRepository } from './project-tickets.repository';

describe('ProjectTicketsRepository', () => {
  const mockGetOne = jest.fn();
  const mockGetMany = jest.fn();
  const mockQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: mockGetOne,
    getMany: mockGetMany,
  };
  const mockRepository = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
    create: jest.fn((dto) => dto),
    save: jest.fn(async (entity) => entity),
    delete: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('findByIdOrThrow returns ticket', async () => {
    const ticket = { id: 't1' } as ProjectTicketEntity;

    mockGetOne.mockResolvedValue(ticket);

    const repository = new ProjectTicketsRepository(mockRepository as never);
    const result = await runWithTenantId('default', () => repository.findByIdOrThrow('t1'));

    expect(result).toEqual(ticket);
  });

  it('findByIdOrThrow throws when missing', async () => {
    mockGetOne.mockResolvedValue(null);

    const repository = new ProjectTicketsRepository(mockRepository as never);

    await expect(runWithTenantId('default', () => repository.findByIdOrThrow('missing'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('findTitlesByIds returns empty map for empty input', async () => {
    const repository = new ProjectTicketsRepository(mockRepository as never);

    await expect(repository.findTitlesByIds([])).resolves.toEqual(new Map());
    expect(mockGetMany).not.toHaveBeenCalled();
  });

  it('findTitlesByIds maps ticket titles', async () => {
    mockGetMany.mockResolvedValue([
      { id: 't1', title: 'One' },
      { id: 't2', title: 'Two' },
    ]);

    const repository = new ProjectTicketsRepository(mockRepository as never);
    const titles = await runWithTenantId('default', () => repository.findTitlesByIds(['t1', 't2', 't1']));

    expect(titles.get('t1')).toBe('One');
    expect(titles.get('t2')).toBe('Two');
  });

  it('findAllByProject applies status and parent filters', async () => {
    mockGetMany.mockResolvedValue([]);

    const repository = new ProjectTicketsRepository(mockRepository as never);

    await runWithTenantId('default', () =>
      repository.findAllByProject('p1', { status: ProjectTicketStatus.TODO, parentId: null }),
    );
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('ticket.status = :status', {
      status: ProjectTicketStatus.TODO,
    });
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('ticket.parent_id IS NULL');

    jest.clearAllMocks();
    mockQueryBuilder.innerJoin.mockReturnThis();
    mockQueryBuilder.where.mockReturnThis();
    mockQueryBuilder.andWhere.mockReturnThis();
    mockQueryBuilder.orderBy.mockReturnThis();

    await runWithTenantId('default', () => repository.findAllByProject('p1', { parentId: 'parent-1' }));
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('ticket.parent_id = :parentId', { parentId: 'parent-1' });
  });

  it('countByMilestone splits open and done tickets', async () => {
    mockGetMany.mockResolvedValue([
      { status: ProjectTicketStatus.DONE },
      { status: ProjectTicketStatus.CLOSED },
      { status: ProjectTicketStatus.TODO },
    ]);

    const repository = new ProjectTicketsRepository(mockRepository as never);
    const counts = await repository.countByMilestone('m1');

    expect(counts).toEqual({ open: 1, done: 2 });
  });

  it('delete removes ticket', async () => {
    mockGetOne.mockResolvedValue({ id: 't1' } as ProjectTicketEntity);

    const repository = new ProjectTicketsRepository(mockRepository as never);

    await runWithTenantId('default', () => repository.delete('t1'));

    expect(mockRepository.delete).toHaveBeenCalledWith('t1');
  });
});
