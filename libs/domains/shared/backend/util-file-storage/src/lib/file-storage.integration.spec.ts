import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { FileStorageLayoutMigrationService } from './file-storage-layout-migration.service';
import { FileStorageLegacyMigrationService } from './file-storage-legacy-migration.service';
import { FileStorageProviderFactory } from './file-storage-provider.factory';
import { FileStorageService } from './file-storage.service';
import { LocalFileStorageProvider } from './providers/local-file-storage.provider';

describe('file-storage integration smoke', () => {
  let tempRoot: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'file-storage-smoke-'));
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  });

  it('migrates legacy layout then reads via FileStorageService from canonical paths', async () => {
    const legacyInvoices = path.join(tempRoot, 'old-invoices');
    const storageRoot = path.join(tempRoot, 'data');
    const legacyKey = path.join(legacyInvoices, 'sub-1', 'inv.pdf');

    await fs.promises.mkdir(path.dirname(legacyKey), { recursive: true });
    await fs.promises.writeFile(legacyKey, Buffer.from('zugferd'));

    process.env = {
      ...originalEnv,
      FILE_STORAGE_ROOT: storageRoot,
      FILE_STORAGE_PROVIDER: 'local',
      BILLING_INVOICE_PDF_STORAGE_PATH: legacyInvoices,
      BILLING_DATEV_EXPORT_STORAGE_PATH: path.join(tempRoot, 'old-datev'),
    };

    const factory = new FileStorageProviderFactory();
    const local = new LocalFileStorageProvider();
    factory.registerProvider(local);

    await new FileStorageLegacyMigrationService().migrateAllScopes();
    await new FileStorageLayoutMigrationService().migrateLayout();

    const service = new FileStorageService(factory);
    const buffer = await service.readInvoiceFile('sub-1/inv.pdf');

    expect(buffer.toString()).toBe('zugferd');
    expect(await fs.promises.readFile(path.join(storageRoot, 'customer', 'invoices', 'sub-1', 'inv.pdf'), 'utf8')).toBe(
      'zugferd',
    );

    await service.writeDatevExportFile('tenant/2026/01/export.zip', Buffer.from('zip'));
    expect((await service.readDatevExportFile('tenant/2026/01/export.zip')).toString()).toBe('zip');
  });

  it('dual-read serves previous segment when new layout path is missing', async () => {
    const storageRoot = path.join(tempRoot, 'data');
    const invoicesRoot = path.join(storageRoot, 'invoices');

    await fs.promises.mkdir(invoicesRoot, { recursive: true });
    await fs.promises.writeFile(path.join(invoicesRoot, 'a.pdf'), Buffer.from('keep'));

    process.env = {
      ...originalEnv,
      FILE_STORAGE_ROOT: storageRoot,
      FILE_STORAGE_PROVIDER: 'local',
      FILE_STORAGE_LAYOUT_MIGRATION_ENABLED: 'false',
      FILE_STORAGE_LAYOUT_DUAL_READ_ENABLED: 'true',
      BILLING_INVOICE_PDF_STORAGE_PATH: invoicesRoot,
      BILLING_DATEV_EXPORT_STORAGE_PATH: path.join(storageRoot, 'datev-exports'),
    };

    const factory = new FileStorageProviderFactory();
    factory.registerProvider(new LocalFileStorageProvider());
    await new FileStorageLegacyMigrationService().migrateAllScopes();

    const service = new FileStorageService(factory);

    expect((await service.readInvoiceFile('a.pdf')).toString()).toBe('keep');
  });

  it('throws clearly for unknown provider', async () => {
    process.env = {
      ...originalEnv,
      FILE_STORAGE_ROOT: path.join(tempRoot, 'data'),
      FILE_STORAGE_PROVIDER: 'locl',
    };

    const factory = new FileStorageProviderFactory();
    factory.registerProvider(new LocalFileStorageProvider());
    const service = new FileStorageService(factory);

    await expect(service.writeInvoiceFile('x.pdf', Buffer.from('x'))).rejects.toThrow(
      "File storage provider 'locl' not found. Available: local",
    );
  });
});
