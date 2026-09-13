import { join } from 'node:path';

import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine } from '@angular/ssr/node';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import { resolveLocalizedBrowserDistFolder } from './localized-browser-dist';
import {
  sendHtmlStringWithRuntimeConfig,
  transformCachedFileWithRuntimeConfig,
  warmRuntimeConfigCache,
} from './runtime-config-html';
import { registerRuntimeConfigEndpoint } from './runtime-config-route';
import { createSecurityHeadersMiddleware } from './security-headers';
import { buildSsrAllowedHosts } from './ssr-allowed-hosts';
import {
  createMemoryStaticMiddleware,
  getStaticCacheControlHeader,
  warmStaticMemoryCache,
  type StaticMemoryCacheStats,
} from './static-memory-cache';

export type SsrExpressBootstrap = Parameters<CommonEngine['render']>[0]['bootstrap'];

export interface CreateSsrExpressAppOptions {
  apexDomains: readonly string[];
  bootstrap: SsrExpressBootstrap;
  serverDistFolder: string;
  shouldBypassStatic?: (pathname: string) => boolean;
}

export interface SsrExpressAppHandle {
  app: Express;
  browserDistFolder: string;
  warmStaticCache: () => Promise<StaticMemoryCacheStats>;
}

/**
 * Creates an Express app that serves localized prerender output from the
 * start-time memory cache first, then falls back to Angular CommonEngine SSR.
 * HTML responses (prerender + SSR) inline warm `CONFIG` for client bootstrap.
 */
export function createSsrExpressApp(options: CreateSsrExpressAppOptions): SsrExpressAppHandle {
  const { apexDomains, bootstrap, serverDistFolder, shouldBypassStatic } = options;
  const browserDistFolder = resolveLocalizedBrowserDistFolder(serverDistFolder);
  const indexHtml = join(serverDistFolder, 'index.server.html');
  const app = express();
  const memoryStaticMiddleware = createMemoryStaticMiddleware({
    root: browserDistFolder,
    index: 'index.html',
    transformCachedFile: transformCachedFileWithRuntimeConfig,
  });
  const diskStaticMiddleware = express.static(browserDistFolder, {
    maxAge: 0,
    index: 'index.html',
    setHeaders(res, filePath) {
      // Override serve-static defaults so HTML/stable URLs revalidate and hashed assets stay immutable.
      res.setHeader('Cache-Control', getStaticCacheControlHeader(filePath));
    },
  });
  const commonEngine = new CommonEngine({
    allowedHosts: buildSsrAllowedHosts(apexDomains),
  });

  app.use(createSecurityHeadersMiddleware());
  registerRuntimeConfigEndpoint(app);

  app.get('**', (req: Request, res: Response, next: NextFunction) => {
    if (shouldBypassStatic?.(req.path)) {
      return next();
    }

    return memoryStaticMiddleware(req, res, next);
  });

  // Disk fallback when STATIC_MEMORY_CACHE=false or a file was not warmed.
  app.get('**', (req: Request, res: Response, next: NextFunction) => {
    if (shouldBypassStatic?.(req.path)) {
      return next();
    }

    return diskStaticMiddleware(req, res, next);
  });

  app.get('**', (req: Request, res: Response, next: NextFunction) => {
    const { protocol, originalUrl, baseUrl, headers } = req;

    commonEngine
      .render({
        bootstrap,
        documentFilePath: indexHtml,
        url: `${protocol}://${headers.host}${originalUrl}`,
        publicPath: browserDistFolder,
        providers: [{ provide: APP_BASE_HREF, useValue: baseUrl }],
      })
      .then((html: string) => sendHtmlStringWithRuntimeConfig(res, `ssr:${originalUrl}`, html, Date.now(), req))
      .catch((err: unknown) => next(err));
  });

  return {
    app,
    browserDistFolder,
    warmStaticCache: async () => {
      const stats = await warmStaticMemoryCache([browserDistFolder]);

      await warmRuntimeConfigCache();

      return stats;
    },
  };
}
