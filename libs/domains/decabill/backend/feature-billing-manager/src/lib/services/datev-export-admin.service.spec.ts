import { runWithTenantId } from '@forepath/shared/backend';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { DatevExportScope, DatevExportStatus } from '../constants/datev-export.constants';

import { DatevExportAdminService } from './datev-export-admin.service';

describe('DatevExportAdminService', () => {
  const configService = {
    isUnifiedExportAllowedForTenant: jest.fn(),
    resolveForTenant: jest.fn(),
    resolveUnified: jest.fn(),
    isUnifiedExportEnabled: jest.fn(),
  };
  const exportRepository = {
    findAllForAdmin: jest.fn(),
    findById: jest.fn(),
    findByPeriod: jest.fn(),
  };
  const storageService = {
    readFile: jest.fn(),
  };
  const enqueuePort = {
    enqueueUnit: jest.fn(),
  };

  const service = new DatevExportAdminService(
    configService as never,
    exportRepository as never,
    storageService as never,
    enqueuePort as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    configService.isUnifiedExportAllowedForTenant.mockReturnValue(true);
    configService.resolveForTenant.mockReturnValue({ consultantNumber: '1', clientNumber: '2' });
    configService.resolveUnified.mockReturnValue({ consultantNumber: '1', clientNumber: '2' });
    configService.isUnifiedExportEnabled.mockReturnValue(true);
    exportRepository.findByPeriod.mockResolvedValue(null);
  });

  it('lists tenant-scoped exports for request tenant', async () => {
    exportRepository.findAllForAdmin.mockResolvedValue({
      items: [
        {
          id: 'exp-1',
          scope: DatevExportScope.TENANT,
          tenantId: 'default',
          periodYear: 2026,
          periodMonth: 1,
          status: DatevExportStatus.COMPLETED,
          bookingCount: 1,
          invoiceCount: 1,
          debtorCount: 1,
          createdAt: new Date(),
        },
      ],
      total: 1,
    });

    const result = await runWithTenantId('default', () => service.listExports(DatevExportScope.TENANT, 20, 0));

    expect(result.total).toBe(1);
    expect(exportRepository.findAllForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ scope: DatevExportScope.TENANT, tenantId: 'default' }),
    );
  });

  it('rejects unified list when tenant not in allowlist', async () => {
    configService.isUnifiedExportAllowedForTenant.mockReturnValue(false);

    await expect(
      runWithTenantId('acme', () => service.listExports(DatevExportScope.UNIFIED, 20, 0)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects cross-tenant download', async () => {
    exportRepository.findById.mockResolvedValue({
      id: 'exp-1',
      scope: DatevExportScope.TENANT,
      tenantId: 'other',
      status: DatevExportStatus.COMPLETED,
      storageKey: 'other/2026/01/export.zip',
      fileName: 'export.zip',
    });

    await expect(runWithTenantId('default', () => service.downloadExport('exp-1'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('downloads completed export file', async () => {
    exportRepository.findById.mockResolvedValue({
      id: 'exp-1',
      scope: DatevExportScope.TENANT,
      tenantId: 'default',
      status: DatevExportStatus.COMPLETED,
      storageKey: 'default/2026/01/export.zip',
      fileName: 'datev-export-2026-01.zip',
    });
    storageService.readFile.mockResolvedValue(Buffer.from('zip'));

    const result = await runWithTenantId('default', () => service.downloadExport('exp-1'));

    expect(result.fileName).toBe('datev-export-2026-01.zip');
  });

  it('throws when export file is not completed', async () => {
    exportRepository.findById.mockResolvedValue({
      id: 'exp-1',
      scope: DatevExportScope.TENANT,
      tenantId: 'default',
      status: DatevExportStatus.RUNNING,
    });

    await expect(runWithTenantId('default', () => service.downloadExport('exp-1'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('queues manual trigger when configuration is valid', async () => {
    const result = await runWithTenantId('default', () =>
      service.triggerExport('admin-user', { year: 2026, month: 1 }),
    );

    expect(result.queued).toBe(true);
    expect(enqueuePort.enqueueUnit).toHaveBeenCalled();
  });

  it('rejects trigger when tenant DATEV configuration is incomplete', async () => {
    configService.resolveForTenant.mockReturnValue(null);

    await expect(
      runWithTenantId('default', () => service.triggerExport('admin-user', { year: 2026, month: 1 })),
    ).rejects.toThrow('DATEV export configuration is incomplete for this tenant');
    expect(enqueuePort.enqueueUnit).not.toHaveBeenCalled();
  });

  it('rejects trigger when export is already completed without force', async () => {
    exportRepository.findByPeriod.mockResolvedValue({ status: DatevExportStatus.COMPLETED });

    await expect(
      runWithTenantId('default', () => service.triggerExport('admin-user', { year: 2026, month: 1 })),
    ).rejects.toThrow('Export for this period is already completed');
    expect(enqueuePort.enqueueUnit).not.toHaveBeenCalled();
  });

  it('rejects trigger when export is already in progress', async () => {
    exportRepository.findByPeriod.mockResolvedValue({ status: DatevExportStatus.RUNNING });

    await expect(
      runWithTenantId('default', () => service.triggerExport('admin-user', { year: 2026, month: 1 })),
    ).rejects.toThrow('Export for this period is already in progress');
    expect(enqueuePort.enqueueUnit).not.toHaveBeenCalled();
  });

  it('rejects unified trigger when unified export is disabled', async () => {
    configService.isUnifiedExportEnabled.mockReturnValue(false);

    await expect(
      runWithTenantId('default', () =>
        service.triggerExport('admin-user', { year: 2026, month: 1, scope: DatevExportScope.UNIFIED }),
      ),
    ).rejects.toThrow('Unified DATEV export is disabled');
  });
});
