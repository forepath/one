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
 * Fail closed: only exclude when OTEL is effectively enabled (same rules as identity util-auth).
 * Duplicated here so util-http-context does not depend on identity.
 */
function isOtelMetricsRequestPath(urlPath: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env['OTEL_ENABLED'] !== 'true') {
    return false;
  }

  const username = env['OTEL_USERNAME']?.trim() ?? '';
  const password = env['OTEL_PASSWORD']?.trim() ?? '';

  if (!username || !password) {
    return false;
  }

  const metricsPath = (env['OTEL_METRICS_PATH']?.trim() || '/otel/metrics').replace(/\/+$/, '');
  const base = metricsPath.startsWith('/') ? metricsPath : `/${metricsPath}`;
  const path = normalizeRequestPath(urlPath);

  return path === base || path.startsWith(`${base}/`);
}

/**
 * Paths that must not require tenant resolution (health probes, payment webhooks, Bull Board, OTEL).
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

  if (isOtelMetricsRequestPath(path)) {
    return true;
  }

  // SAML browser redirects cannot carry the `x-tenant` header: login takes a validated `tenant` query parameter and
  // the ACS restores the tenant bound to the single-use relay state (see identity SamlAuthService).
  if (path === '/api/auth/saml/login' || path === '/api/auth/saml/acs' || path === '/api/auth/saml/metadata') {
    return true;
  }

  return isBullBoardRequestPath(path);
}
