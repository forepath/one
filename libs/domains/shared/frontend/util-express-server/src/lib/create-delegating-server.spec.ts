import { createServer, request as httpRequest } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createDelegatingServer,
  defaultLoadLocaleServerModule,
  resolveLocaleFromRequest,
  resolveLocalizedStaticFilePath,
  startDelegatingServerFromImportMetaUrl,
  type LocaleExpressHandler,
  type LocaleServerModuleLoader,
} from './create-delegating-server';
import { clearStaticMemoryCache, warmStaticMemoryCache } from './static-memory-cache';

async function httpGet(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers as Record<string, string | string[] | undefined>,
          });
        });
      },
    );

    req.on('error', reject);
    req.end();
  });
}

function closeServer(server: { close: (cb: (error?: Error | null) => void) => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function createLocaleLoader(handlers: Record<string, LocaleExpressHandler>): LocaleServerModuleLoader {
  return async (serverPath) => {
    for (const [locale, handler] of Object.entries(handlers)) {
      if (serverPath.includes(`${join(locale, 'server.mjs')}`)) {
        return { default: handler };
      }
    }

    throw new Error(`No mocked handler for ${serverPath}`);
  };
}

describe('create-delegating-server', () => {
  let serverRoot: string;
  const enHandler: LocaleExpressHandler = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`ssr-en:${req.url || ''}`);
  };
  const deHandler: LocaleExpressHandler = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`ssr-de:${req.url || ''}`);
  };

  beforeEach(() => {
    clearStaticMemoryCache();
    serverRoot = mkdtempSync(join(tmpdir(), 'delegating-server-'));
    mkdirSync(join(serverRoot, 'browser', 'en'), { recursive: true });
    mkdirSync(join(serverRoot, 'browser', 'de'), { recursive: true });
    writeFileSync(join(serverRoot, 'browser', 'en', 'index.html'), '<html>en-home</html>');
    writeFileSync(join(serverRoot, 'browser', 'en', 'app.js'), 'console.log("en")');
    writeFileSync(join(serverRoot, 'browser', 'en', 'about.html'), '<html>about</html>');
    mkdirSync(join(serverRoot, 'browser', 'en', 'pricing'), { recursive: true });
    writeFileSync(join(serverRoot, 'browser', 'en', 'pricing', 'index.html'), '<html>pricing</html>');
    mkdirSync(join(serverRoot, 'en'), { recursive: true });
    mkdirSync(join(serverRoot, 'de'), { recursive: true });
    writeFileSync(join(serverRoot, 'en', 'server.mjs'), '// placeholder for existsSync\n');
    writeFileSync(join(serverRoot, 'de', 'server.mjs'), '// placeholder for existsSync\n');
  });

  afterEach(() => {
    clearStaticMemoryCache();
    rmSync(serverRoot, { recursive: true, force: true });
  });

  describe('resolveLocalizedStaticFilePath', () => {
    it('returns null for source maps', () => {
      expect(resolveLocalizedStaticFilePath(join(serverRoot, 'browser', 'en'), '/app.js.map')).toBeNull();
    });

    it('resolves extensionless .html siblings from cache', async () => {
      const browserEn = join(serverRoot, 'browser', 'en');

      await warmStaticMemoryCache([browserEn], {});

      expect(resolveLocalizedStaticFilePath(browserEn, '/about')).toBe(join(browserEn, 'about.html'));
    });

    it('resolves extensionless .html siblings from disk when uncached', () => {
      const browserEn = join(serverRoot, 'browser', 'en');

      expect(resolveLocalizedStaticFilePath(browserEn, '/about')).toBe(join(browserEn, 'about.html'));
    });
  });

  describe('resolveLocaleFromRequest', () => {
    it('falls back to the default locale', () => {
      expect(
        resolveLocaleFromRequest({ url: '/pricing', headers: { host: 'localhost' } } as never, ['en', 'de'], 'en'),
      ).toBe('en');
    });
  });

  describe('defaultLoadLocaleServerModule', () => {
    it('dynamically imports a locale server module path', async () => {
      const loaded = await defaultLoadLocaleServerModule(join(serverRoot, 'en', 'server.mjs'));

      expect(loaded).toEqual(expect.objectContaining({ default: expect.anything() }));
    });
  });

  describe('createDelegatingServer', () => {
    it('serves prerender HTML and assets from the memory cache', async () => {
      const handle = createDelegatingServer({
        serverRoot,
        availableLocales: ['en', 'de'],
        defaultLocale: 'en',
        port: 0,
        loadLocaleServerModule: createLocaleLoader({ en: enHandler, de: deHandler }),
      });

      await handle.listen();
      const address = handle.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const home = await httpGet(port, '/');
        expect(home.status).toBe(200);
        expect(home.body).toContain('en-home');
        expect(String(home.headers['cache-control'])).toContain('must-revalidate');

        const pricing = await httpGet(port, '/en/pricing');
        expect(pricing.status).toBe(200);
        expect(pricing.body).toContain('pricing');

        const asset = await httpGet(port, '/en/app.js');
        expect(asset.status).toBe(200);
        expect(asset.body).toContain('console.log');
        expect(String(asset.headers['cache-control'])).toContain('31536000');
      } finally {
        await closeServer(handle.server);
      }
    });

    it('returns 404 for source maps before locale handling', async () => {
      const handle = createDelegatingServer({
        serverRoot,
        availableLocales: ['en'],
        defaultLocale: 'en',
        port: 0,
        loadLocaleServerModule: createLocaleLoader({ en: enHandler }),
      });

      await handle.listen();
      const address = handle.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await httpGet(port, '/main.js.map');

        expect(response.status).toBe(404);
        expect(response.body).toBe('');
      } finally {
        await closeServer(handle.server);
      }
    });

    it('delegates to the locale SSR handler when no static file exists', async () => {
      const handle = createDelegatingServer({
        serverRoot,
        availableLocales: ['en'],
        defaultLocale: 'en',
        port: 0,
        loadLocaleServerModule: createLocaleLoader({ en: enHandler }),
      });

      await handle.listen();
      const address = handle.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await httpGet(port, '/en/missing-page?x=1');

        expect(response.status).toBe(200);
        expect(response.body).toBe('ssr-en:/missing-page?x=1');
      } finally {
        await closeServer(handle.server);
      }
    });

    it('serves from disk when the memory cache was cleared after warm', async () => {
      const handle = createDelegatingServer({
        serverRoot,
        availableLocales: ['en'],
        defaultLocale: 'en',
        port: 0,
        loadLocaleServerModule: createLocaleLoader({ en: enHandler }),
      });

      await handle.listen();
      clearStaticMemoryCache();
      const address = handle.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await httpGet(port, '/app.js');

        expect(response.status).toBe(200);
        expect(response.body).toContain('console.log');
      } finally {
        await closeServer(handle.server);
      }
    });

    it('returns 500 when the locale server was not loaded', async () => {
      const handle = createDelegatingServer({
        serverRoot,
        availableLocales: ['fr'],
        defaultLocale: 'fr',
        port: 0,
        loadLocaleServerModule: async () => ({ default: enHandler }),
      });

      await handle.listen();
      const address = handle.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await httpGet(port, '/');

        expect(response.status).toBe(500);
        expect(response.body).toContain('Locale server not found');
      } finally {
        await closeServer(handle.server);
      }
    });

    it('skips locale modules that do not export a default handler', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const handle = createDelegatingServer({
        serverRoot,
        availableLocales: ['en'],
        defaultLocale: 'en',
        port: 0,
        loadLocaleServerModule: async () => ({ default: { nope: true } }),
      });

      await handle.listen();
      const address = handle.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not export a default request handler'));
        const response = await httpGet(port, '/');

        expect(response.status).toBe(500);
      } finally {
        warn.mockRestore();
        await closeServer(handle.server);
      }
    });

    it('skips locale modules that fail to import', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const handle = createDelegatingServer({
        serverRoot,
        availableLocales: ['en'],
        defaultLocale: 'en',
        port: 0,
        loadLocaleServerModule: async () => {
          throw new Error('boom');
        },
      });

      await handle.listen();

      try {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Failed to load server for locale en:'), 'boom');
      } finally {
        warn.mockRestore();
        await closeServer(handle.server);
      }
    });

    it('returns 500 when the request handler throws before headers are sent', async () => {
      const throwingHandler: LocaleExpressHandler = () => {
        throw new Error('handler failed');
      };
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const handle = createDelegatingServer({
        serverRoot,
        availableLocales: ['en'],
        defaultLocale: 'en',
        port: 0,
        loadLocaleServerModule: createLocaleLoader({ en: throwingHandler }),
      });

      await handle.listen();
      const address = handle.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await httpGet(port, '/no-static');

        expect(response.status).toBe(500);
        expect(response.body).toBe('Internal Server Error');
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
        await closeServer(handle.server);
      }
    });

    it('rejects listen when the port is already in use', async () => {
      const blocker = createServer(() => undefined);

      await new Promise<void>((resolve, reject) => {
        blocker.listen(0, '127.0.0.1', () => resolve());
        blocker.once('error', reject);
      });
      const blockerAddress = blocker.address();
      const busyPort = typeof blockerAddress === 'object' && blockerAddress ? blockerAddress.port : 0;

      const handle = createDelegatingServer({
        serverRoot,
        availableLocales: ['en'],
        defaultLocale: 'en',
        port: busyPort,
        loadLocaleServerModule: createLocaleLoader({ en: enHandler }),
      });

      await expect(handle.listen()).rejects.toThrow();
      await closeServer(blocker);
    });

    it('uses PORT env default when options omit port', async () => {
      const previousPort = process.env['PORT'];

      process.env['PORT'] = '0';

      try {
        const handle = createDelegatingServer({
          serverRoot,
          availableLocales: ['en'],
          loadLocaleServerModule: createLocaleLoader({ en: enHandler }),
        });

        await handle.listen();
        const address = handle.server.address();
        const port = typeof address === 'object' && address ? address.port : 0;

        expect(port).toBeGreaterThan(0);
        await closeServer(handle.server);
      } finally {
        if (previousPort === undefined) {
          delete process.env['PORT'];
        } else {
          process.env['PORT'] = previousPort;
        }
      }
    });
  });

  describe('startDelegatingServerFromImportMetaUrl', () => {
    it('boots from the import meta directory and returns the handle', async () => {
      writeFileSync(join(serverRoot, 'marker.mjs'), '// entry marker\n');
      const handle = startDelegatingServerFromImportMetaUrl(pathToFileURL(join(serverRoot, 'marker.mjs')).href, {
        availableLocales: ['en'],
        defaultLocale: 'en',
        port: 0,
        loadLocaleServerModule: createLocaleLoader({ en: enHandler }),
      });

      await new Promise<void>((resolve, reject) => {
        if (handle.server.listening) {
          resolve();

          return;
        }

        handle.server.once('listening', () => resolve());
        handle.server.once('error', reject);
      });

      const address = handle.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await httpGet(port, '/');

        expect(response.status).toBe(200);
        expect(response.body).toContain('en-home');
      } finally {
        await closeServer(handle.server);
      }
    });

    it('exits the process when listen fails', async () => {
      const blocker = createServer(() => undefined);

      await new Promise<void>((resolve, reject) => {
        blocker.listen(0, '127.0.0.1', () => resolve());
        blocker.once('error', reject);
      });
      const blockerAddress = blocker.address();
      const busyPort = typeof blockerAddress === 'object' && blockerAddress ? blockerAddress.port : 0;

      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      writeFileSync(join(serverRoot, 'marker.mjs'), '// entry marker\n');
      startDelegatingServerFromImportMetaUrl(pathToFileURL(join(serverRoot, 'marker.mjs')).href, {
        availableLocales: ['en'],
        defaultLocale: 'en',
        port: busyPort,
        loadLocaleServerModule: createLocaleLoader({ en: enHandler }),
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(errorSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      errorSpy.mockRestore();
      await closeServer(blocker);
    });
  });
});
