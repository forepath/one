import { CLOUDFLARE_TURNSTILE_TEST_SITE_KEY } from '@forepath/shared/frontend/util-configuration';

import { createLoadweaverShell } from './shell';
import type { LoadweaverLandingEnvironment } from './environment.interface';

export const environment: LoadweaverLandingEnvironment = {
  ...createLoadweaverShell({
    production: false,
    socialPreviewImageUrl: 'http://localhost:4600/assets/images/og-preview.png',
  }),
  landing: {
    urls: {
      portal: 'http://localhost:4601',
    },
  },
  communication: {
    urls: {
      restApi: 'http://localhost:3300/api',
    },
    turnstileSiteKey: CLOUDFLARE_TURNSTILE_TEST_SITE_KEY,
  },
};
