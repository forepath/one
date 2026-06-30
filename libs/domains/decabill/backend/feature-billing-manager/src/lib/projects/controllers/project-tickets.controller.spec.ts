import { BadRequestException } from '@nestjs/common';

import { ProjectTicketsController } from './project-tickets.controller';

describe('ProjectTicketsController', () => {
  const ticketsService = {
    listTickets: jest.fn().mockResolvedValue([]),
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
});
