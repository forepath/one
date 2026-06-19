import type { NextFunction, Request, Response } from 'express';

import { TENANT_ID_HEADER } from './tenant-id.config';
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

  afterEach(() => {
    if (originalTenants === undefined) {
      delete process.env['TENANTS'];
    } else {
      process.env['TENANTS'] = originalTenants;
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
});
