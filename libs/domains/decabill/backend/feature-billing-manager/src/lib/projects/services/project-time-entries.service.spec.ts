import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@forepath/identity/backend';

import { ProjectTimeEntriesService } from './project-time-entries.service';
import { PROJECTS_BOARD_EVENTS } from './project-board-realtime.constants';

describe('ProjectTimeEntriesService', () => {
  const projectsRepository = { findByIdOrThrow: jest.fn() };
  const timeEntriesRepository = {
    create: jest.fn(),
    findAllByProject: jest.fn(),
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const ticketsRepository = { findByIdOrThrow: jest.fn() };
  const projectBoardRealtime = { emitToProject: jest.fn() };
  const projectBoardSummary = { emitSummaryChanged: jest.fn() };
  const billingNotificationPublisher = {
    publishTimeEntry: jest.fn(),
  };

  const project = { id: 'p1', userId: 'admin-1' };
  const adminReq = {
    user: { id: 'admin-1', roles: [UserRole.ADMIN] },
    apiKeyAuthenticated: false,
  } as never;

  let service: ProjectTimeEntriesService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ProjectTimeEntriesService(
      projectsRepository as never,
      timeEntriesRepository as never,
      ticketsRepository as never,
      projectBoardRealtime as never,
      projectBoardSummary as never,
      billingNotificationPublisher as never,
    );
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);
  });

  it('list returns paginated entries', async () => {
    const entry = {
      id: 'e1',
      projectId: 'p1',
      ticketId: null,
      recordedByUserId: 'admin-1',
      durationMinutes: 60,
      description: null,
      startedAt: new Date('2026-06-28T08:00:00.000Z'),
      endedAt: new Date('2026-06-28T09:00:00.000Z'),
      recordedAt: new Date('2026-06-28T08:00:00.000Z'),
      invoiceId: null,
      billedAt: null,
      createdAt: new Date(),
    };
    timeEntriesRepository.findAllByProject.mockResolvedValue({ items: [entry], total: 1 });

    const result = await service.list('p1', 10, 0, {
      userId: 'admin-1',
      userRole: UserRole.ADMIN,
      isApiKeyAuth: false,
    });

    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe('e1');
  });

  it('list rejects ticket from another project', async () => {
    ticketsRepository.findByIdOrThrow.mockResolvedValue({ id: 't1', projectId: 'other' });

    await expect(
      service.list('p1', 10, 0, { userId: 'admin-1', userRole: UserRole.ADMIN, isApiKeyAuth: false }, 't1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('create rejects time entry for locked ticket', async () => {
    ticketsRepository.findByIdOrThrow.mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      locked: true,
    });

    await expect(
      service.create(
        'p1',
        {
          ticketId: 't1',
          startedAt: '2026-06-28T08:00:00.000Z',
          endedAt: '2026-06-28T09:00:00.000Z',
        },
        adminReq,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(timeEntriesRepository.create).not.toHaveBeenCalled();
  });

  it('create stores entry and emits realtime events', async () => {
    const created = {
      id: 'e1',
      projectId: 'p1',
      ticketId: null,
      recordedByUserId: 'admin-1',
      durationMinutes: 60,
      description: 'Work',
      startedAt: new Date('2026-06-28T08:00:00.000Z'),
      endedAt: new Date('2026-06-28T09:00:00.000Z'),
      recordedAt: new Date('2026-06-28T08:00:00.000Z'),
      invoiceId: null,
      billedAt: null,
      createdAt: new Date(),
    };
    timeEntriesRepository.create.mockResolvedValue(created);

    const result = await service.create(
      'p1',
      {
        startedAt: '2026-06-28T08:00:00.000Z',
        endedAt: '2026-06-28T09:00:00.000Z',
        description: 'Work',
      },
      adminReq,
    );

    expect(result.id).toBe('e1');
    expect(billingNotificationPublisher.publishTimeEntry).toHaveBeenCalledWith(
      'time_entry.created',
      'admin-1',
      expect.objectContaining({ id: 'e1' }),
    );
    expect(projectBoardRealtime.emitToProject).toHaveBeenCalledWith(
      'p1',
      PROJECTS_BOARD_EVENTS.timeEntryUpsert,
      expect.objectContaining({ id: 'e1' }),
    );
  });

  it('update rejects billed entry', async () => {
    timeEntriesRepository.findByIdOrThrow.mockResolvedValue({
      id: 'e1',
      projectId: 'p1',
      billedAt: new Date(),
    });

    await expect(service.update('p1', 'e1', { description: 'x' }, adminReq)).rejects.toThrow(BadRequestException);
  });

  it('update rejects partial range update', async () => {
    timeEntriesRepository.findByIdOrThrow.mockResolvedValue({
      id: 'e1',
      projectId: 'p1',
      billedAt: null,
    });

    await expect(service.update('p1', 'e1', { startedAt: '2026-06-28T08:00:00.000Z' }, adminReq)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('update rejects ticket from another project', async () => {
    timeEntriesRepository.findByIdOrThrow.mockResolvedValue({
      id: 'e1',
      projectId: 'p1',
      billedAt: null,
    });
    ticketsRepository.findByIdOrThrow.mockResolvedValue({ id: 't1', projectId: 'other', locked: false });

    await expect(service.update('p1', 'e1', { ticketId: 't1' }, adminReq)).rejects.toThrow(ForbiddenException);
  });

  it('delete rejects billed entry', async () => {
    timeEntriesRepository.findByIdOrThrow.mockResolvedValue({
      id: 'e1',
      projectId: 'p1',
      billedAt: new Date(),
    });

    await expect(service.delete('p1', 'e1', adminReq)).rejects.toThrow(BadRequestException);
  });

  it('delete removes entry and emits removed event', async () => {
    timeEntriesRepository.findByIdOrThrow.mockResolvedValue({
      id: 'e1',
      projectId: 'p1',
      billedAt: null,
    });

    await service.delete('p1', 'e1', adminReq);

    expect(timeEntriesRepository.delete).toHaveBeenCalledWith('e1');
    expect(projectBoardRealtime.emitToProject).toHaveBeenCalledWith('p1', PROJECTS_BOARD_EVENTS.timeEntryRemoved, {
      id: 'e1',
      projectId: 'p1',
    });
  });
});
