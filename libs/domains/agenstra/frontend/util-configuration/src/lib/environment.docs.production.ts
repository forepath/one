import type { AgenstraDocsEnvironment } from './environment.interface';
import { createAgenstraShell } from './shell';

export const environment: AgenstraDocsEnvironment = {
  ...createAgenstraShell({
    production: true,
    socialPreviewImageUrl: 'https://agenstra.com/assets/images/og-preview.png',
  }),
  docs: {
    contentRoot: 'agenstra',
  },
};
