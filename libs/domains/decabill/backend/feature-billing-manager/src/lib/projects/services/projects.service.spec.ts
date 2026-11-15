import { UserRole } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';

import { ProjectPricingModel } from '../entities/project.enums';

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

    expect(projectsRepository.findAllByUser).toHaveBeenCalledWith('user-1', 10, 0, undefined);
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

  it('buildSummary keeps hourly amounts and reports no remaining price', async () => {
    milestonesRepository.findAllByProject.mockResolvedValue([]);
    ticketsRepository.findAllByProject.mockResolvedValue([]);
    timeEntriesRepository.sumDurationMinutes.mockResolvedValueOnce(180).mockResolvedValueOnce(60);

    const summary = await service.buildSummary({ id: 'p1', hourlyRateNet: 100 } as never);

    expect(summary.openBillableAmountNet).toBe(100);
    expect(summary.billedAmountNet).toBe(200);
    expect(summary.remainingPriceNet).toBeNull();
  });

  it('buildSummary limits open billable amount by the remaining maximum price', async () => {
    milestonesRepository.findAllByProject.mockResolvedValue([]);
    ticketsRepository.findAllByProject.mockResolvedValue([]);
    timeEntriesRepository.sumDurationMinutes.mockResolvedValueOnce(600).mockResolvedValueOnce(180);

    const summary = await service.buildSummary({
      id: 'p1',
      hourlyRateNet: '100.0000',
      pricingModel: ProjectPricingModel.CAPPED,
      priceLimitNet: '1000.0000',
      billedAmountNet: '850.0000',
    } as never);

    expect(summary.openBillableAmountNet).toBe(150);
    expect(summary.billedAmountNet).toBe(850);
    expect(summary.remainingPriceNet).toBe(150);
  });

  it('buildSummary reports the remaining fixed price as open billable', async () => {
    milestonesRepository.findAllByProject.mockResolvedValue([]);
    ticketsRepository.findAllByProject.mockResolvedValue([]);
    timeEntriesRepository.sumDurationMinutes.mockResolvedValueOnce(60).mockResolvedValueOnce(60);

    const summary = await service.buildSummary({
      id: 'p1',
      hourlyRateNet: 0,
      pricingModel: ProjectPricingModel.FIXED,
      priceLimitNet: 5000,
      billedAmountNet: 2000,
    } as never);

    expect(summary.openBillableAmountNet).toBe(3000);
    expect(summary.remainingPriceNet).toBe(3000);
  });

  it('mapResponse exposes pricing and defaults legacy rows to hourly', () => {
    const base = { id: 'p1', userId: 'u1', name: 'P', status: 'active', hourlyRateNet: 100, currency: 'EUR' };

    expect(service.mapResponse(base as never)).toEqual(
      expect.objectContaining({ pricingModel: ProjectPricingModel.HOURLY, priceLimitNet: null }),
    );
    expect(
      service.mapResponse({ ...base, pricingModel: ProjectPricingModel.FIXED, priceLimitNet: '2500.0000' } as never),
    ).toEqual(expect.objectContaining({ pricingModel: ProjectPricingModel.FIXED, priceLimitNet: 2500 }));
  });
});
