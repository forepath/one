import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMainModule } from '@angular/ssr/node';
import { createDocsServer } from '@forepath/shared/frontend/util-express-server/docs-server';

import bootstrap from './main.server';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const { app, warmStaticCache } = createDocsServer(['agenstra.com'], bootstrap, serverDistFolder);

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
