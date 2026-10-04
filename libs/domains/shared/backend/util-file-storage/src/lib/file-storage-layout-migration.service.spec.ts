import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { FileStorageLayoutMigrationService } from './file-storage-layout-migration.service';

describe('FileStorageLayoutMigrationService', () => {
  let tempRoot: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'file-storage-layout-'));
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  });

  it('copies previous segments into customer/supplier/export layout', async () => {
    const storageRoot = path.join(tempRoot, 'data');
    await fs.promises.mkdir(path.join(storageRoot, 'invoices', 'sub-1'), { recursive: true });
    await fs.promises.mkdir(path.join(storageRoot, 'invoices', 'offers', 'user-1'), { recursive: true });
    await fs.promises.mkdir(path.join(storageRoot, 'supplier-invoices'), { recursive: true });
    await fs.promises.mkdir(path.join(storageRoot, 'datev-exports', 'default'), { recursive: true });

    await fs.promises.writeFile(path.join(storageRoot, 'invoices', 'sub-1', 'inv.pdf'), Buffer.from('inv'));
    await fs.promises.writeFile(path.join(storageRoot, 'invoices', 'sub-1', 'inv-time-report.pdf'), Buffer.from('ts'));
    await fs.promises.writeFile(
      path.join(storageRoot, 'invoices', 'offers', 'user-1', 'offer.pdf'),
      Buffer.from('offer'),
    );
    await fs.promises.writeFile(path.join(storageRoot, 'supplier-invoices', 'sup.pdf'), Buffer.from('sup'));
    await fs.promises.writeFile(path.join(storageRoot, 'datev-exports', 'default', 'e.zip'), Buffer.from('zip'));

    process.env = {
      ...originalEnv,
      FILE_STORAGE_ROOT: storageRoot,
      FILE_STORAGE_PROVIDER: 'local',
      FILE_STORAGE_LAYOUT_MIGRATION_ENABLED: 'true',
    };

    await new FileStorageLayoutMigrationService().migrateLayout(process.env);

    expect(await fs.promises.readFile(path.join(storageRoot, 'customer', 'invoices', 'sub-1', 'inv.pdf'), 'utf8')).toBe(
      'inv',
    );
    expect(
      await fs.promises.readFile(
        path.join(storageRoot, 'customer', 'timesheets', 'sub-1', 'inv-time-report.pdf'),
        'utf8',
      ),
    ).toBe('ts');
    expect(
      await fs.promises.readFile(path.join(storageRoot, 'customer', 'offers', 'user-1', 'offer.pdf'), 'utf8'),
    ).toBe('offer');
    expect(await fs.promises.readFile(path.join(storageRoot, 'supplier', 'invoices', 'sup.pdf'), 'utf8')).toBe('sup');
    expect(await fs.promises.readFile(path.join(storageRoot, 'export', 'datev', 'default', 'e.zip'), 'utf8')).toBe(
      'zip',
    );
  });

  it('is idempotent when destination already exists', async () => {
    const storageRoot = path.join(tempRoot, 'data');
    await fs.promises.mkdir(path.join(storageRoot, 'invoices'), { recursive: true });
    await fs.promises.mkdir(path.join(storageRoot, 'customer', 'invoices'), { recursive: true });
    await fs.promises.writeFile(path.join(storageRoot, 'invoices', 'a.pdf'), Buffer.from('src'));
    await fs.promises.writeFile(path.join(storageRoot, 'customer', 'invoices', 'a.pdf'), Buffer.from('src'));

    process.env = {
      ...originalEnv,
      FILE_STORAGE_ROOT: storageRoot,
      FILE_STORAGE_PROVIDER: 'local',
    };

    await new FileStorageLayoutMigrationService().migrateLayout(process.env);

    expect(await fs.promises.readFile(path.join(storageRoot, 'customer', 'invoices', 'a.pdf'), 'utf8')).toBe('src');
  });
});
