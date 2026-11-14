import type { ForepathBillingConsoleEnvironment } from './environment.interface';
import { createForepathShell } from './shell';

export const environment: ForepathBillingConsoleEnvironment = {
  ...createForepathShell({
    production: false,
    socialPreviewImageUrl: 'http://localhost:4301/assets/images/og-preview.png',
  }),
  billing: {
    tenantId: 'forepath',
    urls: {
      restApi: 'http://localhost:3200/api',
      frontend: 'http://localhost:4301',
      websocket: 'http://localhost:3200/socket/billing',
    },
  },
};
