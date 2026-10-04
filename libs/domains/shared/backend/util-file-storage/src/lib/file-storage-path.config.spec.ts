import * as path from 'path';

import {
  isLayoutMigrationEnabled,
  isLegacyMigrationEnabled,
  readActiveFileStorageProviderType,
  readFileStorageRoot,
  resolveCanonicalScopeRoot,
  resolveLegacyScopeRoot,
} from './file-storage-path.config';
import { FileStorageScope } from './file-storage-scope.constants';

describe('file-storage-path.config', () => {
  const originalCwd = process.cwd;

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it('readFileStorageRoot uses FILE_STORAGE_ROOT when set', () => {
    expect(readFileStorageRoot({ FILE_STORAGE_ROOT: '/data' })).toBe('/data');
  });

  it('readFileStorageRoot falls back to cwd/data', () => {
    process.cwd = () => '/workspace';

    expect(readFileStorageRoot({})).toBe(path.join('/workspace', 'data'));
  });

  it('resolveCanonicalScopeRoot joins root and nested segment', () => {
    expect(resolveCanonicalScopeRoot(FileStorageScope.customerInvoices, { FILE_STORAGE_ROOT: '/data' })).toBe(
      path.join('/data', 'customer', 'invoices'),
    );
    expect(resolveCanonicalScopeRoot(FileStorageScope.datevExports, { FILE_STORAGE_ROOT: '/data' })).toBe(
      path.join('/data', 'export', 'datev'),
    );
  });

  it('resolveLegacyScopeRoot uses BILLING_* when set', () => {
    expect(
      resolveLegacyScopeRoot(FileStorageScope.customerInvoices, {
        BILLING_INVOICE_PDF_STORAGE_PATH: '/legacy/invoices',
      }),
    ).toBe('/legacy/invoices');
    expect(
      resolveLegacyScopeRoot(FileStorageScope.datevExports, {
        BILLING_DATEV_EXPORT_STORAGE_PATH: '/legacy/datev',
      }),
    ).toBe('/legacy/datev');
  });

  it('resolveLegacyScopeRoot falls back to cwd layout', () => {
    process.cwd = () => '/workspace';

    expect(resolveLegacyScopeRoot(FileStorageScope.customerInvoices, {})).toBe(
      path.join('/workspace', 'data', 'invoices'),
    );
  });

  it('isLegacyMigrationEnabled defaults to true and disables on false', () => {
    expect(isLegacyMigrationEnabled({})).toBe(true);
    expect(isLegacyMigrationEnabled({ FILE_STORAGE_LEGACY_MIGRATION_ENABLED: 'false' })).toBe(false);
    expect(isLegacyMigrationEnabled({ FILE_STORAGE_LEGACY_MIGRATION_ENABLED: 'TRUE' })).toBe(true);
  });

  it('isLayoutMigrationEnabled defaults to true and disables on false', () => {
    expect(isLayoutMigrationEnabled({})).toBe(true);
    expect(isLayoutMigrationEnabled({ FILE_STORAGE_LAYOUT_MIGRATION_ENABLED: 'false' })).toBe(false);
  });

  it('readActiveFileStorageProviderType defaults to local', () => {
    expect(readActiveFileStorageProviderType({})).toBe('local');
    expect(readActiveFileStorageProviderType({ FILE_STORAGE_PROVIDER: 's3' })).toBe('s3');
  });
});
