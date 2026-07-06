import { BadRequestException } from '@nestjs/common';

import { PRESENTATION_MARKDOWN_FILENAME } from '@forepath/marpdown/marpdown/shared';

const ALLOWED_MIME_PREFIXES = ['image/', 'font/', 'text/css', 'text/plain', 'application/font'];
const ALLOWED_MIME_EXACT = ['image/svg+xml', 'application/octet-stream'];

export function normalizeAssetPath(rawPath: string): string {
  const normalized = rawPath
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .join('/');

  if (!normalized) {
    throw new BadRequestException('Invalid path');
  }

  if (normalized === PRESENTATION_MARKDOWN_FILENAME || normalized.endsWith(`/${PRESENTATION_MARKDOWN_FILENAME}`)) {
    throw new BadRequestException('Invalid path');
  }

  return normalized;
}

export function getParentPath(normalizedPath: string): string | null {
  const lastSlash = normalizedPath.lastIndexOf('/');

  if (lastSlash < 0) {
    return null;
  }

  return normalizedPath.slice(0, lastSlash);
}

export function getBaseName(normalizedPath: string): string {
  const lastSlash = normalizedPath.lastIndexOf('/');

  return lastSlash < 0 ? normalizedPath : normalizedPath.slice(lastSlash + 1);
}

export function isDirectChild(parentPath: string | null, childPath: string): boolean {
  if (parentPath === null) {
    return !childPath.includes('/');
  }

  if (!childPath.startsWith(`${parentPath}/`)) {
    return false;
  }

  const remainder = childPath.slice(parentPath.length + 1);

  return remainder.length > 0 && !remainder.includes('/');
}

export function validateAssetMimeType(mimeType: string): void {
  const normalized = mimeType.trim().toLowerCase();

  if (!normalized) {
    throw new BadRequestException('Invalid content type');
  }

  if (ALLOWED_MIME_EXACT.includes(normalized)) {
    return;
  }

  if (ALLOWED_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return;
  }

  throw new BadRequestException('Invalid content type');
}

export function getMaxAssetBytes(): number {
  const raw = process.env['MARPDOWN_MAX_ASSET_BYTES'];
  const parsed = raw ? parseInt(raw, 10) : 10 * 1024 * 1024;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 1024 * 1024;
}
