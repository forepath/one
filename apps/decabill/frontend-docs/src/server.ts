import { isMainModule } from '@angular/ssr/node';
// eslint-disable-next-line @nx/enforce-module-boundaries
import bootstrap from '@forepath/shared/frontend/util-docs-bootstrap';
import { createDocsServer } from '@forepath/shared/frontend/util-express-server/docs-server';
import { fileURLToPath } from 'node:url';

const app = createDocsServer(['decabill.com'], bootstrap);

if (isMainModule(fileURLToPath(import.meta.url))) {
  const port = parseInt(process.env['PORT'] || '4000', 10);

  app.listen(port, '0.0.0.0', () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export default app;
