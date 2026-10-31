import { CLOUDFLARE_TURNSTILE_TEST_SITE_KEY } from '@forepath/shared/frontend/util-configuration';

import { createLoadweaverShell } from './shell';
import type { LoadweaverLandingEnvironment } from './environment.interface';

export const environment: LoadweaverLandingEnvironment = {
  ...createLoadweaverShell({
    production: true,
    socialPreviewImageUrl: 'https://loadweaver.com/assets/images/og-preview.png',
  }),
  landing: {
    urls: {
      portal: 'http://host.docker.internal:4500',
    },
  },
  communication: {
    urls: {
      restApi: 'http://host.docker.internal:3300/api',
    },
    turnstileSiteKey: CLOUDFLARE_TURNSTILE_TEST_SITE_KEY,
  },
};
