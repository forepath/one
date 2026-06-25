jest.mock('archiver', () => ({
  ZipArchive: jest.fn().mockImplementation(() => ({
    pipe: jest.fn(),
    append: jest.fn(),
    finalize: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  })),
}));

import { DatevExportScope, DatevExportStatus } from '../constants/datev-export.constants';
import { DatevExportJobHandler } from './datev-export.job-handler';

describe('DatevExportJobHandler', () => {
  const configService = {
    isEnabled: jest.fn().mockReturnValue(true),
    isUnifiedExportEnabled: jest.fn().mockReturnValue(false),
    getExportTimezone: jest.fn().mockReturnValue('Europe/Berlin'),
    resolveForTenant: jest.fn().mockReturnValue({ consultantNumber: '1', clientNumber: '2' }),
  };
  const exportRepository = {
    findByPeriod: jest.fn(),
  };
  const exportService = {
    runExport: jest.fn(),
  };
  const auditLog = {
    log: jest.fn(),
  };

  const handler = new DatevExportJobHandler(
    configService as never,
    exportRepository as never,
    exportService as never,
    auditLog as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    configService.isEnabled.mockReturnValue(true);
    configService.isUnifiedExportEnabled.mockReturnValue(false);
    configService.resolveForTenant.mockReturnValue({ consultantNumber: '1', clientNumber: '2' });
    exportRepository.findByPeriod.mockResolvedValue(null);
  });

  it('no-ops when disabled', async () => {
    configService.isEnabled.mockReturnValue(false);

    await handler.runUnit({
      tenantId: 'default',
      scope: DatevExportScope.TENANT,
      year: 2026,
      month: 1,
      triggeredBy: 'scheduler',
    });

    expect(exportService.runExport).not.toHaveBeenCalled();
  });

  it('skips completed exports unless force is set', async () => {
    exportRepository.findByPeriod.mockResolvedValue({ status: DatevExportStatus.COMPLETED });

    const skip = await handler.shouldSkipExport(DatevExportScope.TENANT, 'default', 2026, 1);

    expect(skip).toBe(true);
    expect(await handler.shouldSkipExport(DatevExportScope.TENANT, 'default', 2026, 1, true)).toBe(false);
  });

  it('skips pending and running exports unless force is set', async () => {
    exportRepository.findByPeriod.mockResolvedValue({ status: DatevExportStatus.RUNNING });

    expect(await handler.shouldSkipExport(DatevExportScope.TENANT, 'default', 2026, 1)).toBe(true);

    exportRepository.findByPeriod.mockResolvedValue({ status: DatevExportStatus.PENDING });
    expect(await handler.shouldSkipExport(DatevExportScope.TENANT, 'default', 2026, 1)).toBe(true);

    exportRepository.findByPeriod.mockResolvedValue({ status: DatevExportStatus.FAILED });
    expect(await handler.shouldSkipExport(DatevExportScope.TENANT, 'default', 2026, 1)).toBe(false);
  });

  it('runs export and logs completion', async () => {
    exportRepository.findByPeriod.mockResolvedValue(null);
    exportService.runExport.mockResolvedValue({
      id: 'export-1',
      status: DatevExportStatus.COMPLETED,
      bookingCount: 2,
      invoiceCount: 1,
    });

    await handler.runUnit({
      tenantId: 'default',
      scope: DatevExportScope.TENANT,
      year: 2026,
      month: 1,
      triggeredBy: 'scheduler',
    });

    expect(exportService.runExport).toHaveBeenCalled();
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ process: 'datev_export_completed' }));
  });
});
