import { createDecabillShell } from './shell';
import type { DecabillDocsEnvironment } from './environment.interface';

export const environment: DecabillDocsEnvironment = {
  ...createDecabillShell({
    production: false,
    socialPreviewImageUrl: 'http://localhost:4302/assets/images/og-preview.png',
    cookieConsentEnabled: true,
  }),
  docs: {
    contentRoot: 'decabill',
  },
};
