import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@forepath/identity/backend';

import { ProjectTimeEntriesService } from './project-time-entries.service';

describe('ProjectTimeEntriesService', () => {
  const projectsRepository = { findByIdOrThrow: jest.fn() };
  const timeEntriesRepository = { create: jest.fn() };
  const ticketsRepository = { findByIdOrThrow: jest.fn() };
  const projectBoardRealtime = { emitToProject: jest.fn() };
  const projectBoardSummary = { emitSummaryChanged: jest.fn() };

  let service: ProjectTimeEntriesService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ProjectTimeEntriesService(
      projectsRepository as never,
      timeEntriesRepository as never,
      ticketsRepository as never,
      projectBoardRealtime as never,
      projectBoardSummary as never,
    );
  });

  it('create rejects time entry for locked ticket', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'admin-1' });
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
        {
          user: { id: 'admin-1', roles: [UserRole.ADMIN] },
          apiKeyAuthenticated: false,
        } as never,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(timeEntriesRepository.create).not.toHaveBeenCalled();
  });
});
