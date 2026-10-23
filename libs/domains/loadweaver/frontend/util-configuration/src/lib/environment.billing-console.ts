import { createLoadweaverShell } from './shell';
import type { LoadweaverBillingConsoleEnvironment } from './environment.interface';

export const environment: LoadweaverBillingConsoleEnvironment = {
  ...createLoadweaverShell({
    production: false,
    socialPreviewImageUrl: 'http://localhost:4600/assets/images/og-preview.png',
  }),
  billing: {
    tenantId: 'loadweaver',
    urls: {
      restApi: 'http://localhost:3200/api',
      frontend: 'http://localhost:4601',
      websocket: 'http://localhost:3200/socket/billing',
    },
  },
};
