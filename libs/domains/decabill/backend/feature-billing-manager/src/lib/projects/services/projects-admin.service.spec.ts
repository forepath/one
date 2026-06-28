import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ProjectsAdminService } from './projects-admin.service';

describe('ProjectsAdminService', () => {
  const projectsRepository = {
    findAll: jest.fn(),
    findByIdOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    countBilledTimeEntries: jest.fn(),
    countUnbilledTimeEntries: jest.fn(),
  };
  const projectsService = {
    mapResponse: jest.fn((p) => p),
    buildSummary: jest.fn(),
  };
  const usersRepository = {
    findByIdForTenant: jest.fn(),
  };
  const projectBillingService = {
    billUnbilledTime: jest.fn(),
    getUnbilledTimeBounds: jest.fn(),
  };

  let service: ProjectsAdminService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ProjectsAdminService(
      projectsRepository as never,
      projectsService as never,
      usersRepository as never,
      projectBillingService as never,
    );
  });

  it('create requires tenant user via findByIdForTenant', async () => {
    usersRepository.findByIdForTenant.mockResolvedValue(null);

    await expect(service.create({ userId: 'missing', name: 'P', hourlyRateNet: 100 } as never)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('delete blocked when unbilled time entries exist', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1' });
    projectsRepository.countUnbilledTimeEntries.mockResolvedValue(2);

    await expect(service.delete('p1')).rejects.toThrow(BadRequestException);
  });

  it('update blocks userId change after billed time', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'u1', hourlyRateNet: 100 });
    projectsRepository.countBilledTimeEntries.mockResolvedValue(1);

    await expect(service.update('p1', { userId: 'u2' })).rejects.toThrow(BadRequestException);
  });

  it('update blocks hourly rate change after first bill', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'u1', hourlyRateNet: 100 });
    projectsRepository.countBilledTimeEntries.mockResolvedValue(1);

    await expect(service.update('p1', { hourlyRateNet: 120 })).rejects.toThrow(BadRequestException);
  });

  it('billTime delegates range to billing service', async () => {
    const dto = { from: '2026-06-01T08:00:00.000Z', to: '2026-06-01T17:00:00.000Z' };
    projectBillingService.billUnbilledTime.mockResolvedValue({ invoiceId: 'inv-1', billedMinutes: 60, amountNet: 100 });

    const result = await service.billTime('p1', 'admin-1', dto);

    expect(result.invoiceId).toBe('inv-1');
    expect(projectBillingService.billUnbilledTime).toHaveBeenCalledWith('p1', 'admin-1', {
      from: new Date(dto.from),
      to: new Date(dto.to),
    });
  });

  it('getUnbilledTimeBounds delegates to billing service', async () => {
    const from = new Date('2026-06-01T08:00:00.000Z');
    const to = new Date('2026-06-01T17:00:00.000Z');
    projectBillingService.getUnbilledTimeBounds.mockResolvedValue({ from, to, entryCount: 2 });

    const bounds = await service.getUnbilledTimeBounds('p1');

    expect(bounds.entryCount).toBe(2);
  });
});
