import type { NextFunction, Request, Response } from 'express';

import { TENANT_ID_HEADER, TENANTS_ALLOW_DEFAULT_ENV } from './tenant-id.config';
import { createTenantIdMiddleware } from './tenant-id.middleware';

import './express-request-augmentation';

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    url: '/api/test',
    originalUrl: '/api/test',
    headers: {},
    ...overrides,
  } as Request;
}

function createMockResponse(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('tenant-id.middleware', () => {
  const originalTenants = process.env['TENANTS'];
  const originalAllowDefault = process.env[TENANTS_ALLOW_DEFAULT_ENV];

  afterEach(() => {
    if (originalTenants === undefined) {
      delete process.env['TENANTS'];
    } else {
      process.env['TENANTS'] = originalTenants;
    }

    if (originalAllowDefault === undefined) {
      delete process.env[TENANTS_ALLOW_DEFAULT_ENV];
    } else {
      process.env[TENANTS_ALLOW_DEFAULT_ENV] = originalAllowDefault;
    }
  });

  it('sets req.tenantId to default when header is missing', () => {
    delete process.env['TENANTS'];
    const middleware = createTenantIdMiddleware();
    const req = createMockRequest();
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(req.tenantId).toBe('default');
    expect(next).toHaveBeenCalled();
  });

  it('sets req.tenantId from incoming x-tenant header', () => {
    process.env['TENANTS'] = 'one';
    const middleware = createTenantIdMiddleware();
    const req = createMockRequest({
      headers: { [TENANT_ID_HEADER]: 'one' },
    });
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(req.tenantId).toBe('one');
    expect(next).toHaveBeenCalled();
  });

  it('returns 400 for unknown tenant', () => {
    delete process.env['TENANTS'];
    const middleware = createTenantIdMiddleware();
    const req = createMockRequest({
      headers: { [TENANT_ID_HEADER]: 'unknown' },
    });
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or unknown tenant' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 when default tenant is disabled and header is missing', () => {
    process.env['TENANTS'] = 'one';
    process.env[TENANTS_ALLOW_DEFAULT_ENV] = 'false';
    const middleware = createTenantIdMiddleware();
    const req = createMockRequest();
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or unknown tenant' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 when default tenant is disabled and header is blank or default', () => {
    process.env['TENANTS'] = 'one';
    process.env[TENANTS_ALLOW_DEFAULT_ENV] = 'false';
    const middleware = createTenantIdMiddleware();

    for (const headerValue of ['   ', 'default']) {
      const req = createMockRequest({
        headers: { [TENANT_ID_HEADER]: headerValue },
      });
      const res = createMockResponse();
      const next = jest.fn() as NextFunction;

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or unknown tenant' });
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('skips tenant validation for health checks when default tenant is disabled', () => {
    process.env['TENANTS'] = 'one';
    process.env[TENANTS_ALLOW_DEFAULT_ENV] = 'false';
    const middleware = createTenantIdMiddleware();
    const req = createMockRequest({ originalUrl: '/api/health', url: '/api/health' });
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(req.tenantId).toBeUndefined();
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('skips tenant validation for CORS preflight requests', () => {
    process.env['TENANTS'] = 'one';
    process.env[TENANTS_ALLOW_DEFAULT_ENV] = 'false';
    const middleware = createTenantIdMiddleware();
    const req = createMockRequest({ method: 'OPTIONS', originalUrl: '/api/subscriptions', url: '/api/subscriptions' });
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(req.tenantId).toBeUndefined();
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
