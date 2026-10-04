import { BadRequestException } from '@nestjs/common';

import {
  buildTenantVirtualPath,
  buildUnifiedVirtualPath,
  normalizeAdminFilePath,
  resolveScopeFromSegment,
} from './admin-file-manager-path.util';

describe('admin-file-manager-path.util', () => {
  it('normalizes empty path to root', () => {
    expect(normalizeAdminFilePath(undefined)).toEqual({ path: '', parts: [] });
    expect(normalizeAdminFilePath('')).toEqual({ path: '', parts: [] });
    expect(normalizeAdminFilePath('./')).toEqual({ path: '', parts: [] });
  });

  it('normalizes relative nested paths', () => {
    expect(normalizeAdminFilePath('invoices/sub/a.pdf')).toEqual({
      path: 'invoices/sub/a.pdf',
      parts: ['invoices', 'sub', 'a.pdf'],
    });
  });

  it('rejects path traversal', () => {
    expect(() => normalizeAdminFilePath('../secrets')).toThrow(BadRequestException);
    expect(() => normalizeAdminFilePath('invoices/../x')).toThrow(BadRequestException);
  });

  it('rejects absolute and null-byte paths', () => {
    expect(() => normalizeAdminFilePath('/etc/passwd')).toThrow(BadRequestException);
    expect(() => normalizeAdminFilePath('invoices/\0evil')).toThrow(BadRequestException);
  });

  it('resolves known scope segments', () => {
    expect(resolveScopeFromSegment('invoices')).toBe('invoices');
    expect(resolveScopeFromSegment('supplier-invoices')).toBe('supplierInvoices');
    expect(resolveScopeFromSegment('datev-exports')).toBe('datevExports');
    expect(resolveScopeFromSegment('unknown')).toBeNull();
  });

  it('builds virtual paths', () => {
    expect(buildTenantVirtualPath('invoices', 'sub/a.pdf')).toBe('invoices/sub/a.pdf');
    expect(buildUnifiedVirtualPath('acme', 'invoices', 'sub/a.pdf')).toBe('acme/invoices/sub/a.pdf');
  });
});
