function normalizeRequestPath(urlPath: string): string {
  return urlPath.split('?')[0]?.replace(/\/+$/, '') ?? '';
}

function isBullBoardRequestPath(urlPath: string): boolean {
  const boardPath = (process.env['QUEUE_BULL_BOARD_PATH']?.trim() || '/admin/queues').replace(/\/+$/, '');
  const base = boardPath.startsWith('/') ? boardPath : `/${boardPath}`;
  const path = normalizeRequestPath(urlPath);

  return path === base || path.startsWith(`${base}/`);
}

/**
 * Paths that must not require tenant resolution (health probes, payment webhooks, Bull Board).
 * Mirrors auth bypass rules in HybridAuthGuard.
 */
export function isTenantMiddlewareExcludedPath(urlPath: string): boolean {
  const path = normalizeRequestPath(urlPath);

  if (path === '/api/health' || path === '/health') {
    return true;
  }

  if (path === '/api/webhooks/payments/stripe' || path.startsWith('/api/webhooks/payments/')) {
    return true;
  }

  return isBullBoardRequestPath(path);
}
