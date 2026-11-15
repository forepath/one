import type { DecabillDocsEnvironment } from './environment.interface';
import { createDecabillShell } from './shell';

export const environment: DecabillDocsEnvironment = {
  ...createDecabillShell({
    production: true,
    socialPreviewImageUrl: 'https://decabill.com/assets/images/og-preview.png',
    cookieConsentEnabled: true,
  }),
  docs: {
    contentRoot: 'decabill',
  },
};
