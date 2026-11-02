import { createLoadweaverShell } from './shell';
import type { LoadweaverDocsEnvironment } from './environment.interface';

export const environment: LoadweaverDocsEnvironment = {
  ...createLoadweaverShell({
    production: false,
    socialPreviewImageUrl: 'http://localhost:4603/assets/images/og-preview.png',
  }),
  docs: {
    contentRoot: 'loadweaver',
  },
};
