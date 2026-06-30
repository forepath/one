import { NotFoundException } from '@nestjs/common';
import { runWithTenantId } from '@forepath/shared/backend';

import { ProjectMilestoneEntity } from '../entities/project-milestone.entity';

import { ProjectMilestonesRepository } from './project-milestones.repository';

describe('ProjectMilestonesRepository', () => {
  const mockGetOne = jest.fn();
  const mockGetMany = jest.fn();
  const mockQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
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

  it('findByIdOrThrow returns milestone', async () => {
    const milestone = { id: 'm1' } as ProjectMilestoneEntity;

    mockGetOne.mockResolvedValue(milestone);

    const repository = new ProjectMilestonesRepository(mockRepository as never);
    const result = await runWithTenantId('default', () => repository.findByIdOrThrow('m1'));

    expect(result).toEqual(milestone);
  });

  it('findByIdOrThrow throws when missing', async () => {
    mockGetOne.mockResolvedValue(null);

    const repository = new ProjectMilestonesRepository(mockRepository as never);

    await expect(runWithTenantId('default', () => repository.findByIdOrThrow('missing'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('findAllByProject returns ordered milestones', async () => {
    const milestones = [{ id: 'm1' }] as ProjectMilestoneEntity[];

    mockGetMany.mockResolvedValue(milestones);

    const repository = new ProjectMilestonesRepository(mockRepository as never);
    const result = await runWithTenantId('default', () => repository.findAllByProject('p1'));

    expect(result).toEqual(milestones);
    expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('milestone.sortOrder', 'ASC');
  });

  it('create saves entity', async () => {
    const repository = new ProjectMilestonesRepository(mockRepository as never);
    const created = await repository.create({ projectId: 'p1', name: 'M1' });

    expect(mockRepository.create).toHaveBeenCalled();
    expect(mockRepository.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'M1' }));
    expect(created).toEqual(expect.objectContaining({ name: 'M1' }));
  });

  it('update merges and saves', async () => {
    const milestone = { id: 'm1', name: 'Old' } as ProjectMilestoneEntity;

    mockGetOne.mockResolvedValue(milestone);

    const repository = new ProjectMilestonesRepository(mockRepository as never);
    const updated = await runWithTenantId('default', () => repository.update('m1', { name: 'New' }));

    expect(updated.name).toBe('New');
    expect(mockRepository.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'New' }));
  });

  it('delete removes milestone', async () => {
    mockGetOne.mockResolvedValue({ id: 'm1' } as ProjectMilestoneEntity);

    const repository = new ProjectMilestonesRepository(mockRepository as never);

    await runWithTenantId('default', () => repository.delete('m1'));

    expect(mockRepository.delete).toHaveBeenCalledWith('m1');
  });
});
