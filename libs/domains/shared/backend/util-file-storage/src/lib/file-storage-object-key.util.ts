import * as path from 'path';

import { FILE_STORAGE_INVALID_PATH_ERROR } from './file-storage.constants';
import { readFileStorageRoot } from './file-storage-path.config';

/**
 * Builds a posix object key / relative path from a scope root and storage key.
 * Relativizes the scope root against `FILE_STORAGE_ROOT` so nested segments
 * (e.g. `customer/invoices`) are preserved for S3 and other prefix backends.
 * Rejects path traversal.
 */
export function buildScopedObjectKey(
  root: string,
  storageKey: string,
  storageRoot: string = readFileStorageRoot(),
): string {
  const normalizedKey = storageKey.replace(/\\/g, '/').replace(/^\/+/, '');

  if (!normalizedKey || normalizedKey.includes('\0') || normalizedKey.split('/').includes('..')) {
    throw new Error(FILE_STORAGE_INVALID_PATH_ERROR);
  }

  const resolvedRoot = path.resolve(root);
  const resolvedStorageRoot = path.resolve(storageRoot);
  let relativeSegment = path.relative(resolvedStorageRoot, resolvedRoot).replace(/\\/g, '/');

  if (
    !relativeSegment ||
    relativeSegment === '.' ||
    relativeSegment.startsWith('..') ||
    path.isAbsolute(relativeSegment)
  ) {
    relativeSegment = path.basename(resolvedRoot).replace(/\\/g, '/');
  }

  if (
    !relativeSegment ||
    relativeSegment === '.' ||
    relativeSegment === '..' ||
    relativeSegment.split('/').includes('..')
  ) {
    throw new Error(FILE_STORAGE_INVALID_PATH_ERROR);
  }

  return path.posix.join(relativeSegment, normalizedKey);
}
