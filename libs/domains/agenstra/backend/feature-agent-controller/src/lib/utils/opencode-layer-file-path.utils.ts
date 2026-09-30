import { createHash } from 'crypto';

import { BadRequestException } from '@nestjs/common';

export type OpencodeLayerFileScope = 'global' | 'workspace';

/**
 * Sanitize a layer path: no `..` or null bytes. Leading `/` is preserved as an absolute
 * container path on emit; bare / `./` paths are relative to the agent workspace root.
 */
export function sanitizeLayerRelativePath(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, '/');

  if (!trimmed || trimmed.includes('\0')) {
    throw new BadRequestException('Invalid path');
  }

  if (/^[a-zA-Z]:/.test(trimmed)) {
    throw new BadRequestException('Windows drive paths are not allowed');
  }

  const absolute = trimmed.startsWith('/');
  const parts = trimmed.split('/').filter((part) => part.length > 0 && part !== '.');

  if (parts.some((part) => part === '..')) {
    throw new BadRequestException('Path traversal is not allowed');
  }

  if (parts.some((part) => /[*?[]/.test(part))) {
    throw new BadRequestException('Glob characters are not allowed in layer paths');
  }

  const joined = parts.join('/');

  return absolute ? `/${joined}` : joined;
}

/** Canonical storage / emit path (as-is after sanitize). */
export function toEmittedLayerPath(_scope: OpencodeLayerFileScope, storagePath: string): string {
  return sanitizeLayerRelativePath(storagePath);
}

/** @deprecated Alias of toEmittedLayerPath — paths are no longer rewritten to a managed prefix. */
export function ensureManagedLayerPath(scope: OpencodeLayerFileScope, path: string): string {
  return toEmittedLayerPath(scope, path);
}

/** @deprecated Prefer sanitizeLayerRelativePath; no prefix stripping. */
export function stripLayerPrefix(_scope: OpencodeLayerFileScope, path: string): string {
  return sanitizeLayerRelativePath(path);
}

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Parent directory of a path, or `null` for roots. */
export function parentLayerPath(path: string): string | null {
  const sanitized = sanitizeLayerRelativePath(path);
  const absolute = sanitized.startsWith('/');
  const parts = sanitized.split('/').filter((part) => part.length > 0);

  if (parts.length <= 1) {
    return absolute ? '/' : null;
  }

  const parent = parts.slice(0, -1).join('/');

  return absolute ? `/${parent}` : parent;
}

/** Join a parent directory with a child name (preserves absolute roots). */
export function joinLayerChildPath(parent: string, childName: string): string {
  const name = childName.trim().replace(/^\/+|\/+$/g, '');

  if (!name || name.includes('/') || name === '.' || name === '..') {
    throw new BadRequestException('Invalid child path segment');
  }

  if (!parent || parent === '.' || parent === './') {
    return name;
  }

  if (parent === '/') {
    return `/${name}`;
  }

  const root = sanitizeLayerRelativePath(parent).replace(/\/$/, '');

  return `${root}/${name}`;
}

/**
 * All ancestor directory paths for `path` (mkdir -p order, nearest root first).
 * Example: `skills/foo/bar.md` → `['skills', 'skills/foo']`.
 */
export function ancestorLayerPaths(path: string): string[] {
  const sanitized = sanitizeLayerRelativePath(path);
  const absolute = sanitized.startsWith('/');
  const parts = sanitized.split('/').filter((part) => part.length > 0);
  const ancestors: string[] = [];

  for (let i = 1; i < parts.length; i += 1) {
    const joined = parts.slice(0, i).join('/');
    ancestors.push(absolute ? `/${joined}` : joined);
  }

  return ancestors;
}

/** Infer file vs directory from the last path segment (extension ⇒ file). */
export function inferLayerEntryKind(path: string): 'file' | 'directory' {
  const base = sanitizeLayerRelativePath(path).split('/').filter(Boolean).pop() ?? '';

  if (/^[^./][^/]*\.[A-Za-z0-9]+$/.test(base)) {
    return 'file';
  }

  return 'directory';
}

/** Immediate child name under `root` for `fullPath`, or null if not a direct/indirect child. */
export function childSegmentUnder(root: string, fullPath: string): string | null {
  const rootSan = sanitizeLayerRelativePath(root === '' || root === '.' ? '.' : root);
  const fullSan = sanitizeLayerRelativePath(fullPath);

  if (rootSan === '.' || rootSan === '') {
    const parts = fullSan.replace(/^\//, '').split('/').filter(Boolean);

    return parts[0] ?? null;
  }

  const prefix = rootSan.endsWith('/') ? rootSan.slice(0, -1) : rootSan;

  if (fullSan === prefix) {
    return null;
  }

  if (!fullSan.startsWith(`${prefix}/`)) {
    return null;
  }

  const rest = fullSan.slice(prefix.length + 1);
  const segment = rest.split('/')[0];

  return segment || null;
}
