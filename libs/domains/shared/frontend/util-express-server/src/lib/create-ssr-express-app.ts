import { join } from 'node:path';

import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine } from '@angular/ssr/node';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import { resolveLocalizedBrowserDistFolder } from './localized-browser-dist';
import { registerRuntimeConfigEndpoint } from './runtime-config-route';
import { createSecurityHeadersMiddleware } from './security-headers';
import { buildSsrAllowedHosts } from './ssr-allowed-hosts';
import {
  createMemoryStaticMiddleware,
  warmStaticMemoryCache,
  type StaticMemoryCacheStats,
} from './static-memory-cache';

export type SsrExpressBootstrap = Parameters<CommonEngine['render']>[0]['bootstrap'];

export interface CreateSsrExpressAppOptions {
  apexDomains: readonly string[];
  bootstrap: SsrExpressBootstrap;
  serverDistFolder: string;
}

export interface SsrExpressAppHandle {
  app: Express;
  browserDistFolder: string;
  warmStaticCache: () => Promise<StaticMemoryCacheStats>;
}

/**
 * Creates an Express app that serves localized prerender output from the
 * start-time memory cache first, then falls back to Angular CommonEngine SSR.
 */
export function createSsrExpressApp(options: CreateSsrExpressAppOptions): SsrExpressAppHandle {
  const { apexDomains, bootstrap, serverDistFolder } = options;
  const browserDistFolder = resolveLocalizedBrowserDistFolder(serverDistFolder);
  const indexHtml = join(serverDistFolder, 'index.server.html');
  const app = express();
  const commonEngine = new CommonEngine({
    allowedHosts: buildSsrAllowedHosts(apexDomains),
  });

  app.use(createSecurityHeadersMiddleware());
  registerRuntimeConfigEndpoint(app);

  app.get(
    '**',
    createMemoryStaticMiddleware({
      root: browserDistFolder,
      index: 'index.html',
    }),
  );

  // Disk fallback when STATIC_MEMORY_CACHE=false or a file was not warmed.
  app.get(
    '**',
    express.static(browserDistFolder, {
      maxAge: '1y',
      index: 'index.html',
    }),
  );

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
      .then((html: string) => res.send(html))
      .catch((err: unknown) => next(err));
  });

  return {
    app,
    browserDistFolder,
    warmStaticCache: () => warmStaticMemoryCache([browserDistFolder]),
  };
}
