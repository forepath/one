import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
  const projectBoardSummary = { emitSummaryChanged: jest.fn() };
  const billingNotificationPublisher = {
    publishTicket: jest.fn(),
    publishTicketComment: jest.fn(),
  };

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
      projectBoardSummary as never,
      billingNotificationPublisher as never,
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
    expect(projectBoardSummary.emitSummaryChanged).toHaveBeenCalledWith({ id: 'p1', userId: 'admin-1' });
  });

  it('lock ticket records LOCKED activity and emits realtime', async () => {
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
    const lockedTicket = { ...ticket, locked: true };

    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'admin-1' });
    ticketsRepository.findByIdOrThrow.mockResolvedValueOnce(ticket).mockResolvedValueOnce(lockedTicket);
    ticketsRepository.update.mockResolvedValue(lockedTicket);
    ticketsRepository.findAllByProject.mockResolvedValue([lockedTicket]);

    const result = await service.update('p1', 't1', { locked: true }, {
      user: { id: 'admin-1', roles: [UserRole.ADMIN] },
      apiKeyAuthenticated: false,
    } as never);

    expect(result.locked).toBe(true);
    expect(activitiesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 't1',
        actionType: ProjectTicketActionType.LOCKED,
      }),
    );
    expect(projectBoardRealtime.emitToProject).toHaveBeenCalled();
    expect(projectBoardSummary.emitSummaryChanged).toHaveBeenCalledWith({ id: 'p1', userId: 'admin-1' });
  });

  it('update rejects locked ticket', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'admin-1' });
    ticketsRepository.findByIdOrThrow.mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      title: 'Locked',
      content: '',
      status: ProjectTicketStatus.DONE,
      priority: 'medium',
      locked: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.update('p1', 't1', { title: 'New title' }, {
        user: { id: 'admin-1', roles: [UserRole.ADMIN] },
        apiKeyAuthenticated: false,
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('delete rejects locked ticket', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'admin-1' });
    ticketsRepository.findByIdOrThrow.mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      title: 'Locked',
      content: '',
      status: ProjectTicketStatus.DONE,
      priority: 'medium',
      locked: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.delete('p1', 't1', {
        user: { id: 'admin-1', roles: [UserRole.ADMIN] },
        apiKeyAuthenticated: false,
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('addComment rejects locked ticket', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'user-1' });
    ticketsRepository.findByIdOrThrow.mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      title: 'Locked',
      content: '',
      status: ProjectTicketStatus.DONE,
      priority: 'medium',
      locked: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.addComment('p1', 't1', { body: 'Hello' }, {
        user: { id: 'user-1', roles: [UserRole.USER] },
        apiKeyAuthenticated: false,
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('listTickets returns empty array when no tickets', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'admin-1' });
    ticketsRepository.findAllByProject.mockResolvedValue([]);

    const rows = await service.listTickets('p1', { userId: 'admin-1', userRole: UserRole.ADMIN, isApiKeyAuth: false });

    expect(rows).toEqual([]);
    expect(ticketsRepository.findAllByProject).toHaveBeenCalledTimes(1);
  });

  it('findOne rejects ticket from another project', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'admin-1' });
    ticketsRepository.findByIdOrThrow.mockResolvedValue({ id: 't1', projectId: 'other' });

    await expect(
      service.findOne('p1', 't1', false, { userId: 'admin-1', userRole: UserRole.ADMIN, isApiKeyAuth: false }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('findOne includes descendants', async () => {
    const parent = {
      id: 't1',
      projectId: 'p1',
      title: 'Root',
      content: '',
      status: ProjectTicketStatus.TODO,
      priority: 'medium',
      parentId: null,
      locked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const child = {
      ...parent,
      id: 't2',
      parentId: 't1',
      title: 'Child',
    };

    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'admin-1' });
    ticketsRepository.findByIdOrThrow.mockResolvedValue(parent);
    ticketsRepository.findAllByProject.mockResolvedValue([parent, child]);

    const result = await service.findOne('p1', 't1', true, {
      userId: 'admin-1',
      userRole: UserRole.ADMIN,
      isApiKeyAuth: false,
    });

    expect(result.children).toHaveLength(1);
    expect(result.children?.[0].title).toBe('Child');
  });

  it('creates ticket and emits realtime events', async () => {
    const created = {
      id: 't1',
      projectId: 'p1',
      title: 'New',
      content: '',
      status: ProjectTicketStatus.DRAFT,
      priority: 'medium',
      parentId: null,
      milestoneId: null,
      locked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'admin-1' });
    ticketsRepository.create.mockResolvedValue(created);
    ticketsRepository.update.mockResolvedValue({ ...created, longSha: 'a'.repeat(40) });
    ticketsRepository.findByIdOrThrow.mockResolvedValue({ ...created, longSha: 'a'.repeat(40) });
    ticketsRepository.findAllByProject.mockResolvedValue([{ ...created, longSha: 'a'.repeat(40) }]);

    const result = await service.create('p1', { title: 'New' }, {
      user: { id: 'admin-1', roles: [UserRole.ADMIN] },
      apiKeyAuthenticated: false,
    } as never);

    expect(result.title).toBe('New');
    expect(billingNotificationPublisher.publishTicket).toHaveBeenCalledWith(
      'ticket.created',
      'admin-1',
      expect.objectContaining({ id: 't1', title: 'New' }),
    );
    expect(activitiesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: ProjectTicketActionType.CREATED }),
    );
    expect(projectBoardRealtime.emitToProject).toHaveBeenCalled();
  });

  it('create rejects parent from another project', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'admin-1' });
    ticketsRepository.findByIdOrThrow.mockResolvedValue({ id: 'parent', projectId: 'other' });

    await expect(
      service.create('p1', { title: 'New', parentId: 'parent' }, {
        user: { id: 'admin-1', roles: [UserRole.ADMIN] },
        apiKeyAuthenticated: false,
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('create rejects milestone from another project', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'admin-1' });
    milestonesRepository.findByIdOrThrow.mockResolvedValue({ id: 'm1', projectId: 'other' });

    await expect(
      service.create('p1', { title: 'New', milestoneId: 'm1' }, {
        user: { id: 'admin-1', roles: [UserRole.ADMIN] },
        apiKeyAuthenticated: false,
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('deletes ticket and emits removed event', async () => {
    const ticket = {
      id: 't1',
      projectId: 'p1',
      title: 'Root',
      content: '',
      status: ProjectTicketStatus.TODO,
      priority: 'medium',
      locked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'admin-1' });
    ticketsRepository.findByIdOrThrow.mockResolvedValue(ticket);

    await service.delete('p1', 't1', {
      user: { id: 'admin-1', roles: [UserRole.ADMIN] },
      apiKeyAuthenticated: false,
    } as never);

    expect(ticketsRepository.delete).toHaveBeenCalledWith('t1');
    expect(projectBoardRealtime.emitToProject).toHaveBeenCalledWith('p1', expect.stringContaining('ticketRemoved'), {
      id: 't1',
      projectId: 'p1',
    });
  });

  it('lists comments and activity for readable ticket', async () => {
    const ticket = {
      id: 't1',
      projectId: 'p1',
      title: 'Root',
      content: '',
      status: ProjectTicketStatus.TODO,
      priority: 'medium',
      locked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'admin-1' });
    ticketsRepository.findByIdOrThrow.mockResolvedValue(ticket);
    commentsRepository.findAllByTicket.mockResolvedValue([
      { id: 'c1', ticketId: 't1', userId: 'admin-1', body: 'Hi', createdAt: new Date() },
    ]);
    activitiesRepository.findAllByTicket.mockResolvedValue([
      {
        id: 'a1',
        ticketId: 't1',
        occurredAt: new Date(),
        actorType: 'human',
        actorUserId: 'admin-1',
        actionType: 'updated',
        payload: {},
      },
    ]);
    usersRepository.findByIdForTenant.mockResolvedValue({ email: 'admin@example.com' });

    const comments = await service.listComments('p1', 't1', {
      userId: 'admin-1',
      userRole: UserRole.ADMIN,
      isApiKeyAuth: false,
    });
    const activity = await service.listActivity('p1', 't1', 10, 0, {
      userId: 'admin-1',
      userRole: UserRole.ADMIN,
      isApiKeyAuth: false,
    });

    expect(comments[0].body).toBe('Hi');
    expect(activity[0].id).toBe('a1');
  });

  it('addComment creates comment and emits realtime events', async () => {
    const ticket = {
      id: 't1',
      projectId: 'p1',
      title: 'Root',
      content: '',
      status: ProjectTicketStatus.TODO,
      priority: 'medium',
      locked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const comment = { id: 'c1', ticketId: 't1', userId: 'admin-1', body: 'Hello', createdAt: new Date() };

    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'admin-1' });
    ticketsRepository.findByIdOrThrow.mockResolvedValue(ticket);
    commentsRepository.create.mockResolvedValue(comment);
    activitiesRepository.findAllByTicket.mockResolvedValue([
      {
        id: 'a1',
        ticketId: 't1',
        occurredAt: new Date(),
        actorType: 'human',
        actorUserId: 'admin-1',
        actionType: ProjectTicketActionType.COMMENT_ADDED,
        payload: { commentId: 'c1' },
      },
    ]);
    usersRepository.findByIdForTenant.mockResolvedValue({ email: 'admin@example.com' });

    const result = await service.addComment('p1', 't1', { body: 'Hello' }, {
      user: { id: 'admin-1', roles: [UserRole.ADMIN] },
      apiKeyAuthenticated: false,
    } as never);

    expect(result.body).toBe('Hello');
    expect(billingNotificationPublisher.publishTicketComment).toHaveBeenCalledWith(
      'admin-1',
      'p1',
      expect.objectContaining({ id: 'c1', ticketId: 't1', body: 'Hello' }),
    );
    expect(projectBoardRealtime.emitToProject).toHaveBeenCalled();
  });

  it('update records status change in activity log', async () => {
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
    ticketsRepository.update.mockResolvedValue({ ...ticket, status: ProjectTicketStatus.IN_PROGRESS });
    ticketsRepository.findAllByProject.mockResolvedValue([{ ...ticket, status: ProjectTicketStatus.IN_PROGRESS }]);

    await service.update('p1', 't1', { status: ProjectTicketStatus.IN_PROGRESS }, {
      user: { id: 'admin-1', roles: [UserRole.ADMIN] },
      apiKeyAuthenticated: false,
    } as never);

    expect(activitiesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ProjectTicketActionType.STATUS_CHANGED,
        payload: { from: ProjectTicketStatus.TODO, to: ProjectTicketStatus.IN_PROGRESS },
      }),
    );
  });
});
