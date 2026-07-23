import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSsrExpressApp, type SsrExpressAppHandle, type SsrExpressBootstrap } from './create-ssr-express-app';

export type DocsServerBootstrap = SsrExpressBootstrap;

export type DocsServerHandle = SsrExpressAppHandle;

/**
 * @param serverDistFolder Directory of the locale SSR entry (`server/<locale>/`).
 * Prefer passing `dirname(fileURLToPath(import.meta.url))` from the app `server.ts`
 * so chunked bundles do not resolve the browser dist from a chunk path.
 */
export function createDocsServer(
  apexDomains: readonly string[],
  bootstrap: DocsServerBootstrap,
  serverDistFolder: string = dirname(fileURLToPath(import.meta.url)),
): DocsServerHandle {
  return createSsrExpressApp({
    apexDomains,
    bootstrap,
    serverDistFolder,
  });
}
