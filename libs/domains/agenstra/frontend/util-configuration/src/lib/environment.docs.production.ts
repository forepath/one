import { createAgenstraShell } from './shell';
import type { AgenstraDocsEnvironment } from './environment.interface';

export const environment: AgenstraDocsEnvironment = {
  ...createAgenstraShell({
    production: true,
    socialPreviewImageUrl: 'https://agenstra.com/assets/images/og-preview.png',
  }),
  docs: {
    contentRoot: 'agenstra',
  },
};
