import type { DecabillDocsEnvironment } from './environment.interface';
import { createDecabillShell } from './shell';

export const environment: DecabillDocsEnvironment = {
  ...createDecabillShell({
    production: false,
    socialPreviewImageUrl: 'http://localhost:4201/assets/images/og-preview.png',
    cookieConsentEnabled: true,
  }),
  docs: {
    contentRoot: 'decabill',
  },
};
