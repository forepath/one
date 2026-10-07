import { createAgenstraShell } from './shell';
import type { AgenstraBillingConsoleEnvironment } from './environment.interface';

export const environment: AgenstraBillingConsoleEnvironment = {
  ...createAgenstraShell({
    production: false,
    socialPreviewImageUrl: 'http://localhost:4103/assets/images/og-preview.png',
  }),
  billing: {
    urls: {
      restApi: 'http://localhost:3200/api',
      frontend: 'http://localhost:4103',
      websocket: 'http://localhost:3200/socket/billing',
    },
  },
};
