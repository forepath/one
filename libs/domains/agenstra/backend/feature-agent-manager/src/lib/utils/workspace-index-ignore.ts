/** Paths that should not trigger index notifications (relative to workspace root). */
const IGNORED_PATH_SEGMENTS = new Set(['.git', 'node_modules', '.svn', '.hg']);

const SECRET_FILE_PATTERNS = [/^\.env(\.|$)/i, /\.pem$/i, /\.key$/i, /^id_rsa/i, /^id_ed25519/i, /\.p12$/i, /\.pfx$/i];

/**
 * Returns true when a workspace-relative path should be ignored for indexing notifications.
 */
export function shouldIgnoreWorkspaceIndexPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/^\/+/, '').replace(/\\/g, '/').trim();

  if (!normalized) {
    return true;
  }

  const parts = normalized.split('/').filter(Boolean);

  if (parts.some((part) => IGNORED_PATH_SEGMENTS.has(part))) {
    return true;
  }

  const fileName = parts[parts.length - 1] ?? '';

  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
}

/**
 * Map an absolute container path under basePath to a workspace-relative path.
 */
export function toWorkspaceRelativePath(absolutePath: string, basePath: string): string | null {
  const abs = absolutePath.replace(/\/+$/, '');
  const base = basePath.replace(/\/+$/, '') || '/app';

  if (abs === base) {
    return null;
  }

  if (!abs.startsWith(`${base}/`)) {
    return null;
  }

  return abs.slice(base.length + 1);
}
