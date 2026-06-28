import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@forepath/identity/backend';

import { ProjectTicketActionType, ProjectTicketStatus } from '../entities/project.enums';
import { ProjectTicketsService } from './project-tickets.service';

describe('ProjectTicketsService', () => {
  const projectsRepository = { findByIdOrThrow: jest.fn() };
  const ticketsRepository = {
    findAllByProject: jest.fn(),
    findByIdOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const milestonesRepository = { findByIdOrThrow: jest.fn() };
  const commentsRepository = { findAllByTicket: jest.fn(), create: jest.fn() };
  const activitiesRepository = { create: jest.fn(), findAllByTicket: jest.fn().mockResolvedValue([]) };
  const usersRepository = { findByIdForTenant: jest.fn() };
  const projectBoardRealtime = { emitToProject: jest.fn() };

  let service: ProjectTicketsService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ProjectTicketsService(
      projectsRepository as never,
      ticketsRepository as never,
      milestonesRepository as never,
      commentsRepository as never,
      activitiesRepository as never,
      usersRepository as never,
      projectBoardRealtime as never,
    );
  });

  it('listTickets denies non-assigned customer', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'owner' });

    await expect(
      service.listTickets('p1', { userId: 'other', userRole: UserRole.USER, isApiKeyAuth: false }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('mapTicket includes checkbox task counts', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'user-1' });
    ticketsRepository.findAllByProject.mockResolvedValue([
      {
        id: 't1',
        projectId: 'p1',
        title: 'Root',
        content: '- [ ] task\n- [x] done',
        status: ProjectTicketStatus.TODO,
        priority: 'medium',
        locked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const rows = await service.listTickets('p1', { userId: 'user-1', userRole: UserRole.USER, isApiKeyAuth: false });

    expect(rows[0].tasks.open).toBe(1);
    expect(rows[0].tasks.done).toBe(1);
    expect(rows[0].shas.long).toHaveLength(40);
  });

  it('update records milestone change in activity log', async () => {
    const ticket = {
      id: 't1',
      projectId: 'p1',
      title: 'Root',
      content: '',
      status: ProjectTicketStatus.TODO,
      priority: 'medium',
      milestoneId: null,
      parentId: null,
      locked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'admin-1' });
    ticketsRepository.findByIdOrThrow.mockResolvedValue(ticket);
    ticketsRepository.update.mockResolvedValue({ ...ticket, milestoneId: 'm1' });
    milestonesRepository.findByIdOrThrow.mockResolvedValue({ id: 'm1', projectId: 'p1' });
    ticketsRepository.findAllByProject.mockResolvedValue([{ ...ticket, milestoneId: 'm1' }]);

    await service.update('p1', 't1', { milestoneId: 'm1' }, {
      user: { id: 'admin-1', roles: [UserRole.ADMIN] },
      apiKeyAuthenticated: false,
    } as never);

    expect(activitiesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 't1',
        actionType: ProjectTicketActionType.MILESTONE_CHANGED,
        payload: { from: null, to: 'm1' },
      }),
    );
  });
});
