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
  const storedFileRegistry = {
    findMapForKeys: jest.fn().mockResolvedValue(new Map()),
    findByScopeKey: jest.fn().mockResolvedValue(null),
    verifyFromStorage: jest.fn().mockResolvedValue(true),
    cacheKey: (scope: string, storageKey: string) => `${scope}::${storageKey}`,
    toShas: jest.fn(),
  };
  const storedFileSigningConfig = {
    getSecret: jest.fn().mockReturnValue(null),
  };

  const service = new AdminFileManagerService(
    dataSource as never,
    fileStorage as never,
    tenantsGlobalViewsConfig as never,
    billingTenantService as never,
    storedFileRegistry as never,
    storedFileSigningConfig as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tenantsGlobalViewsConfig.isGlobalViewsAllowedForTenant.mockReturnValue(false);
    dataSource.query.mockResolvedValue([]);
    storedFileRegistry.findMapForKeys.mockResolvedValue(new Map());
    storedFileRegistry.findByScopeKey.mockResolvedValue(null);
    storedFileSigningConfig.getSecret.mockReturnValue(null);
  });

  it('lists scope roots for tenant view', async () => {
    const result = await runWithTenantId('default', () => service.listDirectory('', AdminFileManagerView.TENANT));

    expect(result.entries.map((entry) => entry.name)).toEqual(['customer', 'export', 'supplier']);
    expect(result.viewTenantId).toBe('default');
  });

  it('materializes empty structural folders under customer', async () => {
    const result = await runWithTenantId('default', () =>
      service.listDirectory('customer', AdminFileManagerView.TENANT),
    );

    expect(result.entries.map((entry) => entry.name)).toEqual(['invoices', 'offers', 'timesheets']);
    expect(result.entries.every((entry) => entry.type === 'directory')).toBe(true);
  });

  it('lists nested directories and files from DB keys', async () => {
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM billing_invoices i')) {
        return [{ pdf_storage_key: 'sub-1/inv-1.pdf', time_report_storage_key: null, created_at: new Date() }];
      }

      return [];
    });

    const result = await runWithTenantId('default', () =>
      service.listDirectory('customer/invoices', AdminFileManagerView.TENANT),
    );

    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'sub-1', type: 'directory', path: 'customer/invoices/sub-1' }),
      ]),
    );

    const nested = await runWithTenantId('default', () =>
      service.listDirectory('customer/invoices/sub-1', AdminFileManagerView.TENANT),
    );

    expect(nested.entries).toEqual([
      expect.objectContaining({
        name: 'inv-1.pdf',
        type: 'file',
        path: 'customer/invoices/sub-1/inv-1.pdf',
        scope: FileStorageScope.customerInvoices,
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
      service.downloadFile('customer/invoices/sub-1/inv-1.pdf', AdminFileManagerView.TENANT),
    );

    expect(result.fileName).toBe('inv-1.pdf');
    expect(fileStorage.readFile).toHaveBeenCalledWith(FileStorageScope.customerInvoices, 'sub-1/inv-1.pdf');
  });

  it('rejects download of unknown path', async () => {
    await expect(
      runWithTenantId('default', () =>
        service.downloadFile('customer/invoices/missing.pdf', AdminFileManagerView.TENANT),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('still downloads when stored signature verification fails', async () => {
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM billing_invoices i')) {
        return [{ pdf_storage_key: 'sub-1/inv-1.pdf', time_report_storage_key: null, created_at: new Date() }];
      }

      return [];
    });
    storedFileSigningConfig.getSecret.mockReturnValue('secret');
    storedFileRegistry.findByScopeKey.mockResolvedValue({ signature: 'abc' } as never);
    storedFileRegistry.verifyFromStorage.mockResolvedValue(false);
    fileStorage.readFile.mockResolvedValue(Buffer.from('pdf'));

    const result = await runWithTenantId('default', () =>
      service.downloadFile('customer/invoices/sub-1/inv-1.pdf', AdminFileManagerView.TENANT),
    );

    expect(result.buffer.toString()).toBe('pdf');
    expect(storedFileRegistry.verifyFromStorage).toHaveBeenCalled();
  });

  it('still downloads when signing is enabled but signature is still pending', async () => {
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM billing_invoices i')) {
        return [{ pdf_storage_key: 'sub-1/inv-1.pdf', time_report_storage_key: null, created_at: new Date() }];
      }

      return [];
    });
    storedFileSigningConfig.getSecret.mockReturnValue('secret');
    storedFileRegistry.findByScopeKey.mockResolvedValue({ signature: null } as never);
    fileStorage.readFile.mockResolvedValue(Buffer.from('pdf'));

    const result = await runWithTenantId('default', () =>
      service.downloadFile('customer/invoices/sub-1/inv-1.pdf', AdminFileManagerView.TENANT),
    );

    expect(result.buffer.toString()).toBe('pdf');
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
      service.downloadArchive('customer/invoices/sub-1', AdminFileManagerView.TENANT),
    );

    expect(result.fileName).toBe('sub-1.zip');
    expect(result.buffer.byteLength).toBeGreaterThan(0);
  });

  it('still archives when a member signature verification fails', async () => {
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM billing_invoices i')) {
        return [
          { pdf_storage_key: 'sub-1/a.pdf', time_report_storage_key: null, created_at: new Date() },
          { pdf_storage_key: 'sub-1/b.pdf', time_report_storage_key: null, created_at: new Date() },
        ];
      }

      return [];
    });
    storedFileSigningConfig.getSecret.mockReturnValue('secret');
    storedFileRegistry.findByScopeKey.mockResolvedValue({ signature: 'abc' } as never);
    storedFileRegistry.verifyFromStorage.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    fileStorage.readFile.mockResolvedValue(Buffer.from('x'));

    const result = await runWithTenantId('default', () =>
      service.downloadArchive('customer/invoices/sub-1', AdminFileManagerView.TENANT),
    );

    expect(result.fileName).toBe('sub-1.zip');
    expect(storedFileRegistry.verifyFromStorage).toHaveBeenCalled();
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
      runWithTenantId('default', () => service.downloadArchive('customer/invoices/bulk', AdminFileManagerView.TENANT)),
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
      service.listDirectory('export/datev/default/2026/01', AdminFileManagerView.TENANT),
    );

    expect(result.entries).toEqual([
      expect.objectContaining({
        name: 'export.zip',
        type: 'file',
        path: 'export/datev/default/2026/01/export.zip',
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
