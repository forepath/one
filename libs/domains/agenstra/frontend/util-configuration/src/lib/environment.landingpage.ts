import { CLOUDFLARE_TURNSTILE_TEST_SITE_KEY } from '@forepath/shared/frontend/util-configuration';

import { createAgenstraShell } from './shell';
import type { AgenstraLandingEnvironment } from './environment.interface';

export const environment: AgenstraLandingEnvironment = {
  ...createAgenstraShell({
    production: false,
    socialPreviewImageUrl: 'http://localhost:4101/assets/images/og-preview.png',
  }),
  landing: {
    urls: {
      restApi: 'http://localhost:3200/api',
      portal: 'http://localhost:4103',
    },
  },
  communication: {
    urls: {
      restApi: 'http://localhost:3300/api',
    },
    turnstileSiteKey: CLOUDFLARE_TURNSTILE_TEST_SITE_KEY,
  },
};
