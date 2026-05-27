import { ForbiddenException, Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { createOriginAllowlistMiddleware } from './origin-allowlist.middleware';

describe('createOriginAllowlistMiddleware', () => {
  const originalEnv = process.env;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CORS_ORIGIN;
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    process.env = originalEnv;
    warnSpy.mockRestore();
  });

  function run(
    middleware: ReturnType<typeof createOriginAllowlistMiddleware>,
    partial: Partial<Request>,
  ): { nextError: unknown; nextCalled: boolean } {
    let nextError: unknown;
    let nextCalled = false;
    const next: NextFunction = (err?: unknown) => {
      nextCalled = true;
      nextError = err;
    };

    middleware(partial as Request, {} as Response, next);

    return { nextError, nextCalled };
  }

  it('skips enforcement in development when CORS_ORIGIN is unset', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CORS_ORIGIN;
    const middleware = createOriginAllowlistMiddleware(new Logger('test'));
    const { nextError, nextCalled } = run(middleware, {
      method: 'POST',
      headers: { origin: 'https://evil.com' },
    });

    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();
  });

  it('enforces in development when CORS_ORIGIN is set', () => {
    process.env.NODE_ENV = 'development';
    process.env.CORS_ORIGIN = 'https://app.example.com';
    const middleware = createOriginAllowlistMiddleware(new Logger('test'));
    const { nextError } = run(middleware, {
      method: 'POST',
      headers: { origin: 'https://evil.com' },
    });

    expect(nextError).toBeInstanceOf(ForbiddenException);
  });

  it('allows GET with any Origin when enforcing', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://app.example.com';
    const middleware = createOriginAllowlistMiddleware(new Logger('test'));
    const { nextError } = run(middleware, {
      method: 'GET',
      headers: { origin: 'https://evil.com' },
    });

    expect(nextError).toBeUndefined();
  });

  it('allows unsafe method without Origin header', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://app.example.com';
    const middleware = createOriginAllowlistMiddleware(new Logger('test'));
    const { nextError } = run(middleware, { method: 'POST', headers: {} });

    expect(nextError).toBeUndefined();
  });

  it('allows matching Origin (case-insensitive)', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://App.Example.com';
    const middleware = createOriginAllowlistMiddleware(new Logger('test'));
    const { nextError } = run(middleware, {
      method: 'POST',
      headers: { origin: 'https://app.example.com' },
    });

    expect(nextError).toBeUndefined();
  });

  it('rejects when CORS_ORIGIN empty in production and Origin present', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGIN;
    const middleware = createOriginAllowlistMiddleware(new Logger('test'));
    const { nextError } = run(middleware, {
      method: 'POST',
      headers: { origin: 'https://app.example.com' },
    });

    expect(nextError).toBeInstanceOf(ForbiddenException);
  });

  it('rejects Origin not in allowlist', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://trusted.example.com,https://other.example.com';
    const middleware = createOriginAllowlistMiddleware(new Logger('test'));
    const { nextError } = run(middleware, {
      method: 'DELETE',
      headers: { origin: 'https://evil.com' },
    });

    expect(nextError).toBeInstanceOf(ForbiddenException);
  });

  it('parses comma-separated CORS_ORIGIN with trim and lowercase (aligned with shared parseAllowedHosts)', () => {
    const sample = ' https://App.example.com , https://Other.dev ';

    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = sample;
    const middleware = createOriginAllowlistMiddleware(new Logger('test'));
    const { nextError: good } = run(middleware, {
      method: 'POST',
      headers: { origin: 'https://app.example.com' },
    });

    expect(good).toBeUndefined();

    const { nextError: bad } = run(middleware, {
      method: 'POST',
      headers: { origin: 'https://unknown.example.com' },
    });

    expect(bad).toBeInstanceOf(ForbiddenException);
  });

  it('allows any Origin when allowlist is *', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = '*';
    const middleware = createOriginAllowlistMiddleware(new Logger('test'));
    const { nextError } = run(middleware, {
      method: 'POST',
      headers: { origin: 'https://anything.example.com' },
    });

    expect(nextError).toBeUndefined();
  });

  it('skips origin enforcement for Bull Board paths', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://app.example.com';
    delete process.env.QUEUE_BULL_BOARD_PATH;
    const middleware = createOriginAllowlistMiddleware(new Logger('test'));
    const { nextError } = run(middleware, {
      method: 'DELETE',
      originalUrl: '/admin/queues/api/queues/agent-controller/jobs/clean',
      headers: { origin: 'http://localhost:3100' },
    });

    expect(nextError).toBeUndefined();
  });
});
