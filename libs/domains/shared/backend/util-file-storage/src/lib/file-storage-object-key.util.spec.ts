import { buildScopedObjectKey } from './file-storage-object-key.util';
import { FILE_STORAGE_INVALID_PATH_ERROR } from './file-storage.constants';

describe('buildScopedObjectKey', () => {
  it('joins relative segment from storage root with storage key', () => {
    expect(buildScopedObjectKey('/data/invoices', 'sub-1/inv-1.pdf', '/data')).toBe('invoices/sub-1/inv-1.pdf');
    expect(buildScopedObjectKey('/data/datev-exports', 'default/2026/01/export.zip', '/data')).toBe(
      'datev-exports/default/2026/01/export.zip',
    );
  });

  it('preserves nested scope segments under storage root', () => {
    expect(buildScopedObjectKey('/data/customer/invoices', 'sub-1/inv-1.pdf', '/data')).toBe(
      'customer/invoices/sub-1/inv-1.pdf',
    );
    expect(buildScopedObjectKey('/data/export/datev', 'default/2026/01/export.zip', '/data')).toBe(
      'export/datev/default/2026/01/export.zip',
    );
  });

  it('rejects path traversal and empty keys', () => {
    expect(() => buildScopedObjectKey('/data/invoices', '../etc/passwd', '/data')).toThrow(
      FILE_STORAGE_INVALID_PATH_ERROR,
    );
    expect(() => buildScopedObjectKey('/data/invoices', '', '/data')).toThrow(FILE_STORAGE_INVALID_PATH_ERROR);
    expect(() => buildScopedObjectKey('/data/invoices', 'a/../../b', '/data')).toThrow(FILE_STORAGE_INVALID_PATH_ERROR);
  });
});
