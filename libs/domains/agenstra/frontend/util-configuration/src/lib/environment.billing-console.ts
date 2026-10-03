import { createAgenstraShell } from './shell';
import type { AgenstraBillingConsoleEnvironment } from './environment.interface';

export const environment: AgenstraBillingConsoleEnvironment = {
  ...createAgenstraShell({
    production: false,
    socialPreviewImageUrl: 'http://localhost:4300/assets/images/og-preview.png',
  }),
  billing: {
    urls: {
      restApi: 'http://localhost:3200/api',
      frontend: 'http://localhost:4500',
      websocket: 'http://localhost:3200/socket/billing',
    },
  },
};
