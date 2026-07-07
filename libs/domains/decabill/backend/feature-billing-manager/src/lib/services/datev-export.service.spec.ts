jest.mock('archiver', () => ({
  ZipArchive: jest.fn().mockImplementation(() => {
    let destination: NodeJS.WritableStream | undefined;

    return {
      pipe: jest.fn((dest: NodeJS.WritableStream) => {
        destination = dest;

        return dest;
      }),
      append: jest.fn(),
      finalize: jest.fn(async () => {
        if (destination && typeof destination.write === 'function') {
          destination.write(Buffer.from('PK'));
          destination.end();
        }
      }),
      on: jest.fn(),
    };
  }),
}));

import { runWithTenantId } from '@forepath/shared/backend';

import { DatevExportScope, DatevExportStatus } from '../constants/datev-export.constants';

import { DatevExportService } from './datev-export.service';

describe('DatevExportService', () => {
  const configService = {
    isEnabled: jest.fn().mockReturnValue(true),
    resolveForTenant: jest.fn().mockReturnValue({
      consultantNumber: '1',
      clientNumber: '2',
      chartOfAccounts: 'SKR03',
      accountLength: 4,
      revenueAccountStandard: '8400',
      revenueAccountReduced: '8300',
      debtorAccountStart: 10_000,
      debtorAccountEnd: 69_999,
      buKeyStandard: '',
      buKeyReduced: '',
      includeDocuments: false,
      dictationAbbr: 'DEC',
      fiscalYearStartMonth: 1,
    }),
    resolveUnified: jest.fn(),
  };
  const billingTenantService = {
    getConfiguredTenants: jest.fn().mockReturnValue(['default']),
  };
  const invoicesRepository = {
    findIssuedInPeriod: jest.fn().mockResolvedValue([]),
    findVoidedInPeriod: jest.fn().mockResolvedValue([]),
  };
  const exportRepository = {
    findByPeriod: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'exp-1', status: DatevExportStatus.PENDING }),
    update: jest.fn().mockImplementation((_id, data) =>
      Promise.resolve({
        id: 'exp-1',
        status: data.status ?? DatevExportStatus.COMPLETED,
        ...data,
      }),
    ),
  };
  const storageService = {
    writeFile: jest.fn(),
  };
  const extfCsvService = {
    buildBookingBatchCsv: jest.fn().mockReturnValue(Buffer.from('csv')),
    buildDebtorBatchCsv: jest.fn().mockReturnValue(Buffer.from('debtors')),
  };
  const bookingMapper = {
    mapIssuedLineItem: jest.fn(),
    mapVoidedLineItem: jest.fn(),
    mapPartialCreditDocument: jest.fn(),
  };
  const debtorMapper = { mapDebtorRow: jest.fn() };
  const debtorAccountService = { resolveDebtorNumber: jest.fn() };
  const documentArchiveService = {
    buildDocumentRelativePath: jest.fn(),
    buildBeleglink: jest.fn(),
    buildDocumentXml: jest.fn(),
    readInvoicePdf: jest.fn(),
  };
  const customerProfilesRepository = { findByUserId: jest.fn() };
  const voidDocumentsRepository = { findByInvoiceId: jest.fn() };

  const creditDocumentsRepository = { findWithdrawnInPeriod: jest.fn().mockResolvedValue([]) };
  const invoicePdfService = { readPdf: jest.fn() };

  const service = new DatevExportService(
    configService as never,
    billingTenantService as never,
    invoicesRepository as never,
    customerProfilesRepository as never,
    voidDocumentsRepository as never,
    creditDocumentsRepository as never,
    invoicePdfService as never,
    exportRepository as never,
    storageService as never,
    bookingMapper as never,
    debtorMapper as never,
    debtorAccountService as never,
    extfCsvService as never,
    documentArchiveService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    exportRepository.findByPeriod.mockResolvedValue(null);
    invoicesRepository.findIssuedInPeriod.mockResolvedValue([]);
    invoicesRepository.findVoidedInPeriod.mockResolvedValue([]);
    creditDocumentsRepository.findWithdrawnInPeriod.mockResolvedValue([]);
    billingTenantService.getConfiguredTenants.mockReturnValue(['default']);
    configService.isEnabled.mockReturnValue(true);
    configService.resolveForTenant.mockReturnValue({
      consultantNumber: '1',
      clientNumber: '2',
      chartOfAccounts: 'SKR03',
      accountLength: 4,
      revenueAccountStandard: '8400',
      revenueAccountReduced: '8300',
      debtorAccountStart: 10_000,
      debtorAccountEnd: 69_999,
      buKeyStandard: '',
      buKeyReduced: '',
      includeDocuments: false,
      dictationAbbr: 'DEC',
      fiscalYearStartMonth: 1,
    });
  });

  it('returns existing completed export without force', async () => {
    exportRepository.findByPeriod.mockResolvedValue({
      id: 'existing',
      status: DatevExportStatus.COMPLETED,
    });

    const result = await runWithTenantId('default', () =>
      service.runExport({
        scope: DatevExportScope.TENANT,
        tenantId: 'default',
        year: 2026,
        month: 1,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-01-31'),
        triggeredBy: 'scheduler',
      }),
    );

    expect(result.id).toBe('existing');
    expect(storageService.writeFile).not.toHaveBeenCalled();
  });

  it('writes zip for empty month export', async () => {
    const result = await runWithTenantId('default', () =>
      service.runExport({
        scope: DatevExportScope.TENANT,
        tenantId: 'default',
        year: 2026,
        month: 1,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-01-31'),
        triggeredBy: 'scheduler',
      }),
    );

    expect(result.status).toBe(DatevExportStatus.COMPLETED);
    expect(storageService.writeFile).toHaveBeenCalled();
    expect(extfCsvService.buildBookingBatchCsv).toHaveBeenCalled();
  });

  it('uses distinct PDF paths for unified exports with same invoice numbers', async () => {
    const invoice = {
      id: 'inv-1',
      userId: 'user-1',
      invoiceNumber: 'INV-2026-00001',
      issuedAt: new Date('2026-01-10'),
      createdAt: new Date('2026-01-10'),
      lineItems: [{ description: 'Line', lineGross: 10, taxCategory: 'standard' }],
    };

    billingTenantService.getConfiguredTenants.mockReturnValue(['default', 'acme']);
    invoicesRepository.findIssuedInPeriod
      .mockResolvedValueOnce([invoice])
      .mockResolvedValueOnce([{ ...invoice, id: 'inv-2' }]);
    customerProfilesRepository.findByUserId.mockResolvedValue({ userId: 'user-1', company: 'Co' });
    debtorAccountService.resolveDebtorNumber.mockResolvedValue(10_001);
    bookingMapper.mapIssuedLineItem.mockReturnValue(['row']);
    documentArchiveService.buildDocumentRelativePath.mockImplementation(
      (_scope, tenantId, fileName) => `belege/${tenantId}/${fileName}`,
    );

    await service.runExport({
      scope: DatevExportScope.UNIFIED,
      tenantId: 'default',
      year: 2026,
      month: 1,
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-31'),
      triggeredBy: 'scheduler',
    });

    const tenantIds = documentArchiveService.buildDocumentRelativePath.mock.calls.map((call) => call[1]);
    expect(tenantIds).toContain('default');
    expect(tenantIds).toContain('acme');
  });

  it('fails unified export when an invoice has no customer profile', async () => {
    const invoice = {
      id: 'inv-1',
      userId: 'user-1',
      invoiceNumber: 'INV-1',
      issuedAt: new Date('2026-01-10'),
      createdAt: new Date('2026-01-10'),
      lineItems: [{ description: 'Line', lineGross: 10, taxCategory: 'standard' }],
    };

    invoicesRepository.findIssuedInPeriod.mockResolvedValue([invoice]);
    customerProfilesRepository.findByUserId.mockResolvedValue(null);

    const result = await service.runExport({
      scope: DatevExportScope.TENANT,
      tenantId: 'default',
      year: 2026,
      month: 1,
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-31'),
      triggeredBy: 'scheduler',
    });

    expect(result.status).toBe(DatevExportStatus.FAILED);
    expect(result.errorMessage).toContain('Customer profile missing for invoice(s): inv-1');
  });

  it('uses per-tenant DATEV config for unified booking rows', async () => {
    const defaultConfig = {
      consultantNumber: '1',
      clientNumber: '2',
      chartOfAccounts: 'SKR03' as const,
      accountLength: 4,
      revenueAccountStandard: '8400',
      revenueAccountReduced: '8300',
      debtorAccountStart: 10_000,
      debtorAccountEnd: 69_999,
      buKeyStandard: '',
      buKeyReduced: '',
      includeDocuments: false,
      dictationAbbr: 'DEC',
      fiscalYearStartMonth: 1,
    };
    const acmeConfig = { ...defaultConfig, revenueAccountStandard: '8500' };
    const invoice = {
      id: 'inv-acme',
      userId: 'user-1',
      invoiceNumber: 'INV-ACME-1',
      issuedAt: new Date('2026-01-10'),
      createdAt: new Date('2026-01-10'),
      lineItems: [{ description: 'Line', lineGross: 10, taxCategory: 'standard' }],
    };

    configService.resolveUnified.mockReturnValue(defaultConfig);
    configService.resolveForTenant.mockImplementation((tenantId: string) =>
      tenantId === 'acme' ? acmeConfig : defaultConfig,
    );
    billingTenantService.getConfiguredTenants.mockReturnValue(['acme']);
    invoicesRepository.findIssuedInPeriod.mockResolvedValue([invoice]);
    customerProfilesRepository.findByUserId.mockResolvedValue({ userId: 'user-1', company: 'Acme' });
    debtorAccountService.resolveDebtorNumber.mockResolvedValue(10_001);
    bookingMapper.mapIssuedLineItem.mockReturnValue(['row']);

    await service.runExport({
      scope: DatevExportScope.UNIFIED,
      tenantId: 'default',
      year: 2026,
      month: 1,
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-31'),
      triggeredBy: 'scheduler',
    });

    expect(bookingMapper.mapIssuedLineItem).toHaveBeenCalledWith(expect.objectContaining({ config: acmeConfig }));
  });
});
