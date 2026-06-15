import { EventEmitter } from 'node:events';

import type { NextFunction, Request, Response } from 'express';

import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER, createCorrelationIdMiddleware } from './correlation-id.middleware';

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

function createMockResponse(): Response & EventEmitter {
  const res = new EventEmitter() as Response & EventEmitter;

  res.setHeader = jest.fn();
  res.statusCode = 200;

  return res;
}

describe('correlation-id.middleware', () => {
  it('sets req.correlationId from incoming x-correlation-id', () => {
    const middleware = createCorrelationIdMiddleware();
    const req = createMockRequest({
      headers: { [CORRELATION_ID_HEADER]: 'incoming-1' },
    });
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(req.correlationId).toBe('incoming-1');
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-Id', 'incoming-1');
    expect(next).toHaveBeenCalled();
  });

  it('falls back to x-request-id when correlation id header is absent', () => {
    const middleware = createCorrelationIdMiddleware();
    const req = createMockRequest({
      headers: { [REQUEST_ID_HEADER]: 'req-id-9' },
    });
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(req.correlationId).toBe('req-id-9');
  });

  it('generates a UUID when no incoming id is present', () => {
    const middleware = createCorrelationIdMiddleware();
    const req = createMockRequest();
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(req.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('truncates overly long incoming ids', () => {
    const long = 'a'.repeat(200);
    const middleware = createCorrelationIdMiddleware();
    const req = createMockRequest({
      headers: { [CORRELATION_ID_HEADER]: long },
    });
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(req.correlationId?.length).toBe(128);
  });

  it('logs path without query on finish when accessLogger is provided', () => {
    const accessLogger = { log: jest.fn() };
    const middleware = createCorrelationIdMiddleware(accessLogger);
    const req = createMockRequest({
      originalUrl: '/api/foo?access_token=secret',
      url: '/api/foo?access_token=secret',
    });
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);
    res.emit('finish');

    expect(accessLogger.log).toHaveBeenCalledTimes(1);
    const line = accessLogger.log.mock.calls[0][0] as string;

    expect(line).toContain('GET /api/foo');
    expect(line).not.toContain('access_token');
    expect(line).not.toContain('secret');
    expect(line).toContain('corr=');
  });

  it('does not register access logging when accessLogger is omitted', () => {
    const middleware = createCorrelationIdMiddleware();
    const req = createMockRequest();
    const res = createMockResponse();
    const finishSpy = jest.spyOn(res, 'on');

    middleware(req, res, jest.fn() as NextFunction);

    expect(finishSpy.mock.calls.some((c) => c[0] === 'finish')).toBe(false);
  });
});
