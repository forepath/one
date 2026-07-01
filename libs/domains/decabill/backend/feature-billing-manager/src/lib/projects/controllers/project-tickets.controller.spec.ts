import { BadRequestException } from '@nestjs/common';

import { ProjectTicketsController } from './project-tickets.controller';

describe('ProjectTicketsController', () => {
  const ticketsService = {
    listTickets: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue({ id: 't1' }),
    create: jest.fn().mockResolvedValue({ id: 't1' }),
    update: jest.fn().mockResolvedValue({ id: 't1' }),
    delete: jest.fn().mockResolvedValue(undefined),
    listComments: jest.fn().mockResolvedValue([]),
    addComment: jest.fn().mockResolvedValue({ id: 'c1' }),
    listActivity: jest.fn().mockResolvedValue([]),
  };
  const controller = new ProjectTicketsController(ticketsService as never);
  const authReq = { user: { id: 'user-1' } } as never;

  beforeEach(() => {
    jest.resetAllMocks();
    ticketsService.listTickets.mockResolvedValue([]);
  });

  it('rejects unauthenticated list requests', async () => {
    await expect(
      controller.list('11111111-1111-4111-8111-111111111111', {} as never, undefined, undefined),
    ).rejects.toThrow(BadRequestException);
    expect(ticketsService.listTickets).not.toHaveBeenCalled();
  });

  it('rejects invalid parentId query values', async () => {
    await expect(
      controller.list('11111111-1111-4111-8111-111111111111', authReq, undefined, 'not-a-uuid'),
    ).rejects.toThrow(BadRequestException);
    expect(ticketsService.listTickets).not.toHaveBeenCalled();
  });

  it('passes null parentId when parentId=null', async () => {
    await controller.list('11111111-1111-4111-8111-111111111111', authReq, undefined, 'null');

    expect(ticketsService.listTickets).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({ parentId: null }),
    );
  });

  it('passes valid UUID parentId', async () => {
    const parentId = '22222222-2222-4222-8222-222222222222';

    await controller.list('11111111-1111-4111-8111-111111111111', authReq, undefined, parentId);

    expect(ticketsService.listTickets).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({ parentId }),
    );
  });

  it('delegates detail, mutation, and comment endpoints', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const ticketId = '22222222-2222-4222-8222-222222222222';

    await controller.get(projectId, ticketId, authReq, 'true');
    await controller.create(projectId, { title: 'Task' }, authReq);
    await controller.update(projectId, ticketId, { title: 'Updated' }, authReq);
    await controller.comments(projectId, ticketId, authReq);
    await controller.addComment(projectId, ticketId, { body: 'Hi' }, authReq);
    await controller.activity(projectId, ticketId, authReq);
    await controller.delete(projectId, ticketId, authReq);

    expect(ticketsService.findOne).toHaveBeenCalled();
    expect(ticketsService.create).toHaveBeenCalled();
    expect(ticketsService.update).toHaveBeenCalled();
    expect(ticketsService.listComments).toHaveBeenCalled();
    expect(ticketsService.addComment).toHaveBeenCalled();
    expect(ticketsService.listActivity).toHaveBeenCalled();
    expect(ticketsService.delete).toHaveBeenCalled();
  });
});
