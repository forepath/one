import { NotFoundException } from '@nestjs/common';
import { runWithTenantId } from '@forepath/shared/backend';

import { ProjectTicketCommentEntity } from '../entities/project-ticket-comment.entity';

import { ProjectTicketCommentsRepository } from './project-ticket-comments.repository';

describe('ProjectTicketCommentsRepository', () => {
  const mockGetOne = jest.fn();
  const mockGetMany = jest.fn();
  const mockQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
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
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('findByIdOrThrow returns comment', async () => {
    const comment = { id: 'c1' } as ProjectTicketCommentEntity;
    mockGetOne.mockResolvedValue(comment);

    const repository = new ProjectTicketCommentsRepository(mockRepository as never);
    await expect(runWithTenantId('default', () => repository.findByIdOrThrow('c1'))).resolves.toEqual(comment);
  });

  it('findByIdOrThrow throws when missing', async () => {
    mockGetOne.mockResolvedValue(null);

    const repository = new ProjectTicketCommentsRepository(mockRepository as never);
    await expect(runWithTenantId('default', () => repository.findByIdOrThrow('missing'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('findAllByTicket returns comments', async () => {
    const comments = [{ id: 'c1' }] as ProjectTicketCommentEntity[];
    mockGetMany.mockResolvedValue(comments);

    const repository = new ProjectTicketCommentsRepository(mockRepository as never);
    await expect(runWithTenantId('default', () => repository.findAllByTicket('t1'))).resolves.toEqual(comments);
  });

  it('create saves comment', async () => {
    const repository = new ProjectTicketCommentsRepository(mockRepository as never);
    const created = await repository.create({ ticketId: 't1', body: 'Hello' });

    expect(created).toEqual(expect.objectContaining({ body: 'Hello' }));
    expect(mockRepository.save).toHaveBeenCalled();
  });
});
