import { BadRequestException } from '@nestjs/common';

import { ProjectBillingService } from './project-billing.service';

describe('ProjectBillingService', () => {
  const projectsRepository = { findByIdOrThrow: jest.fn() };
  const timeEntriesRepository = {
    findUnbilledByProjectInRange: jest.fn(),
    findUnbilledTimeBounds: jest.fn(),
    markBilled: jest.fn(),
  };
  const customerProfilesService = {
    getByUserId: jest.fn(),
    isProfileComplete: jest.fn(),
  };
  const invoiceService = { createDraft: jest.fn() };
  const invoiceIssuanceService = { issueDraft: jest.fn() };
  const auditLog = { log: jest.fn() };
  const projectBoardSummary = { emitSummaryChanged: jest.fn() };

  let service: ProjectBillingService;

  const project = {
    id: 'p1',
    userId: 'u1',
    name: 'Proj',
    hourlyRateNet: 100,
    currency: 'EUR',
  };

  const from = new Date('2026-06-01T08:00:00.000Z');
  const to = new Date('2026-06-01T17:00:00.000Z');

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ProjectBillingService(
      projectsRepository as never,
      timeEntriesRepository as never,
      customerProfilesService as never,
      invoiceService as never,
      invoiceIssuanceService as never,
      auditLog as never,
      projectBoardSummary as never,
    );
  });

  it('rejects when customer profile incomplete', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);
    customerProfilesService.getByUserId.mockResolvedValue(null);
    customerProfilesService.isProfileComplete.mockReturnValue(false);

    await expect(service.billUnbilledTime('p1', 'admin-1', { from, to })).rejects.toThrow(BadRequestException);
  });

  it('rejects when no unbilled entries in range', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);
    customerProfilesService.getByUserId.mockResolvedValue({ id: 'profile' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);
    timeEntriesRepository.findUnbilledByProjectInRange.mockResolvedValue([]);

    await expect(service.billUnbilledTime('p1', 'admin-1', { from, to })).rejects.toThrow(BadRequestException);
  });

  it('rejects invalid range', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);

    await expect(
      service.billUnbilledTime('p1', 'admin-1', {
        from: to,
        to: from,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('bills unbilled entries within range', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);
    customerProfilesService.getByUserId.mockResolvedValue({ id: 'profile' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);
    timeEntriesRepository.findUnbilledByProjectInRange.mockResolvedValue([
      { id: 'e1', durationMinutes: 60 },
      { id: 'e2', durationMinutes: 30 },
    ]);
    invoiceService.createDraft.mockResolvedValue({ id: 'draft-1' });
    invoiceIssuanceService.issueDraft.mockResolvedValue({ id: 'inv-1', invoiceNumber: 'INV-1' });

    const result = await service.billUnbilledTime('p1', 'admin-1', { from, to });

    expect(result.billedMinutes).toBe(90);
    expect(result.amountNet).toBe(150);
    expect(timeEntriesRepository.markBilled).toHaveBeenCalledWith(['e1', 'e2'], 'inv-1', expect.any(Date));
    expect(projectBoardSummary.emitSummaryChanged).toHaveBeenCalledWith(project);
  });

  it('returns unbilled time bounds', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);
    timeEntriesRepository.findUnbilledTimeBounds.mockResolvedValue({
      from,
      to,
      entryCount: 2,
    });

    const bounds = await service.getUnbilledTimeBounds('p1');

    expect(bounds).toEqual({ from, to, entryCount: 2 });
  });
});
