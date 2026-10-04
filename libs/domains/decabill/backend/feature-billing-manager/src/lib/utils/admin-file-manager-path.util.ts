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
  [FILE_STORAGE_SCOPE_SEGMENTS[FileStorageScope.invoices]]: FileStorageScope.invoices,
  [FILE_STORAGE_SCOPE_SEGMENTS[FileStorageScope.supplierInvoices]]: FileStorageScope.supplierInvoices,
  [FILE_STORAGE_SCOPE_SEGMENTS[FileStorageScope.datevExports]]: FileStorageScope.datevExports,
};

export const ADMIN_FILE_MANAGER_SCOPE_SEGMENTS = Object.keys(SEGMENT_TO_SCOPE);

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
