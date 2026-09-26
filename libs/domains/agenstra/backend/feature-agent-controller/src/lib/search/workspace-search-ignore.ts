const IGNORED_PATH_SEGMENTS = new Set(['.git', 'node_modules', '.svn', '.hg']);

const SECRET_FILE_PATTERNS = [/^\.env(\.|$)/i, /\.pem$/i, /\.key$/i, /^id_rsa/i, /^id_ed25519/i, /\.p12$/i, /\.pfx$/i];

export function shouldSkipWorkspaceIndexPath(relativePath: string): boolean {
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

export function sanitizeWorkspaceSearchPathFilter(raw: string): string | null {
  const normalized = raw.replace(/^\/+/, '').replace(/\\/g, '/').trim();

  if (!normalized || normalized.includes('..') || normalized.includes('\0')) {
    return null;
  }

  return normalized;
}
