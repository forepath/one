import { isMainModule } from '@angular/ssr/node';
import { createDocsServer } from '@forepath/shared/frontend/util-express-server/docs-server';
import { fileURLToPath } from 'node:url';

import bootstrap from './main.server';

const app = createDocsServer(['agenstra.com'], bootstrap);

if (isMainModule(fileURLToPath(import.meta.url))) {
  const port = parseInt(process.env['PORT'] || '4000', 10);

  app.listen(port, '0.0.0.0', () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export default app;
