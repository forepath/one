import { CLOUDFLARE_TURNSTILE_TEST_SITE_KEY } from '@forepath/shared/frontend/util-configuration';

import { createAgenstraShell } from './shell';
import type { AgenstraLandingEnvironment } from './environment.interface';

export const environment: AgenstraLandingEnvironment = {
  ...createAgenstraShell({
    production: true,
    socialPreviewImageUrl: 'https://agenstra.com/assets/images/og-preview.png',
  }),
  landing: {
    urls: {
      restApi: 'http://host.docker.internal:3200/api',
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
