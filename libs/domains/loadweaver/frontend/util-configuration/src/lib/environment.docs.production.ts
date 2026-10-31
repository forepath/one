import { createLoadweaverShell } from './shell';
import type { LoadweaverDocsEnvironment } from './environment.interface';

export const environment: LoadweaverDocsEnvironment = {
  ...createLoadweaverShell({
    production: true,
    socialPreviewImageUrl: 'https://loadweaver.com/assets/images/og-preview.png',
  }),
  docs: {
    contentRoot: 'loadweaver',
  },
};
