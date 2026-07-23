import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { stripLocalePrefixFromPath } from './localized-browser-dist';
import {
  getCachedStaticFile,
  getContentTypeForStaticPath,
  isSourceMapPath,
  warmStaticMemoryCache,
  writeCachedStaticFileToNodeResponse,
} from './static-memory-cache';

export type LocaleExpressHandler = (req: IncomingMessage, res: ServerResponse) => unknown;

export type LocaleServerModuleLoader = (serverPath: string) => Promise<{ default?: unknown }>;

export interface CreateDelegatingServerOptions {
  /**
   * Absolute path to the directory that contains per-locale `server.mjs` folders
   * and the shared `browser/` tree (typically the compiled `server/` output dir).
   */
  serverRoot: string;
  availableLocales?: readonly string[];
  defaultLocale?: string;
  port?: number | string;
  /**
   * Optional override for loading locale `server.mjs` modules (tests).
   * Defaults to a dynamic `import()` of the file URL.
   */
  loadLocaleServerModule?: LocaleServerModuleLoader;
}

export interface DelegatingServerHandle {
  server: Server;
  listen: () => Promise<void>;
}

/**
 * Resolves a filesystem path for a localized browser URL, including extensionless
 * prerender routes (`/pricing` → `pricing/index.html`).
 */
export function resolveLocalizedStaticFilePath(browserLocaleRoot: string, pathname: string): string | null {
  if (pathname.startsWith('/api/')) {
    return null;
  }

  if (isSourceMapPath(pathname)) {
    return null;
  }

  const relativePath = pathname === '/' ? '' : pathname.replace(/^\//, '');
  const directPath = join(browserLocaleRoot, relativePath);
  const cachedDirect = getCachedStaticFile(directPath);

  if (cachedDirect) {
    return cachedDirect.absolutePath;
  }

  const indexPath = join(directPath, 'index.html');
  const cachedIndex = getCachedStaticFile(indexPath);

  if (cachedIndex) {
    return cachedIndex.absolutePath;
  }

  if (existsSync(directPath)) {
    const stat = statSync(directPath);

    if (stat.isFile()) {
      return directPath;
    }

    if (stat.isDirectory() && existsSync(indexPath) && statSync(indexPath).isFile()) {
      return indexPath;
    }
  }

  if (!pathname.includes('.')) {
    const htmlPath = join(browserLocaleRoot, `${relativePath}.html`);
    const cachedHtml = getCachedStaticFile(htmlPath);

    if (cachedHtml) {
      return cachedHtml.absolutePath;
    }

    if (existsSync(htmlPath) && statSync(htmlPath).isFile()) {
      return htmlPath;
    }
  }

  return null;
}

export function resolveLocaleFromRequest(
  req: IncomingMessage,
  availableLocales: readonly string[],
  defaultLocale: string,
): string {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathSegments = url.pathname.split('/').filter(Boolean);

  if (pathSegments.length > 0 && availableLocales.includes(pathSegments[0])) {
    return pathSegments[0];
  }

  const acceptLanguage = req.headers['accept-language'];

  if (acceptLanguage) {
    for (const locale of availableLocales) {
      if (acceptLanguage.toLowerCase().includes(locale.toLowerCase())) {
        return locale;
      }
    }
  }

  return defaultLocale;
}

function sendStaticFile(res: ServerResponse, filePath: string): void {
  const cached = getCachedStaticFile(filePath);

  if (cached) {
    writeCachedStaticFileToNodeResponse(res, cached);

    return;
  }

  const stat = statSync(filePath);
  const isHtml = extname(filePath).toLowerCase() === '.html';

  res.writeHead(200, {
    'Content-Type': getContentTypeForStaticPath(filePath),
    'Content-Length': stat.size,
    'Cache-Control': isHtml ? 'public, max-age=0, must-revalidate' : 'public, max-age=31536000',
  });

  createReadStream(filePath).pipe(res);
}

export const defaultLoadLocaleServerModule: LocaleServerModuleLoader = async (serverPath) => {
  return import(pathToFileURL(serverPath).href) as Promise<{ default?: unknown }>;
};

async function loadLocaleServers(
  serverRoot: string,
  availableLocales: readonly string[],
  loadLocaleServerModule: LocaleServerModuleLoader,
): Promise<Map<string, LocaleExpressHandler>> {
  const localeServers = new Map<string, LocaleExpressHandler>();

  for (const locale of availableLocales) {
    const serverPath = join(serverRoot, locale, 'server.mjs');

    if (!existsSync(serverPath)) {
      console.warn(`Server file not found for locale: ${locale} at ${serverPath}`);
      continue;
    }

    try {
      const serverModule = await loadLocaleServerModule(serverPath);
      const handler = serverModule.default as LocaleExpressHandler | undefined;

      if (typeof handler !== 'function') {
        console.warn(`Locale server for ${locale} did not export a default request handler`);
        continue;
      }

      localeServers.set(locale, handler);
      console.log(`Loaded server for locale: ${locale}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      console.warn(`Failed to load server for locale ${locale}:`, message);
    }
  }

  return localeServers;
}

/**
 * Creates a Node HTTP front that serves localized prerender output first and
 * only delegates to per-locale Express SSR apps when no static file exists.
 */
export function createDelegatingServer(options: CreateDelegatingServerOptions): DelegatingServerHandle {
  const availableLocales = options.availableLocales ?? ['en', 'de'];
  const defaultLocale = options.defaultLocale ?? 'en';
  const port = options.port ?? process.env['PORT'] ?? 4000;
  const { serverRoot } = options;
  const loadLocaleServerModule = options.loadLocaleServerModule ?? defaultLoadLocaleServerModule;
  let localeServers = new Map<string, LocaleExpressHandler>();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (isSourceMapPath(requestUrl.pathname)) {
        res.writeHead(404);
        res.end();

        return;
      }

      const locale = resolveLocaleFromRequest(req, availableLocales, defaultLocale);
      const localeServer = localeServers.get(locale);

      if (!localeServer) {
        console.error(`No server found for locale: ${locale}`);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error: Locale server not found');

        return;
      }

      const pathnameForLocale = stripLocalePrefixFromPath(requestUrl.pathname, locale);
      const browserLocaleRoot = join(serverRoot, 'browser', locale);
      const staticFilePath = resolveLocalizedStaticFilePath(browserLocaleRoot, pathnameForLocale);

      if (staticFilePath) {
        sendStaticFile(res, staticFilePath);

        return;
      }

      const previousUrl = req.url;
      req.url = `${pathnameForLocale}${requestUrl.search}`;

      try {
        await localeServer(req, res);
      } finally {
        req.url = previousUrl;
      }
    } catch (error: unknown) {
      console.error('Error handling request:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    }
  });

  return {
    server,
    listen: async () => {
      await warmStaticMemoryCache([join(serverRoot, 'browser')]);
      localeServers = await loadLocaleServers(serverRoot, availableLocales, loadLocaleServerModule);

      await new Promise<void>((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(port, () => {
          server.off('error', rejectListen);
          console.log(`Delegating server running on http://localhost:${port}`);
          console.log(`Available locales: ${availableLocales.join(', ')}`);
          console.log(`Default locale: ${defaultLocale}`);
          resolveListen();
        });
      });
    },
  };
}

/**
 * Boots a delegating server whose `serverRoot` is the directory containing this
 * module (typical production layout after postbuild copies `server.mjs` next to
 * locale folders and `browser/`).
 */
export function startDelegatingServerFromImportMetaUrl(
  importMetaUrl: string,
  options: Omit<CreateDelegatingServerOptions, 'serverRoot'> = {},
): DelegatingServerHandle {
  const serverRoot = dirname(fileURLToPath(importMetaUrl));
  const handle = createDelegatingServer({ ...options, serverRoot });

  void handle.listen().catch((error: unknown) => {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  });

  return handle;
}
