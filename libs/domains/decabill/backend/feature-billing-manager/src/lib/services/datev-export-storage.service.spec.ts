import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DatevExportStorageService } from './datev-export-storage.service';

describe('DatevExportStorageService', () => {
  const originalEnv = process.env;
  let tempDir: string;
  let service: DatevExportStorageService;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'datev-export-'));
    process.env = { ...originalEnv, BILLING_DATEV_EXPORT_STORAGE_PATH: tempDir };
    service = new DatevExportStorageService();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('writes and reads files under storage root', async () => {
    const key = 'default/2026/01/export.zip';

    await service.writeFile(key, Buffer.from('zip-content'));

    expect(await service.fileExists(key)).toBe(true);
    expect((await service.readFile(key)).toString()).toBe('zip-content');
  });

  it('rejects path traversal outside storage root', () => {
    expect(() => service.resolveAbsolutePath('../outside.zip')).toThrow(/Invalid DATEV export path/);
  });
});
