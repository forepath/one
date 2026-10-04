import { BadRequestException } from '@nestjs/common';

import { AdminFileManagerView } from '../constants/admin-file-manager.constants';

import {
  buildTenantVirtualPath,
  buildUnifiedVirtualPath,
  normalizeAdminFilePath,
  resolveScopeFromPathParts,
  resolveScopeFromSegment,
  structuralChildrenForPath,
} from './admin-file-manager-path.util';

describe('admin-file-manager-path.util', () => {
  it('normalizes empty path to root', () => {
    expect(normalizeAdminFilePath(undefined)).toEqual({ path: '', parts: [] });
    expect(normalizeAdminFilePath('')).toEqual({ path: '', parts: [] });
    expect(normalizeAdminFilePath('./')).toEqual({ path: '', parts: [] });
  });

  it('normalizes relative nested paths', () => {
    expect(normalizeAdminFilePath('customer/invoices/sub/a.pdf')).toEqual({
      path: 'customer/invoices/sub/a.pdf',
      parts: ['customer', 'invoices', 'sub', 'a.pdf'],
    });
  });

  it('rejects path traversal', () => {
    expect(() => normalizeAdminFilePath('../secrets')).toThrow(BadRequestException);
    expect(() => normalizeAdminFilePath('customer/../x')).toThrow(BadRequestException);
  });

  it('rejects absolute and null-byte paths', () => {
    expect(() => normalizeAdminFilePath('/etc/passwd')).toThrow(BadRequestException);
    expect(() => normalizeAdminFilePath('customer/\0evil')).toThrow(BadRequestException);
  });

  it('resolves known nested scope segments', () => {
    expect(resolveScopeFromSegment('customer/invoices')).toBe('customerInvoices');
    expect(resolveScopeFromSegment('customer/offers')).toBe('customerOffers');
    expect(resolveScopeFromSegment('customer/timesheets')).toBe('customerTimesheets');
    expect(resolveScopeFromSegment('supplier/invoices')).toBe('supplierInvoices');
    expect(resolveScopeFromSegment('export/datev')).toBe('datevExports');
    expect(resolveScopeFromSegment('unknown')).toBeNull();
  });

  it('resolves scope from path parts', () => {
    expect(resolveScopeFromPathParts(['customer', 'invoices'])).toBe('customerInvoices');
    expect(resolveScopeFromPathParts(['export', 'datev'])).toBe('datevExports');
  });

  it('builds virtual paths', () => {
    expect(buildTenantVirtualPath('customer/invoices', 'sub/a.pdf')).toBe('customer/invoices/sub/a.pdf');
    expect(buildUnifiedVirtualPath('acme', 'customer/invoices', 'sub/a.pdf')).toBe('acme/customer/invoices/sub/a.pdf');
  });

  it('materializes fixed structural children without dynamic date folders', () => {
    expect(structuralChildrenForPath([], AdminFileManagerView.TENANT)).toEqual(['customer', 'supplier', 'export']);
    expect(structuralChildrenForPath(['customer'], AdminFileManagerView.TENANT)).toEqual([
      'invoices',
      'offers',
      'timesheets',
    ]);
    expect(structuralChildrenForPath(['supplier'], AdminFileManagerView.TENANT)).toEqual(['invoices']);
    expect(structuralChildrenForPath(['export'], AdminFileManagerView.TENANT)).toEqual(['datev']);
    expect(structuralChildrenForPath(['export', 'datev'], AdminFileManagerView.TENANT)).toBeNull();
    expect(structuralChildrenForPath(['customer', 'invoices'], AdminFileManagerView.TENANT)).toBeNull();
    expect(structuralChildrenForPath([], AdminFileManagerView.UNIFIED)).toBeNull();
    expect(structuralChildrenForPath(['acme', 'customer'], AdminFileManagerView.UNIFIED)).toEqual([
      'invoices',
      'offers',
      'timesheets',
    ]);
  });
});
