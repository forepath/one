import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { FILE_STORAGE_INVALID_PATH_ERROR } from '../file-storage.constants';
import { LocalFileStorageProvider } from './local-file-storage.provider';

describe('LocalFileStorageProvider', () => {
  let tempDir: string;
  let provider: LocalFileStorageProvider;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'file-storage-local-'));
    provider = new LocalFileStorageProvider();
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('writes and reads files under storage root', async () => {
    const key = 'sub-1/inv-1.pdf';

    await provider.writeFile(tempDir, key, Buffer.from('pdf-bytes'));

    expect(await provider.fileExists(tempDir, key)).toBe(true);
    expect((await provider.readFile(tempDir, key)).toString()).toBe('pdf-bytes');
  });

  it('rejects path traversal outside storage root', () => {
    expect(() => provider.resolveAbsolutePath(tempDir, '../outside.pdf')).toThrow(FILE_STORAGE_INVALID_PATH_ERROR);
  });

  it('returns false from fileExists for missing files', async () => {
    expect(await provider.fileExists(tempDir, 'missing.pdf')).toBe(false);
  });

  it('deletes files, and missing ones without an error', async () => {
    await provider.writeFile(tempDir, 'old/rec.cast', Buffer.from('x'));
    await provider.deleteFile(tempDir, 'old/rec.cast');
    expect(await provider.fileExists(tempDir, 'old/rec.cast')).toBe(false);
    await expect(provider.deleteFile(tempDir, 'old/rec.cast')).resolves.toBeUndefined();
    await expect(provider.deleteFile(tempDir, '../outside')).rejects.toThrow(FILE_STORAGE_INVALID_PATH_ERROR);
  });
});
