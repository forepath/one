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
  const projectTimeReportService = {
    generateLivePdf: jest.fn(),
  };

  let service: ProjectsAdminService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ProjectsAdminService(
      projectsRepository as never,
      projectsService as never,
      usersRepository as never,
      projectBillingService as never,
      projectTimeReportService as never,
    );
  });

  it('create requires tenant user via findByIdForTenant', async () => {
    usersRepository.findByIdForTenant.mockResolvedValue(null);

    await expect(service.create({ userId: 'missing', name: 'P', hourlyRateNet: 100 } as never)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('create persists optional targetHours', async () => {
    const created = { id: 'p1', targetHours: 40 };
    usersRepository.findByIdForTenant.mockResolvedValue({ id: 'u1' });
    projectsRepository.create.mockResolvedValue(created);
    projectsService.mapResponse.mockReturnValue(created);

    await service.create({ userId: 'u1', name: 'P', hourlyRateNet: 100, targetHours: 40 } as never);

    expect(projectsRepository.create).toHaveBeenCalledWith(expect.objectContaining({ targetHours: 40 }));
  });

  it('create stores null targetHours when omitted', async () => {
    const created = { id: 'p1', targetHours: null };
    usersRepository.findByIdForTenant.mockResolvedValue({ id: 'u1' });
    projectsRepository.create.mockResolvedValue(created);
    projectsService.mapResponse.mockReturnValue(created);

    await service.create({ userId: 'u1', name: 'P', hourlyRateNet: 100 } as never);

    expect(projectsRepository.create).toHaveBeenCalledWith(expect.objectContaining({ targetHours: null }));
  });

  it('update clears targetHours when null is sent', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'u1', hourlyRateNet: 100 });
    projectsRepository.countBilledTimeEntries.mockResolvedValue(0);
    projectsRepository.update.mockResolvedValue({ id: 'p1', targetHours: null });
    projectsService.mapResponse.mockReturnValue({ id: 'p1', targetHours: null });

    await service.update('p1', { targetHours: null } as never);

    expect(projectsRepository.update).toHaveBeenCalledWith('p1', expect.objectContaining({ targetHours: null }));
  });

  it('update omits targetHours when undefined', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'u1', hourlyRateNet: 100 });
    projectsRepository.countBilledTimeEntries.mockResolvedValue(0);
    projectsRepository.update.mockResolvedValue({ id: 'p1' });
    projectsService.mapResponse.mockReturnValue({ id: 'p1' });

    await service.update('p1', { name: 'Renamed' } as never);

    expect(projectsRepository.update).toHaveBeenCalledWith('p1', expect.objectContaining({ targetHours: undefined }));
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

  it('billTime delegates dto to billing service', async () => {
    const dto = {
      from: '2026-06-01T08:00:00.000Z',
      to: '2026-06-01T17:00:00.000Z',
      lineItems: [{ description: 'Extra', quantity: 1, unitPriceNet: 10 }],
    };
    projectBillingService.billUnbilledTime.mockResolvedValue({ invoiceId: 'inv-1', billedMinutes: 60, amountNet: 110 });

    const result = await service.billTime('p1', 'admin-1', dto);

    expect(result.invoiceId).toBe('inv-1');
    expect(projectBillingService.billUnbilledTime).toHaveBeenCalledWith('p1', 'admin-1', dto);
  });

  it('getUnbilledTimeBounds delegates to billing service', async () => {
    const from = new Date('2026-06-01T08:00:00.000Z');
    const to = new Date('2026-06-01T17:00:00.000Z');
    projectBillingService.getUnbilledTimeBounds.mockResolvedValue({ from, to, entryCount: 2 });

    const bounds = await service.getUnbilledTimeBounds('p1');

    expect(bounds.entryCount).toBe(2);
  });

  it('generateTimeReport delegates to time report service', async () => {
    const dto = {
      from: '2026-06-01T08:00:00.000Z',
      to: '2026-06-01T17:00:00.000Z',
      unbilledOnly: true,
    };
    const buffer = Buffer.from('pdf');

    projectTimeReportService.generateLivePdf.mockResolvedValue(buffer);

    await expect(service.generateTimeReport('p1', dto)).resolves.toBe(buffer);
    expect(projectTimeReportService.generateLivePdf).toHaveBeenCalledWith('p1', dto);
  });
});
