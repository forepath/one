import { createAgenstraShell } from './shell';
import type { AgenstraBillingConsoleEnvironment } from './environment.interface';

export const environment: AgenstraBillingConsoleEnvironment = {
  ...createAgenstraShell({
    production: true,
    socialPreviewImageUrl: 'https://agenstra.com/assets/images/og-preview.png',
  }),
  billing: {
    urls: {
      restApi: 'http://host.docker.internal:3200/api',
      frontend: 'http://host.docker.internal:4500',
      websocket: 'http://host.docker.internal:3200/socket/billing',
    },
  },
};
