import { BadRequestException } from '@nestjs/common';

import { ProjectBillingService } from './project-billing.service';

describe('ProjectBillingService', () => {
  const projectsRepository = { findByIdOrThrow: jest.fn() };
  const timeEntriesRepository = { findUnbilledByProject: jest.fn(), markBilled: jest.fn() };
  const customerProfilesService = {
    getByUserId: jest.fn(),
    isProfileComplete: jest.fn(),
  };
  const invoiceService = { createDraft: jest.fn() };
  const invoiceIssuanceService = { issueDraft: jest.fn() };
  const auditLog = { log: jest.fn() };
  const projectsService = { buildSummary: jest.fn() };
  const projectBoardRealtime = { emitToProject: jest.fn() };

  let service: ProjectBillingService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ProjectBillingService(
      projectsRepository as never,
      timeEntriesRepository as never,
      customerProfilesService as never,
      invoiceService as never,
      invoiceIssuanceService as never,
      auditLog as never,
      projectsService as never,
      projectBoardRealtime as never,
    );
  });

  it('rejects when customer profile incomplete', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'p1',
      userId: 'u1',
      name: 'Proj',
      hourlyRateNet: 100,
      currency: 'EUR',
    });
    customerProfilesService.getByUserId.mockResolvedValue(null);
    customerProfilesService.isProfileComplete.mockReturnValue(false);

    await expect(service.billUnbilledTime('p1', 'admin-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects when no unbilled entries', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'p1',
      userId: 'u1',
      name: 'Proj',
      hourlyRateNet: 100,
      currency: 'EUR',
    });
    customerProfilesService.getByUserId.mockResolvedValue({ id: 'profile' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);
    timeEntriesRepository.findUnbilledByProject.mockResolvedValue([]);

    await expect(service.billUnbilledTime('p1', 'admin-1')).rejects.toThrow(BadRequestException);
  });
});
