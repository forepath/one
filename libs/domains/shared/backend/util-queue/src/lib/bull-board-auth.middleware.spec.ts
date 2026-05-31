import type { Request, Response } from 'express';

import { createBullBoardAuthMiddleware } from './bull-board-auth.middleware';

function createMockResponse(): Response & { statusCode: number; body: string; headers: Record<string, string> } {
  const res = {
    statusCode: 200,
    body: '',
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;

      return this;
    },
    send(payload: string) {
      this.body = payload;
    },
  };

  return res as Response & typeof res;
}

describe('createBullBoardAuthMiddleware', () => {
  it('rejects when password is not configured', () => {
    const middleware = createBullBoardAuthMiddleware({ username: 'admin', password: '' });
    const res = createMockResponse();
    const next = jest.fn();

    middleware({ headers: {} } as Request, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects missing Authorization header', () => {
    const middleware = createBullBoardAuthMiddleware({ username: 'admin', password: 'bullmq' });
    const res = createMockResponse();
    const next = jest.fn();

    middleware({ headers: {} } as Request, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid credentials', () => {
    const middleware = createBullBoardAuthMiddleware({ username: 'admin', password: 'bullmq' });
    const res = createMockResponse();
    const next = jest.fn();
    const authorization = `Basic ${Buffer.from('admin:wrong').toString('base64')}`;

    middleware({ headers: { authorization } } as Request, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows valid credentials', () => {
    const middleware = createBullBoardAuthMiddleware({ username: 'admin', password: 'bullmq' });
    const res = createMockResponse();
    const next = jest.fn();
    const authorization = `Basic ${Buffer.from('admin:bullmq').toString('base64')}`;

    middleware({ headers: { authorization } } as Request, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
});
