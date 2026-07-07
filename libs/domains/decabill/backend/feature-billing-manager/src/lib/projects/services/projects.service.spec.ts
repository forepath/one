import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@forepath/identity/backend';

import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  const projectsRepository = {
    findByIdOrThrow: jest.fn(),
    findAllByUser: jest.fn(),
  };
  const milestonesRepository = { findAllByProject: jest.fn().mockResolvedValue([]) };
  const ticketsRepository = {
    findAllByProject: jest.fn().mockResolvedValue([]),
    countByMilestone: jest.fn().mockResolvedValue({ open: 0, done: 0 }),
  };
  const timeEntriesRepository = {
    sumDurationMinutes: jest.fn().mockResolvedValue(0),
  };

  let service: ProjectsService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ProjectsService(
      projectsRepository as never,
      milestonesRepository as never,
      ticketsRepository as never,
      timeEntriesRepository as never,
    );
  });

  it('listForUser returns only user projects from repository', async () => {
    const project = {
      id: 'p1',
      userId: 'user-1',
      name: 'Project',
      description: null,
      status: 'active',
      hourlyRateNet: 100,
      currency: 'EUR',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    projectsRepository.findAllByUser.mockResolvedValue({ items: [project], total: 1 });
    timeEntriesRepository.sumDurationMinutes.mockResolvedValue(90);

    const result = await service.listForUser('user-1', 10, 0);

    expect(projectsRepository.findAllByUser).toHaveBeenCalledWith('user-1', 10, 0);
    expect(timeEntriesRepository.sumDurationMinutes).toHaveBeenCalledWith('p1', false);
    expect(result.total).toBe(1);
    expect(result.items[0]?.unbilledMinutes).toBe(90);
    expect(result.items[0]?.openBillableAmountNet).toBe(150);
  });

  it('getByIdForUser denies other users', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'owner' });

    await expect(
      service.getByIdForUser({ userId: 'other', userRole: UserRole.USER, isApiKeyAuth: false }, 'p1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('mapResponse maps targetHours number and null', () => {
    const withTarget = {
      id: 'p1',
      userId: 'user-1',
      name: 'Project',
      description: null,
      status: 'active',
      hourlyRateNet: 100,
      targetHours: '40.50',
      currency: 'EUR',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const withoutTarget = { ...withTarget, targetHours: null };

    expect(service.mapResponse(withTarget as never).targetHours).toBe(40.5);
    expect(service.mapResponse(withoutTarget as never).targetHours).toBeNull();
  });

  it('buildSummary counts open milestones that are not complete', async () => {
    const project = { id: 'p1', hourlyRateNet: 100 };
    const milestones = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }];

    milestonesRepository.findAllByProject.mockResolvedValue(milestones);
    ticketsRepository.countByMilestone
      .mockResolvedValueOnce({ open: 0, done: 0 })
      .mockResolvedValueOnce({ open: 1, done: 2 })
      .mockResolvedValueOnce({ open: 2, done: 0 });
    ticketsRepository.findAllByProject.mockResolvedValue([
      { status: 'todo' },
      { status: 'done' },
      { status: 'closed' },
    ]);
    timeEntriesRepository.sumDurationMinutes.mockResolvedValueOnce(120).mockResolvedValueOnce(60);

    const summary = await service.buildSummary(project as never);

    expect(summary.openMilestoneCount).toBe(2);
    expect(summary.milestoneCount).toBe(3);
    expect(summary.openTicketCount).toBe(1);
    expect(summary.doneTicketCount).toBe(2);
  });
});
