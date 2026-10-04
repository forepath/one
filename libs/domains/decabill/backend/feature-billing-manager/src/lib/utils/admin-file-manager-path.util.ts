import { BadRequestException } from '@nestjs/common';
import {
  FILE_STORAGE_SCOPE_SEGMENTS,
  FileStorageScope,
  type FileStorageScope as FileStorageScopeType,
} from '@forepath/shared/backend/util-file-storage';

import {
  AdminFileManagerView,
  type AdminFileManagerView as AdminFileManagerViewType,
} from '../constants/admin-file-manager.constants';

const SEGMENT_TO_SCOPE: Readonly<Record<string, FileStorageScopeType>> = {
  [FILE_STORAGE_SCOPE_SEGMENTS[FileStorageScope.customerInvoices]]: FileStorageScope.customerInvoices,
  [FILE_STORAGE_SCOPE_SEGMENTS[FileStorageScope.customerOffers]]: FileStorageScope.customerOffers,
  [FILE_STORAGE_SCOPE_SEGMENTS[FileStorageScope.customerTimesheets]]: FileStorageScope.customerTimesheets,
  [FILE_STORAGE_SCOPE_SEGMENTS[FileStorageScope.supplierInvoices]]: FileStorageScope.supplierInvoices,
  [FILE_STORAGE_SCOPE_SEGMENTS[FileStorageScope.datevExports]]: FileStorageScope.datevExports,
};

/** Full scope path segments (e.g. customer/invoices). */
export const ADMIN_FILE_MANAGER_SCOPE_SEGMENTS = Object.keys(SEGMENT_TO_SCOPE);

/** Top-level virtual folders matching the disk narrative. */
export const ADMIN_FILE_MANAGER_ROOT_FOLDERS = ['customer', 'supplier', 'export'] as const;

/**
 * Fixed structural children under a path (tenant-relative).
 * Does not invent dynamic content folders (DATEV year/month, invoice subscription keys, …).
 */
export const ADMIN_FILE_MANAGER_STRUCTURAL_CHILDREN: Readonly<Record<string, readonly string[]>> = {
  '': ADMIN_FILE_MANAGER_ROOT_FOLDERS,
  customer: ['invoices', 'offers', 'timesheets'],
  supplier: ['invoices'],
  export: ['datev'],
};

/**
 * Returns fixed structural child folder names for a virtual path, or null when the path
 * is outside the static layout (only DB-derived entries apply).
 * For unified view, `parts[0]` is the tenant id and is skipped.
 */
export function structuralChildrenForPath(parts: string[], view: AdminFileManagerViewType): readonly string[] | null {
  // Unified root lists tenant folders from the allow-set, not customer/supplier/export.
  if (view === AdminFileManagerView.UNIFIED && parts.length === 0) {
    return null;
  }

  const relativeParts = view === AdminFileManagerView.UNIFIED ? parts.slice(1) : parts;
  const key = relativeParts.join('/');

  return ADMIN_FILE_MANAGER_STRUCTURAL_CHILDREN[key] ?? null;
}

export interface NormalizedAdminFilePath {
  path: string;
  parts: string[];
}

/**
 * Normalize and validate a virtual admin file path.
 * Rejects traversal, absolute paths, and null bytes.
 */
export function normalizeAdminFilePath(rawPath?: string | null): NormalizedAdminFilePath {
  const input = (rawPath ?? '').trim();

  if (input.includes('\0')) {
    throw new BadRequestException('Invalid path');
  }

  if (input.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(input)) {
    throw new BadRequestException('Invalid path');
  }

  const parts = input
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== '.');

  if (parts.some((part) => part === '..')) {
    throw new BadRequestException('Invalid path');
  }

  return {
    path: parts.join('/'),
    parts,
  };
}

export function resolveScopeFromSegment(segment: string): FileStorageScopeType | null {
  return SEGMENT_TO_SCOPE[segment] ?? null;
}

/** Resolve scope from a path prefix (supports nested segments like customer/invoices). */
export function resolveScopeFromPathParts(parts: string[]): FileStorageScopeType | null {
  if (parts.length >= 2) {
    const two = `${parts[0]}/${parts[1]}`;
    const scope = SEGMENT_TO_SCOPE[two];

    if (scope) {
      return scope;
    }
  }

  if (parts.length >= 1) {
    return SEGMENT_TO_SCOPE[parts[0]] ?? null;
  }

  return null;
}

export function buildTenantVirtualPath(scopeSegment: string, storageKey: string): string {
  return `${scopeSegment}/${storageKey.replace(/\\/g, '/')}`;
}

export function buildUnifiedVirtualPath(tenantId: string, scopeSegment: string, storageKey: string): string {
  return `${tenantId}/${buildTenantVirtualPath(scopeSegment, storageKey)}`;
}

export function isAdminFileManagerView(value: string | undefined): value is AdminFileManagerViewType {
  return value === AdminFileManagerView.TENANT || value === AdminFileManagerView.UNIFIED;
}

export function guessContentType(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();

  if (lower.endsWith('.pdf')) return 'application/pdf';

  if (lower.endsWith('.zip')) return 'application/zip';

  if (lower.endsWith('.csv')) return 'text/csv';

  if (lower.endsWith('.xml')) return 'application/xml';

  if (lower.endsWith('.png')) return 'image/png';

  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';

  return undefined;
}
