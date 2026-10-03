import { createForepathShell } from './shell';
import type { ForepathBillingConsoleEnvironment } from './environment.interface';

export const environment: ForepathBillingConsoleEnvironment = {
  ...createForepathShell({
    production: true,
    socialPreviewImageUrl: 'https://forepath.io/assets/images/og-preview.png',
  }),
  billing: {
    tenantId: 'forepath',
    urls: {
      restApi: 'http://host.docker.internal:3200/api',
      frontend: 'http://host.docker.internal:4500',
      websocket: 'http://host.docker.internal:3200/socket/billing',
    },
  },
};
