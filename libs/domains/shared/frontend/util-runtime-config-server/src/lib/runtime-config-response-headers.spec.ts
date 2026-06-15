import { applyRuntimeConfigResponseCacheHeaders } from './runtime-config-response-headers';

describe('applyRuntimeConfigResponseCacheHeaders', () => {
  it('sets no-store for error responses', () => {
    const res = { setHeader: jest.fn() };

    applyRuntimeConfigResponseCacheHeaders(res, 'error', {});

    expect(res.setHeader).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('sets private short cache in production for success', () => {
    const res = { setHeader: jest.fn() };

    applyRuntimeConfigResponseCacheHeaders(res, 'success', { NODE_ENV: 'production' });

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
  });

  it('sets private no-cache for success outside production', () => {
    const res = { setHeader: jest.fn() };

    applyRuntimeConfigResponseCacheHeaders(res, 'success', { NODE_ENV: 'development' });

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
  });

  it('treats missing NODE_ENV as non-production for success', () => {
    const res = { setHeader: jest.fn() };

    applyRuntimeConfigResponseCacheHeaders(res, 'success', {});

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
  });
});
