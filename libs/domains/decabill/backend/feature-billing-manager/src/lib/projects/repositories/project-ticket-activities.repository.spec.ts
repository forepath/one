import { NotFoundException } from '@nestjs/common';
import { runWithTenantId } from '@forepath/shared/backend';

import { ProjectTicketActivityEntity } from '../entities/project-ticket-activity.entity';

import { ProjectTicketActivitiesRepository } from './project-ticket-activities.repository';

describe('ProjectTicketActivitiesRepository', () => {
  const mockGetOne = jest.fn();
  const mockGetMany = jest.fn();
  const mockQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    getOne: mockGetOne,
    getMany: mockGetMany,
  };
  const mockRepository = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
    create: jest.fn((dto) => dto),
    save: jest.fn(async (entity) => entity),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('findByIdOrThrow returns activity', async () => {
    const activity = { id: 'a1' } as ProjectTicketActivityEntity;
    mockGetOne.mockResolvedValue(activity);

    const repository = new ProjectTicketActivitiesRepository(mockRepository as never);
    await expect(runWithTenantId('default', () => repository.findByIdOrThrow('a1'))).resolves.toEqual(activity);
  });

  it('findByIdOrThrow throws when missing', async () => {
    mockGetOne.mockResolvedValue(null);

    const repository = new ProjectTicketActivitiesRepository(mockRepository as never);
    await expect(runWithTenantId('default', () => repository.findByIdOrThrow('missing'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('findAllByTicket returns paginated activity', async () => {
    const activity = [{ id: 'a1' }] as ProjectTicketActivityEntity[];
    mockGetMany.mockResolvedValue(activity);

    const repository = new ProjectTicketActivitiesRepository(mockRepository as never);
    await expect(runWithTenantId('default', () => repository.findAllByTicket('t1', 10, 0))).resolves.toEqual(activity);
  });

  it('create saves activity', async () => {
    const repository = new ProjectTicketActivitiesRepository(mockRepository as never);
    const created = await repository.create({ ticketId: 't1', actionType: 'updated' });

    expect(created).toEqual(expect.objectContaining({ actionType: 'updated' }));
    expect(mockRepository.save).toHaveBeenCalled();
  });
});
