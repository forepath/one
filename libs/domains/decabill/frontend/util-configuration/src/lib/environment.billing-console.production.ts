import type { DecabillBillingConsoleEnvironment } from './environment.interface';
import { createDecabillShell } from './shell';

export const environment: DecabillBillingConsoleEnvironment = {
  ...createDecabillShell({
    production: true,
    socialPreviewImageUrl: 'https://decabill.com/assets/images/og-preview.png',
    cookieConsentEnabled: false,
  }),
  billing: {
    tenantId: 'decabill',
    urls: {
      restApi: 'http://host.docker.internal:3200/api',
      frontend: 'http://host.docker.internal:4500',
      websocket: 'http://host.docker.internal:3200/socket/billing',
    },
  },
};
