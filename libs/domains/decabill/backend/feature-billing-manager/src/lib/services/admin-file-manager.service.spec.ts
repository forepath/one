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

import { ForbiddenException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { runWithTenantId } from '@forepath/shared/backend';
import { FileStorageScope } from '@forepath/shared/backend/util-file-storage';

import { AdminFileManagerView } from '../constants/admin-file-manager.constants';
import { DatevExportScope, DatevExportStatus } from '../constants/datev-export.constants';

import { AdminFileManagerService } from './admin-file-manager.service';

describe('AdminFileManagerService', () => {
  const dataSource = {
    query: jest.fn(),
  };
  const fileStorage = {
    readFile: jest.fn(),
  };
  const tenantsGlobalViewsConfig = {
    isGlobalViewsAllowedForTenant: jest.fn(),
  };
  const billingTenantService = {
    getConfiguredTenants: jest.fn().mockReturnValue(['default', 'acme']),
  };

  const service = new AdminFileManagerService(
    dataSource as never,
    fileStorage as never,
    tenantsGlobalViewsConfig as never,
    billingTenantService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tenantsGlobalViewsConfig.isGlobalViewsAllowedForTenant.mockReturnValue(false);
    dataSource.query.mockResolvedValue([]);
  });

  it('lists scope roots for tenant view', async () => {
    const result = await runWithTenantId('default', () => service.listDirectory('', AdminFileManagerView.TENANT));

    expect(result.entries.map((entry) => entry.name)).toEqual(['datev-exports', 'invoices', 'supplier-invoices']);
    expect(result.viewTenantId).toBe('default');
  });

  it('lists nested directories and files from DB keys', async () => {
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM billing_invoices i')) {
        return [{ pdf_storage_key: 'sub-1/inv-1.pdf', time_report_storage_key: null, created_at: new Date() }];
      }

      return [];
    });

    const result = await runWithTenantId('default', () =>
      service.listDirectory('invoices', AdminFileManagerView.TENANT),
    );

    expect(result.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'sub-1', type: 'directory', path: 'invoices/sub-1' })]),
    );

    const nested = await runWithTenantId('default', () =>
      service.listDirectory('invoices/sub-1', AdminFileManagerView.TENANT),
    );

    expect(nested.entries).toEqual([
      expect.objectContaining({
        name: 'inv-1.pdf',
        type: 'file',
        path: 'invoices/sub-1/inv-1.pdf',
        scope: FileStorageScope.invoices,
      }),
    ]);
  });

  it('rejects foreign viewTenantId without global views', async () => {
    await expect(
      runWithTenantId('default', () => service.listDirectory('', AdminFileManagerView.TENANT, 'acme')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows foreign viewTenantId when global views allowed', async () => {
    tenantsGlobalViewsConfig.isGlobalViewsAllowedForTenant.mockReturnValue(true);

    const result = await runWithTenantId('default', () =>
      service.listDirectory('', AdminFileManagerView.TENANT, 'acme'),
    );

    expect(result.viewTenantId).toBe('acme');
  });

  it('rejects unified view without global views', async () => {
    await expect(
      runWithTenantId('default', () => service.listDirectory('', AdminFileManagerView.UNIFIED)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('downloads file only when path is in allow-set', async () => {
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM billing_invoices i')) {
        return [{ pdf_storage_key: 'sub-1/inv-1.pdf', time_report_storage_key: null, created_at: new Date() }];
      }

      return [];
    });
    fileStorage.readFile.mockResolvedValue(Buffer.from('pdf'));

    const result = await runWithTenantId('default', () =>
      service.downloadFile('invoices/sub-1/inv-1.pdf', AdminFileManagerView.TENANT),
    );

    expect(result.fileName).toBe('inv-1.pdf');
    expect(fileStorage.readFile).toHaveBeenCalledWith(FileStorageScope.invoices, 'sub-1/inv-1.pdf');
  });

  it('rejects download of unknown path', async () => {
    await expect(
      runWithTenantId('default', () => service.downloadFile('invoices/missing.pdf', AdminFileManagerView.TENANT)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('archives folder subtree from allow-set', async () => {
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM billing_invoices i')) {
        return [
          { pdf_storage_key: 'sub-1/a.pdf', time_report_storage_key: null, created_at: new Date() },
          { pdf_storage_key: 'sub-1/b.pdf', time_report_storage_key: null, created_at: new Date() },
        ];
      }

      return [];
    });
    fileStorage.readFile.mockResolvedValue(Buffer.from('x'));

    const result = await runWithTenantId('default', () =>
      service.downloadArchive('invoices/sub-1', AdminFileManagerView.TENANT),
    );

    expect(result.fileName).toBe('sub-1.zip');
    expect(result.buffer.byteLength).toBeGreaterThan(0);
  });

  it('rejects oversized archives by entry count', async () => {
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM billing_invoices i')) {
        return Array.from({ length: 501 }, (_, index) => ({
          pdf_storage_key: `bulk/f-${index}.pdf`,
          time_report_storage_key: null,
          created_at: new Date(),
        }));
      }

      return [];
    });

    await expect(
      runWithTenantId('default', () => service.downloadArchive('invoices/bulk', AdminFileManagerView.TENANT)),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('includes completed DATEV exports in allow-set', async () => {
    dataSource.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM billing_datev_exports') && params?.[0] === DatevExportScope.TENANT) {
        return [
          {
            storage_key: 'default/2026/01/export.zip',
            completed_at: new Date(),
            created_at: new Date(),
          },
        ];
      }

      return [];
    });

    const result = await runWithTenantId('default', () =>
      service.listDirectory('datev-exports/default/2026/01', AdminFileManagerView.TENANT),
    );

    expect(result.entries).toEqual([
      expect.objectContaining({
        name: 'export.zip',
        type: 'file',
        path: 'datev-exports/default/2026/01/export.zip',
      }),
    ]);
    expect(paramsHasCompletedStatus()).toBe(true);
  });

  function paramsHasCompletedStatus(): boolean {
    return dataSource.query.mock.calls.some(
      ([, params]) => Array.isArray(params) && params.includes(DatevExportStatus.COMPLETED),
    );
  }
});
