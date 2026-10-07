import { createDecabillShell } from './shell';
import type { DecabillBillingConsoleEnvironment } from './environment.interface';

export const environment: DecabillBillingConsoleEnvironment = {
  ...createDecabillShell({
    production: false,
    socialPreviewImageUrl: 'http://localhost:4202/assets/images/og-preview.png',
    cookieConsentEnabled: false,
  }),
  billing: {
    tenantId: 'decabill',
    urls: {
      restApi: 'http://localhost:3200/api',
      frontend: 'http://localhost:4202',
      websocket: 'http://localhost:3200/socket/billing',
    },
  },
};
