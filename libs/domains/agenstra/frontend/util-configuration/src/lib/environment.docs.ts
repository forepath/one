import type { AgenstraDocsEnvironment } from './environment.interface';
import { createAgenstraShell } from './shell';

export const environment: AgenstraDocsEnvironment = {
  ...createAgenstraShell({
    production: false,
    socialPreviewImageUrl: 'http://localhost:4102/assets/images/og-preview.png',
  }),
  docs: {
    contentRoot: 'agenstra',
  },
};
