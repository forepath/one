import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { FileStorageLegacyMigrationService } from './file-storage-legacy-migration.service';

describe('FileStorageLegacyMigrationService', () => {
  let tempRoot: string;
  let service: FileStorageLegacyMigrationService;

  beforeEach(async () => {
    tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'file-storage-migrate-'));
    service = new FileStorageLegacyMigrationService();
  });

  afterEach(async () => {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  });

  it('copies when legacy root differs and is non-empty', async () => {
    const legacyInvoices = path.join(tempRoot, 'legacy-invoices');
    const storageRoot = path.join(tempRoot, 'data');
    const keyPath = path.join(legacyInvoices, 'sub-1', 'inv.pdf');

    await fs.promises.mkdir(path.dirname(keyPath), { recursive: true });
    await fs.promises.writeFile(keyPath, Buffer.from('invoice'));

    await service.migrateAllScopes({
      FILE_STORAGE_ROOT: storageRoot,
      BILLING_INVOICE_PDF_STORAGE_PATH: legacyInvoices,
      BILLING_DATEV_EXPORT_STORAGE_PATH: path.join(tempRoot, 'legacy-datev-empty'),
      FILE_STORAGE_PROVIDER: 'local',
    });

    const migrated = path.join(storageRoot, 'invoices', 'sub-1', 'inv.pdf');

    expect(await fs.promises.readFile(migrated, 'utf8')).toBe('invoice');
    expect(await fs.promises.readFile(keyPath, 'utf8')).toBe('invoice');
  });

  it('is a no-op when migration is disabled', async () => {
    const legacyInvoices = path.join(tempRoot, 'legacy-invoices');
    const storageRoot = path.join(tempRoot, 'data');
    const keyPath = path.join(legacyInvoices, 'inv.pdf');

    await fs.promises.mkdir(legacyInvoices, { recursive: true });
    await fs.promises.writeFile(keyPath, Buffer.from('invoice'));

    await service.migrateAllScopes({
      FILE_STORAGE_ROOT: storageRoot,
      BILLING_INVOICE_PDF_STORAGE_PATH: legacyInvoices,
      FILE_STORAGE_LEGACY_MIGRATION_ENABLED: 'false',
      FILE_STORAGE_PROVIDER: 'local',
    });

    await expect(fs.promises.access(path.join(storageRoot, 'invoices', 'inv.pdf'))).rejects.toBeDefined();
  });

  it('skips when legacy and canonical roots match', async () => {
    const storageRoot = path.join(tempRoot, 'data');
    const invoices = path.join(storageRoot, 'invoices');
    const keyPath = path.join(invoices, 'inv.pdf');

    await fs.promises.mkdir(invoices, { recursive: true });
    await fs.promises.writeFile(keyPath, Buffer.from('invoice'));

    await service.migrateAllScopes({
      FILE_STORAGE_ROOT: storageRoot,
      BILLING_INVOICE_PDF_STORAGE_PATH: invoices,
      BILLING_DATEV_EXPORT_STORAGE_PATH: path.join(storageRoot, 'datev-exports'),
      FILE_STORAGE_PROVIDER: 'local',
    });

    expect(await fs.promises.readFile(keyPath, 'utf8')).toBe('invoice');
  });

  it('skips overwrite when destination exists with different size', async () => {
    const legacyInvoices = path.join(tempRoot, 'legacy-invoices');
    const storageRoot = path.join(tempRoot, 'data');
    const dest = path.join(storageRoot, 'invoices', 'inv.pdf');

    await fs.promises.mkdir(legacyInvoices, { recursive: true });
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(path.join(legacyInvoices, 'inv.pdf'), Buffer.from('new-content'));
    await fs.promises.writeFile(dest, Buffer.from('old'));

    await service.migrateAllScopes({
      FILE_STORAGE_ROOT: storageRoot,
      BILLING_INVOICE_PDF_STORAGE_PATH: legacyInvoices,
      BILLING_DATEV_EXPORT_STORAGE_PATH: path.join(tempRoot, 'empty-datev'),
      FILE_STORAGE_PROVIDER: 'local',
    });

    expect(await fs.promises.readFile(dest, 'utf8')).toBe('old');
  });
});
