import { createLoadweaverShell } from './shell';
import type { LoadweaverBillingConsoleEnvironment } from './environment.interface';

export const environment: LoadweaverBillingConsoleEnvironment = {
  ...createLoadweaverShell({
    production: true,
    socialPreviewImageUrl: 'https://loadweaver.com/assets/images/og-preview.png',
  }),
  billing: {
    tenantId: 'loadweaver',
    urls: {
      restApi: 'http://host.docker.internal:3200/api',
      frontend: 'http://host.docker.internal:4500',
      websocket: 'http://host.docker.internal:3200/socket/billing',
    },
  },
};
