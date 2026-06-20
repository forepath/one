import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine } from '@angular/ssr/node';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import { registerRuntimeConfigEndpoint } from './runtime-config-route';
import { createSecurityHeadersMiddleware } from './security-headers';
import { buildSsrAllowedHosts } from './ssr-allowed-hosts';

export type DocsServerBootstrap = Parameters<CommonEngine['render']>[0]['bootstrap'];

export function createDocsServer(apexDomains: readonly string[], bootstrap: DocsServerBootstrap): Express {
  const serverDistFolder = dirname(fileURLToPath(import.meta.url));
  const browserDistFolder = resolve(serverDistFolder, '../browser');
  const indexHtml = join(serverDistFolder, 'index.server.html');
  const app = express();
  const commonEngine = new CommonEngine({
    allowedHosts: buildSsrAllowedHosts(apexDomains),
  });

  app.use(createSecurityHeadersMiddleware());
  registerRuntimeConfigEndpoint(app);

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

  return app;
}
