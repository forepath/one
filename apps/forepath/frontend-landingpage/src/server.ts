import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMainModule } from '@angular/ssr/node';
import { createSsrExpressApp } from '@forepath/shared/frontend/util-express-server/ssr';

import bootstrap from './main.server';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const { app, warmStaticCache } = createSsrExpressApp({
  apexDomains: ['forepath.io'],
  bootstrap,
  serverDistFolder,
});

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = parseInt(process.env['PORT'] || '4000', 10);

  warmStaticCache()
    .then(() => {
      app.listen(port, '0.0.0.0', () => {
        console.log(`Node Express server listening on http://localhost:${port}`);
      });
    })
    .catch((error: unknown) => {
      console.error('Failed to warm static memory cache:', error);
      process.exit(1);
    });
}

export default app;
