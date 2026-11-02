import express from 'express';
import type { AddressInfo } from 'node:net';

import { bodyParserErrorHandler } from './body-parser-errors';

describe('bodyParserErrorHandler (3.40)', () => {
  const SECRET = 'hunter2-super-secret-value';

  async function serve(log: string[]) {
    const app = express();

    app.use(express.json({ limit: '1kb' }));
    app.use(bodyParserErrorHandler((message) => log.push(message)));
    app.put('/api/projects/shop/secrets/db', (_req, res) => res.status(204).end());
    app.get('/boom', (_req, _res, next) => next(new Error('not a parser error')));
    app.use(((error, _req, res, _next) =>
      res.status(500).json({ passed: (error as Error).message })) as express.ErrorRequestHandler);

    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;

    return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
  }

  it('answers malformed JSON with a fixed message, no-store, and never echoes or logs the body', async () => {
    const log: string[] = [];
    const { base, close } = await serve(log);

    try {
      const res = await fetch(`${base}/api/projects/shop/secrets/db`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: `{"value": ${SECRET}}`,
      });
      const text = await res.text();

      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(JSON.parse(text)).toEqual({
        statusCode: 400,
        message: 'request body is not valid JSON',
        error: 'Bad Request',
      });
      expect(text).not.toContain('hunter2');
      expect(log).toEqual(['PUT /api/projects/shop/secrets/db: body rejected (entity.parse.failed, 400)']);
      expect(log.join()).not.toContain('hunter2');
    } finally {
      await close();
    }
  });

  it('answers oversized bodies with 413 without the body', async () => {
    const log: string[] = [];
    const { base, close } = await serve(log);

    try {
      const res = await fetch(`${base}/api/projects/shop/secrets/db`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: SECRET.repeat(100) }),
      });

      expect(res.status).toBe(413);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).not.toContain('hunter2');
    } finally {
      await close();
    }
  });

  it('passes other errors on', async () => {
    const { base, close } = await serve([]);

    try {
      const res = await fetch(`${base}/boom`);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ passed: 'not a parser error' });
    } finally {
      await close();
    }
  });
});
