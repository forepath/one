import { BadRequestException, ConflictException } from '@nestjs/common';

import { TaxCategory } from '../../constants/tax-category.constants';
import { TaxCalculationService } from '../../services/tax-calculation.service';
import { TaxRateConfigService } from '../../services/tax-rate-config.service';

import { ProjectBillingService } from './project-billing.service';

describe('ProjectBillingService', () => {
  const dataSource = {
    options: { type: 'sqlite' },
    transaction: jest.fn(async (callback: (manager: unknown) => Promise<unknown>) => callback({})),
  };
  const projectsRepository = { findByIdOrThrow: jest.fn() };
  const timeEntriesRepository = {
    findUnbilledByProjectInRangeForUpdate: jest.fn(),
    findUnbilledTimeBounds: jest.fn(),
    markBilled: jest.fn(),
  };
  const subscriptionsRepository = { findByIdOrThrow: jest.fn() };
  const invoicesRepository = { update: jest.fn() };
  const customerProfilesService = {
    getByUserId: jest.fn(),
    isProfileComplete: jest.fn(),
  };
  const invoiceService = { createDraft: jest.fn(), voidInvoice: jest.fn() };
  const invoiceIssuanceService = { issueDraft: jest.fn() };
  const billingEmailPublisher = { publishInvoiceIssued: jest.fn().mockResolvedValue(true) };
  const taxCalculationService = new TaxCalculationService(new TaxRateConfigService());
  const auditLog = { log: jest.fn() };
  const projectBoardSummary = { emitSummaryChanged: jest.fn() };
  const projectTimeReportService = {
    generateAndStoreForBilling: jest.fn().mockResolvedValue('sub-1/inv-1-time-report.pdf'),
  };

  let service: ProjectBillingService;

  const project = {
    id: 'p1',
    userId: 'u1',
    name: 'Proj',
    hourlyRateNet: 100,
    currency: 'EUR',
  };

  const from = '2026-06-01T08:00:00.000Z';
  const to = '2026-06-01T17:00:00.000Z';

  beforeEach(() => {
    jest.resetAllMocks();
    dataSource.transaction.mockImplementation(async (callback) => callback({}));
    projectTimeReportService.generateAndStoreForBilling.mockResolvedValue('sub-1/inv-1-time-report.pdf');
    timeEntriesRepository.markBilled.mockImplementation(async (_projectId: string, ids: string[]) => ids.length);
    invoiceService.voidInvoice.mockResolvedValue({ id: 'inv-1', status: 'void' });
    service = new ProjectBillingService(
      dataSource as never,
      projectsRepository as never,
      timeEntriesRepository as never,
      subscriptionsRepository as never,
      invoicesRepository as never,
      customerProfilesService as never,
      invoiceService as never,
      invoiceIssuanceService as never,
      billingEmailPublisher as never,
      taxCalculationService,
      auditLog as never,
      projectBoardSummary as never,
      projectTimeReportService as never,
    );
  });

  it('rejects when customer profile incomplete', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);
    customerProfilesService.getByUserId.mockResolvedValue(null);
    customerProfilesService.isProfileComplete.mockReturnValue(false);

    await expect(service.billUnbilledTime('p1', 'admin-1', { from, to })).rejects.toThrow(BadRequestException);
  });

  it('rejects when subscription does not belong to project user', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);
    customerProfilesService.getByUserId.mockResolvedValue({ id: 'profile' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: 'sub-1', userId: 'other-user' });

    await expect(service.billUnbilledTime('p1', 'admin-1', { from, to, subscriptionId: 'sub-1' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects when no unbilled entries in range', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);
    customerProfilesService.getByUserId.mockResolvedValue({ id: 'profile' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);
    timeEntriesRepository.findUnbilledByProjectInRangeForUpdate.mockResolvedValue([]);

    await expect(service.billUnbilledTime('p1', 'admin-1', { from, to })).rejects.toThrow(BadRequestException);
    expect(dataSource.transaction).toHaveBeenCalled();
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

  it('rejects project billing when payable gross is below checkout minimum', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({
      ...project,
      hourlyRateNet: 0.5,
    });
    customerProfilesService.getByUserId.mockResolvedValue({ id: 'profile' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);
    timeEntriesRepository.findUnbilledByProjectInRangeForUpdate.mockResolvedValue([{ id: 'e1', durationMinutes: 60 }]);

    await expect(service.billUnbilledTime('p1', 'admin-1', { from, to })).rejects.toThrow(
      /below the minimum payment amount/,
    );
    expect(invoiceService.createDraft).not.toHaveBeenCalled();
  });

  it('bills unbilled entries within range', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);
    customerProfilesService.getByUserId.mockResolvedValue({ id: 'profile' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);
    timeEntriesRepository.findUnbilledByProjectInRangeForUpdate.mockResolvedValue([
      { id: 'e1', durationMinutes: 60 },
      { id: 'e2', durationMinutes: 30 },
    ]);
    invoiceService.createDraft.mockResolvedValue({ id: 'draft-1' });
    invoiceIssuanceService.issueDraft.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-1',
      pdfStorageKey: 'sub-1/inv-1.pdf',
    });
    invoicesRepository.update.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-1',
      pdfStorageKey: 'sub-1/inv-1.pdf',
      timeReportStorageKey: 'sub-1/inv-1-time-report.pdf',
    });

    const result = await service.billUnbilledTime('p1', 'admin-1', { from, to });

    expect(result.billedMinutes).toBe(90);
    expect(result.amountNet).toBe(150);
    expect(invoiceIssuanceService.issueDraft).toHaveBeenCalledWith('draft-1', 14, { skipNotification: true });
    expect(timeEntriesRepository.markBilled).toHaveBeenCalledWith('p1', ['e1', 'e2'], 'inv-1', expect.any(Date));
    expect(billingEmailPublisher.publishInvoiceIssued).toHaveBeenCalledWith(
      expect.objectContaining({
        pdfStorageKey: 'sub-1/inv-1.pdf',
        timeReportStorageKey: 'sub-1/inv-1-time-report.pdf',
      }),
      'sub-1/inv-1.pdf',
    );
    expect(projectTimeReportService.generateAndStoreForBilling).toHaveBeenCalledWith(
      { id: 'inv-1', invoiceNumber: 'INV-1', pdfStorageKey: 'sub-1/inv-1.pdf' },
      project,
      expect.any(Array),
      expect.any(Date),
      expect.any(Date),
    );
    expect(invoicesRepository.update).toHaveBeenCalledWith('inv-1', {
      timeReportStorageKey: 'sub-1/inv-1-time-report.pdf',
    });
    expect(invoiceService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        projectId: 'p1',
        lineInputs: [
          expect.objectContaining({
            description: expect.stringMatching(/Proj \(.*–.*\)/),
            quantity: 1.5,
            unitPriceNet: 100,
            taxCategory: TaxCategory.STANDARD,
          }),
        ],
      }),
    );
    expect(projectBoardSummary.emitSummaryChanged).toHaveBeenCalledWith(project);
  });

  it('voids duplicate invoice when entries were billed concurrently', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);
    customerProfilesService.getByUserId.mockResolvedValue({ id: 'profile' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);
    timeEntriesRepository.findUnbilledByProjectInRangeForUpdate.mockResolvedValue([
      { id: 'e1', durationMinutes: 60 },
      { id: 'e2', durationMinutes: 30 },
    ]);
    invoiceService.createDraft.mockResolvedValue({ id: 'draft-1' });
    invoiceIssuanceService.issueDraft.mockResolvedValue({ id: 'inv-1', invoiceNumber: 'INV-1', subscriptionId: null });
    timeEntriesRepository.markBilled.mockResolvedValue(1);

    await expect(service.billUnbilledTime('p1', 'admin-1', { from, to })).rejects.toThrow(ConflictException);
    expect(invoiceService.voidInvoice).toHaveBeenCalledWith(
      'inv-1',
      null,
      'admin-1',
      expect.objectContaining({ reason: 'concurrent_bill_abort' }),
      { skipNotification: true },
    );
    expect(projectTimeReportService.generateAndStoreForBilling).not.toHaveBeenCalled();
    expect(invoicesRepository.update).not.toHaveBeenCalled();
    expect(billingEmailPublisher.publishInvoiceIssued).not.toHaveBeenCalled();
  });

  it('combines custom line items with generated time line', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);
    customerProfilesService.getByUserId.mockResolvedValue({ id: 'profile' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: 'sub-1', userId: 'u1' });
    timeEntriesRepository.findUnbilledByProjectInRangeForUpdate.mockResolvedValue([{ id: 'e1', durationMinutes: 60 }]);
    invoiceService.createDraft.mockResolvedValue({ id: 'draft-1' });
    invoiceIssuanceService.issueDraft.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-1',
      pdfStorageKey: 'sub-1/inv-1.pdf',
    });
    invoicesRepository.update.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-1',
      pdfStorageKey: 'sub-1/inv-1.pdf',
      timeReportStorageKey: 'sub-1/inv-1-time-report.pdf',
    });

    const result = await service.billUnbilledTime('p1', 'admin-1', {
      from,
      to,
      subscriptionId: 'sub-1',
      lineItems: [{ description: 'Materials', quantity: 1, unitPriceNet: 25 }],
    });

    expect(result.billedMinutes).toBe(60);
    expect(result.amountNet).toBe(125);
    expect(invoiceService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        lineInputs: [
          expect.objectContaining({
            description: expect.stringMatching(/Proj \(.*–.*\)/),
            quantity: 1,
            unitPriceNet: 100,
          }),
          expect.objectContaining({ description: 'Materials', unitPriceNet: 25 }),
        ],
      }),
    );
  });

  it('returns unbilled time bounds', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);
    timeEntriesRepository.findUnbilledTimeBounds.mockResolvedValue({
      from: new Date(from),
      to: new Date(to),
      entryCount: 2,
    });

    const bounds = await service.getUnbilledTimeBounds('p1');

    expect(bounds).toEqual({
      from: new Date(from),
      to: new Date(to),
      entryCount: 2,
    });
  });
});
