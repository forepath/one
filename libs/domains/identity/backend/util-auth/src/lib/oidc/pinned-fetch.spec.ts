import * as http from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';

import { OIDC_HTTP_MAX_BYTES } from './oidc-http';
import { createPinnedFetch } from './pinned-fetch';

describe('createPinnedFetch', () => {
  let server: http.Server;
  let port: number;
  let lastRequest: { method?: string; headers: http.IncomingHttpHeaders; body: string } | undefined;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';

      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        lastRequest = { method: req.method, headers: req.headers, body };

        if (req.url === '/redirect') {
          res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
          res.end();

          return;
        }

        if (req.url === '/huge') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('x'.repeat(OIDC_HTTP_MAX_BYTES + 10));

          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Resolves every hostname to 127.0.0.1 and records which hostnames were looked up. */
  function recordingLookup(seen: string[], allow = true): LookupFunction {
    return ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
      seen.push(hostname);

      if (!allow) {
        callback(Object.assign(new Error('blocked'), { code: 'EACCES' }));

        return;
      }

      if (options?.all) {
        callback(null, [{ address: '127.0.0.1', family: 4 }]);
      } else {
        callback(null, '127.0.0.1', 4);
      }
    }) as unknown as LookupFunction;
  }

  it('resolves the connection through the provided lookup and sends method, headers and body', async () => {
    const seen: string[] = [];
    const fetchImpl = createPinnedFetch(recordingLookup(seen));
    const response = await fetchImpl(`http://idp.example.test:${port}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic abc' },
      body: 'grant_type=client_credentials',
    });

    expect(seen).toEqual(['idp.example.test']);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(lastRequest).toMatchObject({
      method: 'POST',
      body: 'grant_type=client_credentials',
      headers: expect.objectContaining({ authorization: 'Basic abc', 'content-length': '29' }),
    });
  });

  it('fails when the lookup rejects the address (no connection made, pooled sockets are never reused)', async () => {
    // Warm a pooled keep-alive connection to the same host:port through the global agent first.
    await new Promise<void>((resolve) =>
      http.get(`http://localhost:${port}/warm`, (res) => res.resume().on('end', resolve)),
    );
    lastRequest = undefined;

    await expect(createPinnedFetch(recordingLookup([], false))(`http://localhost:${port}/x`)).rejects.toThrow(
      /blocked/,
    );
    expect(lastRequest).toBeUndefined();
  });

  it('never follows redirects', async () => {
    const response = await createPinnedFetch(recordingLookup([]))(`http://idp.example.test:${port}/redirect`);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('169.254.169.254');
  });

  it('aborts oversized responses', async () => {
    await expect(createPinnedFetch(recordingLookup([]))(`http://idp.example.test:${port}/huge`)).rejects.toThrow(
      /exceeds/,
    );
  });

  it('rejects non-http protocols', async () => {
    await expect(createPinnedFetch(recordingLookup([]))('file:///etc/passwd')).rejects.toThrow(/Unsupported protocol/);
  });

  it.each(['999', '100', '600'])(
    'rejects (instead of crashing the process) when a hostile server answers with status %s',
    async (status) => {
      const net = await import('node:net');
      const raw = net.createServer((socket) => {
        socket.once('data', () => {
          socket.end(`HTTP/1.1 ${status} Weird\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`);
        });
      });

      await new Promise<void>((resolve) => raw.listen(0, '127.0.0.1', resolve));

      const rawPort = (raw.address() as AddressInfo).port;
      const uncaught = jest.fn();

      process.on('uncaughtException', uncaught);

      try {
        const result = createPinnedFetch(recordingLookup([]))(`http://localhost:${rawPort}/x`);

        if (status === '100') {
          // 1xx informational responses are consumed by node; the request then fails on the closed socket.
          await expect(result).rejects.toThrow();
        } else {
          await expect(result).rejects.toThrow(/Unsupported HTTP status/);
        }

        expect(uncaught).not.toHaveBeenCalled();
      } finally {
        process.off('uncaughtException', uncaught);
        await new Promise<void>((resolve) => raw.close(() => resolve()));
      }
    },
  );

  it('maps the bad-status rejection through oidcFetchJson to a normal error', async () => {
    const net = await import('node:net');
    const raw = net.createServer((socket) => {
      socket.once('data', () => socket.end('HTTP/1.1 999 X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));
    });

    await new Promise<void>((resolve) => raw.listen(0, '127.0.0.1', resolve));

    try {
      const { oidcFetchJson } = await import('./oidc-http');

      await expect(
        oidcFetchJson(
          createPinnedFetch(recordingLookup([])),
          `http://localhost:${(raw.address() as AddressInfo).port}/`,
        ),
      ).rejects.toThrow(/failed/);
    } finally {
      await new Promise<void>((resolve) => raw.close(() => resolve()));
    }
  });
});
