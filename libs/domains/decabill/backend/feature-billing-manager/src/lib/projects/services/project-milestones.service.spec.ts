import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@forepath/identity/backend';

import { ProjectMilestonesService } from './project-milestones.service';
import { PROJECTS_BOARD_EVENTS } from './project-board-realtime.constants';

describe('ProjectMilestonesService', () => {
  const projectsRepository = { findByIdOrThrow: jest.fn() };
  const milestonesRepository = {
    findAllByProject: jest.fn(),
    create: jest.fn(),
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const ticketsRepository = { countByMilestone: jest.fn() };
  const projectBoardRealtime = { emitToProject: jest.fn() };
  const projectBoardSummary = { emitSummaryChanged: jest.fn() };

  const adminInfo = {
    userId: 'admin-1',
    userRole: UserRole.ADMIN,
    isApiKeyAuth: false,
  };
  const project = { id: 'p1', userId: 'admin-1' };
  const milestone = {
    id: 'm1',
    projectId: 'p1',
    name: 'M1',
    description: null,
    targetDate: null,
    sortOrder: 0,
    lockedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let service: ProjectMilestonesService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ProjectMilestonesService(
      projectsRepository as never,
      milestonesRepository as never,
      ticketsRepository as never,
      projectBoardRealtime as never,
      projectBoardSummary as never,
    );
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);
    ticketsRepository.countByMilestone.mockResolvedValue({ open: 1, done: 2 });
  });

  it('lists milestones for readable project', async () => {
    milestonesRepository.findAllByProject.mockResolvedValue([milestone]);

    const result = await service.list('p1', adminInfo);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'm1',
        progressPercent: 67,
        openTicketCount: 1,
        doneTicketCount: 2,
      }),
    ]);
  });

  it('creates milestone and emits realtime events', async () => {
    milestonesRepository.create.mockResolvedValue(milestone);

    const result = await service.create('p1', { name: 'M1' }, adminInfo);

    expect(result.id).toBe('m1');
    expect(projectBoardRealtime.emitToProject).toHaveBeenCalledWith(
      'p1',
      PROJECTS_BOARD_EVENTS.milestoneUpsert,
      expect.objectContaining({ id: 'm1' }),
    );
    expect(projectBoardSummary.emitSummaryChanged).toHaveBeenCalledWith(project);
  });

  it('update rejects milestone from another project', async () => {
    milestonesRepository.findByIdOrThrow.mockResolvedValue({ ...milestone, projectId: 'other' });

    await expect(service.update('p1', 'm1', { name: 'New' }, adminInfo)).rejects.toThrow(ForbiddenException);
  });

  it('update rejects locked milestone', async () => {
    milestonesRepository.findByIdOrThrow.mockResolvedValue({ ...milestone, lockedAt: new Date() });

    await expect(service.update('p1', 'm1', { name: 'New' }, adminInfo)).rejects.toThrow(BadRequestException);
  });

  it('lock milestone sets lockedAt when not already locked', async () => {
    milestonesRepository.findByIdOrThrow.mockResolvedValue(milestone);
    milestonesRepository.update.mockResolvedValue({ ...milestone, lockedAt: new Date() });

    const result = await service.lock('p1', 'm1', adminInfo);

    expect(result.lockedAt).toBeTruthy();
    expect(milestonesRepository.update).toHaveBeenCalledWith('m1', { lockedAt: expect.any(Date) });
  });

  it('delete rejects locked milestone', async () => {
    milestonesRepository.findByIdOrThrow.mockResolvedValue({ ...milestone, lockedAt: new Date() });

    await expect(service.delete('p1', 'm1', adminInfo)).rejects.toThrow(BadRequestException);
  });

  it('delete removes milestone and emits removed event', async () => {
    milestonesRepository.findByIdOrThrow.mockResolvedValue(milestone);

    await service.delete('p1', 'm1', adminInfo);

    expect(milestonesRepository.delete).toHaveBeenCalledWith('m1');
    expect(projectBoardRealtime.emitToProject).toHaveBeenCalledWith('p1', PROJECTS_BOARD_EVENTS.milestoneRemoved, {
      id: 'm1',
      projectId: 'p1',
    });
  });
});
