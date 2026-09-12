import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NextFunction, Request, Response } from 'express';

import {
  __getStaticMemoryCacheSizeForTests,
  clearStaticMemoryCache,
  createMemoryStaticMiddleware,
  getCachedStaticFile,
  isStaticMemoryCacheEnabled,
  resolveStaticPathAgainstRoot,
  warmStaticMemoryCache,
  writeCachedStaticFileToNodeResponse,
} from './static-memory-cache';

describe('static-memory-cache', () => {
  let root: string;

  beforeEach(() => {
    clearStaticMemoryCache();
    root = join(tmpdir(), `static-mem-cache-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(root, 'nested'), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<html>home</html>');
    writeFileSync(join(root, 'app.js'), 'console.log(1)');
    writeFileSync(join(root, 'app.js.map'), '{"version":3}');
    writeFileSync(join(root, 'nested', 'page.html'), '<html>page</html>');
  });

  afterEach(() => {
    clearStaticMemoryCache();
    rmSync(root, { recursive: true, force: true });
  });

  describe('isStaticMemoryCacheEnabled', () => {
    it('is enabled by default', () => {
      expect(isStaticMemoryCacheEnabled({})).toBe(true);
    });

    it('is disabled when STATIC_MEMORY_CACHE=false', () => {
      expect(isStaticMemoryCacheEnabled({ STATIC_MEMORY_CACHE: 'false' })).toBe(false);
      expect(isStaticMemoryCacheEnabled({ STATIC_MEMORY_CACHE: '0' })).toBe(false);
      expect(isStaticMemoryCacheEnabled({ STATIC_MEMORY_CACHE: 'off' })).toBe(false);
      expect(isStaticMemoryCacheEnabled({ STATIC_MEMORY_CACHE: 'no' })).toBe(false);
    });
  });

  describe('warmStaticMemoryCache', () => {
    it('loads nested HTML/JS and skips .map files', async () => {
      const stats = await warmStaticMemoryCache([root], {});

      expect(stats.enabled).toBe(true);
      expect(stats.skippedMaps).toBe(1);
      expect(stats.files).toBe(3);
      expect(getCachedStaticFile(join(root, 'index.html'))?.body.toString()).toContain('home');
      expect(getCachedStaticFile(join(root, 'app.js'))).not.toBeNull();
      expect(getCachedStaticFile(join(root, 'app.js.map'))).toBeNull();
      expect(getCachedStaticFile(join(root, 'nested', 'page.html'))).not.toBeNull();
    });

    it('skips warming when STATIC_MEMORY_CACHE=false', async () => {
      const stats = await warmStaticMemoryCache([root], { STATIC_MEMORY_CACHE: 'false' });

      expect(stats.enabled).toBe(false);
      expect(stats.files).toBe(0);
      expect(__getStaticMemoryCacheSizeForTests()).toBe(0);
    });

    it('warns and continues when a root is missing or not a directory', async () => {
      const warn = jest.fn();
      const log = jest.fn();
      const fileRoot = join(root, 'app.js');

      const stats = await warmStaticMemoryCache([join(root, 'missing'), fileRoot, root], {}, { log, warn });

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('root not found'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('root is not a directory'));
      expect(stats.files).toBe(3);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Static memory cache warmed'));
    });

    it('warns when a nested directory cannot be read', async () => {
      const locked = join(root, 'locked');

      mkdirSync(locked, { recursive: true });
      writeFileSync(join(locked, 'secret.txt'), 'secret');
      chmodSync(locked, 0o000);

      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      try {
        await warmStaticMemoryCache([root], {});
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('unable to read directory'));
      } finally {
        chmodSync(locked, 0o700);
        warn.mockRestore();
      }
    });

    it('warns when an individual file cannot be read', async () => {
      const blocked = join(root, 'blocked.bin');

      writeFileSync(blocked, 'x');
      chmodSync(blocked, 0o000);

      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      try {
        const stats = await warmStaticMemoryCache([root], {});

        expect(stats.files).toBe(3);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to load'));
      } finally {
        chmodSync(blocked, 0o600);
        warn.mockRestore();
      }
    });

    it('skips non-file directory entries while warming', async () => {
      const fifoPath = join(root, 'pipe.fifo');

      try {
        execFileSync('mkfifo', [fifoPath]);
      } catch {
        // Environments without mkfifo cannot exercise this branch.
        return;
      }

      const stats = await warmStaticMemoryCache([root], {});

      expect(stats.files).toBe(3);
      expect(getCachedStaticFile(fifoPath)).toBeNull();
    });
  });

  describe('writeCachedStaticFileToNodeResponse', () => {
    it('writes HTML and non-HTML cache headers with validators', async () => {
      await warmStaticMemoryCache([root], {});

      const htmlCached = getCachedStaticFile(join(root, 'index.html'));
      const jsCached = getCachedStaticFile(join(root, 'app.js'));

      expect(htmlCached).not.toBeNull();
      expect(jsCached).not.toBeNull();
      expect(htmlCached!.etag).toMatch(/^"sha256-/);
      expect(jsCached!.etag).toMatch(/^"sha256-/);
      expect(jsCached!.etag).not.toBe(htmlCached!.etag);

      const htmlHeaders: Record<string, string | number> = {};
      let htmlBody: Buffer | undefined;
      writeCachedStaticFileToNodeResponse(
        {
          writeHead(_code, headers) {
            Object.assign(htmlHeaders, headers);
          },
          end(body) {
            htmlBody = body;
          },
        },
        htmlCached!,
      );
      expect(htmlHeaders['Cache-Control']).toContain('must-revalidate');
      expect(htmlHeaders['ETag']).toBe(htmlCached!.etag);
      expect(htmlHeaders['Last-Modified']).toBeTruthy();
      expect(String(htmlBody)).toContain('home');

      const jsHeaders: Record<string, string | number> = {};
      writeCachedStaticFileToNodeResponse(
        {
          writeHead(_code, headers) {
            Object.assign(jsHeaders, headers);
          },
          end() {
            return;
          },
        },
        jsCached!,
      );
      expect(jsHeaders['Cache-Control']).toBe('public, max-age=31536000, immutable');
      expect(jsHeaders['ETag']).toBe(jsCached!.etag);
      expect(jsHeaders['Last-Modified']).toBeTruthy();
    });

    it('returns 304 when If-None-Match matches', async () => {
      await warmStaticMemoryCache([root], {});
      const jsCached = getCachedStaticFile(join(root, 'app.js'));

      expect(jsCached).not.toBeNull();

      let status = 0;
      const headers: Record<string, string | number> = {};
      let body: Buffer | undefined;

      writeCachedStaticFileToNodeResponse(
        {
          writeHead(code, responseHeaders) {
            status = code;
            Object.assign(headers, responseHeaders);
          },
          end(chunk) {
            body = chunk;
          },
        },
        jsCached!,
        { headers: { 'if-none-match': jsCached!.etag } },
      );

      expect(status).toBe(304);
      expect(body).toBeUndefined();
      expect(headers['ETag']).toBe(jsCached!.etag);
      expect(headers['Cache-Control']).toContain('immutable');
      expect(headers['Content-Length']).toBeUndefined();
    });

    it('keeps a stable ETag for identical bytes across warms', async () => {
      await warmStaticMemoryCache([root], {});
      const first = getCachedStaticFile(join(root, 'app.js'))!.etag;

      clearStaticMemoryCache();
      await warmStaticMemoryCache([root], {});
      const second = getCachedStaticFile(join(root, 'app.js'))!.etag;

      expect(second).toBe(first);
    });
  });

  describe('resolveStaticPathAgainstRoot', () => {
    beforeEach(async () => {
      await warmStaticMemoryCache([root], {});
    });

    it('resolves / to index.html', () => {
      expect(resolveStaticPathAgainstRoot(root, '/', 'index.html')).toBe(join(root, 'index.html'));
    });

    it('resolves exact cached files', () => {
      expect(resolveStaticPathAgainstRoot(root, '/app.js', false)).toBe(join(root, 'app.js'));
    });

    it('forbids source maps', () => {
      expect(resolveStaticPathAgainstRoot(root, '/app.js.map', false)).toBe('forbidden-map');
    });

    it('returns null on miss', () => {
      expect(resolveStaticPathAgainstRoot(root, '/missing.js', false)).toBeNull();
    });

    it('rejects path traversal and malformed encodings', () => {
      expect(resolveStaticPathAgainstRoot(root, '/../etc/passwd', 'index.html')).toBeNull();
      expect(resolveStaticPathAgainstRoot(root, '/%E0%A4%A', false)).toBeNull();
    });
  });

  describe('createMemoryStaticMiddleware', () => {
    function mockRes(): Response & {
      statusCode: number;
      headers: Record<string, string | number>;
      body?: Buffer | string;
    } {
      const state: {
        statusCode: number;
        headers: Record<string, string | number>;
        body?: Buffer | string;
      } = {
        statusCode: 200,
        headers: {},
      };

      const res = {
        get statusCode() {
          return state.statusCode;
        },
        get headers() {
          return state.headers;
        },
        get body() {
          return state.body;
        },
        status(code: number) {
          state.statusCode = code;

          return this;
        },
        setHeader(name: string, value: string | number) {
          state.headers[name.toLowerCase()] = value;
        },
        end(body?: Buffer | string) {
          state.body = body;
        },
      };

      return res as unknown as Response & {
        statusCode: number;
        headers: Record<string, string | number>;
        body?: Buffer | string;
      };
    }

    it('serves from memory on cache hit', async () => {
      await warmStaticMemoryCache([root], {});
      const middleware = createMemoryStaticMiddleware({ root, index: 'index.html' });
      const req = { method: 'GET', path: '/', headers: {} } as Request;
      const res = mockRes();
      const next = jest.fn() as NextFunction;

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(String(res.body)).toContain('home');
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['etag']).toMatch(/^"sha256-/);
      expect(res.headers['cache-control']).toContain('must-revalidate');
    });

    it('returns 304 for matching If-None-Match on assets', async () => {
      await warmStaticMemoryCache([root], {});
      const cached = getCachedStaticFile(join(root, 'app.js'));
      const middleware = createMemoryStaticMiddleware({ root, index: false });
      const res = mockRes();
      const next = jest.fn() as NextFunction;

      middleware({ method: 'GET', path: '/app.js', headers: { 'if-none-match': cached!.etag } } as Request, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(304);
      expect(res.body).toBeUndefined();
      expect(res.headers['etag']).toBe(cached!.etag);
      expect(res.headers['cache-control']).toContain('immutable');
    });

    it('returns 404 for .map requests', async () => {
      await warmStaticMemoryCache([root], {});
      const middleware = createMemoryStaticMiddleware({ root, index: false });
      const req = { method: 'GET', path: '/app.js.map' } as Request;
      const res = mockRes();
      const next = jest.fn() as NextFunction;

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
    });

    it('falls through on miss', async () => {
      await warmStaticMemoryCache([root], {});
      const middleware = createMemoryStaticMiddleware({ root, index: false });
      const req = { method: 'GET', path: '/nope.js' } as Request;
      const res = mockRes();
      const next = jest.fn() as NextFunction;

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('passthrough when cache disabled except .map still 404', () => {
      const previous = process.env['STATIC_MEMORY_CACHE'];

      process.env['STATIC_MEMORY_CACHE'] = 'false';

      try {
        const middleware = createMemoryStaticMiddleware({ root, index: false });
        const next = jest.fn() as NextFunction;
        const resOk = mockRes();

        middleware({ method: 'GET', path: '/app.js' } as Request, resOk, next);
        expect(next).toHaveBeenCalled();

        const nextMap = jest.fn() as NextFunction;
        const resMap = mockRes();

        middleware({ method: 'GET', path: '/app.js.map' } as Request, resMap, nextMap);
        expect(nextMap).not.toHaveBeenCalled();
        expect(resMap.statusCode).toBe(404);
      } finally {
        if (previous === undefined) {
          delete process.env['STATIC_MEMORY_CACHE'];
        } else {
          process.env['STATIC_MEMORY_CACHE'] = previous;
        }
      }
    });

    it('ignores non-GET/HEAD methods', async () => {
      await warmStaticMemoryCache([root], {});
      const middleware = createMemoryStaticMiddleware({ root, index: 'index.html' });
      const next = jest.fn() as NextFunction;

      middleware({ method: 'POST', path: '/' } as Request, mockRes(), next);

      expect(next).toHaveBeenCalled();
    });

    it('serves HEAD responses without a body', async () => {
      await warmStaticMemoryCache([root], {});
      const middleware = createMemoryStaticMiddleware({ root, index: 'index.html' });
      const res = mockRes();
      const next = jest.fn() as NextFunction;

      middleware({ method: 'HEAD', path: '/' } as Request, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(res.body).toBeUndefined();
      expect(res.headers['content-length']).toBeGreaterThan(0);
    });
  });
});
