import { isTenantMiddlewareExcludedPath } from './tenant-middleware-excluded-path';

describe('tenant-middleware-excluded-path', () => {
  const originalBoardPath = process.env['QUEUE_BULL_BOARD_PATH'];
  const originalOtelEnabled = process.env['OTEL_ENABLED'];
  const originalOtelUsername = process.env['OTEL_USERNAME'];
  const originalOtelPassword = process.env['OTEL_PASSWORD'];
  const originalOtelPath = process.env['OTEL_METRICS_PATH'];

  afterEach(() => {
    if (originalBoardPath === undefined) {
      delete process.env['QUEUE_BULL_BOARD_PATH'];
    } else {
      process.env['QUEUE_BULL_BOARD_PATH'] = originalBoardPath;
    }

    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };

    restore('OTEL_ENABLED', originalOtelEnabled);
    restore('OTEL_USERNAME', originalOtelUsername);
    restore('OTEL_PASSWORD', originalOtelPassword);
    restore('OTEL_METRICS_PATH', originalOtelPath);
  });

  it('excludes health endpoints', () => {
    expect(isTenantMiddlewareExcludedPath('/api/health')).toBe(true);
    expect(isTenantMiddlewareExcludedPath('/api/health/')).toBe(true);
    expect(isTenantMiddlewareExcludedPath('/health')).toBe(true);
    expect(isTenantMiddlewareExcludedPath('/api/health?probe=1')).toBe(true);
  });

  it('excludes payment webhook endpoints', () => {
    expect(isTenantMiddlewareExcludedPath('/api/webhooks/payments/stripe')).toBe(true);
    expect(isTenantMiddlewareExcludedPath('/api/webhooks/payments/other')).toBe(true);
  });

  it('excludes Bull Board paths', () => {
    delete process.env['QUEUE_BULL_BOARD_PATH'];

    expect(isTenantMiddlewareExcludedPath('/admin/queues')).toBe(true);
    expect(isTenantMiddlewareExcludedPath('/admin/queues/api/queues')).toBe(true);
    expect(isTenantMiddlewareExcludedPath('/api/health')).toBe(true);
  });

  it('excludes OTEL metrics path only when effectively enabled', () => {
    process.env['OTEL_ENABLED'] = 'true';
    process.env['OTEL_USERNAME'] = 'otel';
    process.env['OTEL_PASSWORD'] = 'secret';
    delete process.env['OTEL_METRICS_PATH'];

    expect(isTenantMiddlewareExcludedPath('/otel/metrics')).toBe(true);
    expect(isTenantMiddlewareExcludedPath('/otel/metrics/')).toBe(true);

    process.env['OTEL_ENABLED'] = 'false';
    expect(isTenantMiddlewareExcludedPath('/otel/metrics')).toBe(false);
  });

  it('does not exclude tenant-scoped API routes', () => {
    expect(isTenantMiddlewareExcludedPath('/api/subscriptions')).toBe(false);
    expect(isTenantMiddlewareExcludedPath('/api/public/service-plan-offerings')).toBe(false);
  });

  it('excludes the SAML browser endpoints (tenant travels via query / relay state) but not the token exchange', () => {
    expect(isTenantMiddlewareExcludedPath('/api/auth/saml/login')).toBe(true);
    expect(isTenantMiddlewareExcludedPath('/api/auth/saml/acs')).toBe(true);
    expect(isTenantMiddlewareExcludedPath('/api/auth/saml/metadata')).toBe(true);
    expect(isTenantMiddlewareExcludedPath('/api/auth/saml/token')).toBe(false);
    expect(isTenantMiddlewareExcludedPath('/api/auth/logout')).toBe(false);
  });
});
