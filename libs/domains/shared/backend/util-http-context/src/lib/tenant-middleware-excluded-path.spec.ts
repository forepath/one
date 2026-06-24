import { isTenantMiddlewareExcludedPath } from './tenant-middleware-excluded-path';

describe('tenant-middleware-excluded-path', () => {
  const originalBoardPath = process.env['QUEUE_BULL_BOARD_PATH'];

  afterEach(() => {
    if (originalBoardPath === undefined) {
      delete process.env['QUEUE_BULL_BOARD_PATH'];
    } else {
      process.env['QUEUE_BULL_BOARD_PATH'] = originalBoardPath;
    }
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

  it('does not exclude tenant-scoped API routes', () => {
    expect(isTenantMiddlewareExcludedPath('/api/subscriptions')).toBe(false);
    expect(isTenantMiddlewareExcludedPath('/api/public/service-plan-offerings')).toBe(false);
  });
});
