import { EventEmitter } from 'node:events';

import {
  bundleUploadTimeoutMs,
  createRequestTimeoutMiddleware,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from './request-timeout.middleware';

function request(method: string, url: string) {
  const req = Object.assign(new EventEmitter(), {
    method,
    originalUrl: url,
    complete: false,
    socket: { destroy: jest.fn() },
  });
  const res = { headersSent: false, statusCode: 0, setHeader: jest.fn(), end: jest.fn() };

  return { req, res };
}

describe('per-route request receive timeout (2026-10-27)', () => {
  const middleware = createRequestTimeoutMiddleware([
    { method: 'POST', path: '/api/updates/bundles', ms: 2 * 3_600_000 },
  ]);

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('gives the bundle upload its own limit and keeps the default for everything else', () => {
    const bundle = request('POST', '/api/updates/bundles?x=1');
    const other = request('PUT', '/api/live/files/content');
    const next = jest.fn();

    middleware(bundle.req as never, bundle.res as never, next);
    middleware(other.req as never, other.res as never, next);
    expect(next).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(DEFAULT_REQUEST_TIMEOUT_MS + 1);
    expect(other.res.statusCode).toBe(408);
    expect(other.req.socket.destroy).toHaveBeenCalled();
    expect(bundle.req.socket.destroy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2 * 3_600_000);
    expect(bundle.req.socket.destroy).toHaveBeenCalled();
  });

  it('does nothing once the request has arrived', () => {
    const done = request('POST', '/api/plans');

    middleware(done.req as never, done.res as never, jest.fn());
    done.req.complete = true;
    done.req.emit('end');
    jest.advanceTimersByTime(DEFAULT_REQUEST_TIMEOUT_MS * 2);
    expect(done.req.socket.destroy).not.toHaveBeenCalled();
  });

  it('reads LOADWEAVER_BUNDLE_UPLOAD_TIMEOUT_MS within bounds', () => {
    expect(bundleUploadTimeoutMs({})).toBe(2 * 3_600_000);
    expect(bundleUploadTimeoutMs({ LOADWEAVER_BUNDLE_UPLOAD_TIMEOUT_MS: '600000' })).toBe(600_000);
    expect(bundleUploadTimeoutMs({ LOADWEAVER_BUNDLE_UPLOAD_TIMEOUT_MS: '10' })).toBe(2 * 3_600_000);
  });
});
