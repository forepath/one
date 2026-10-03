import { CLOUDFLARE_TURNSTILE_TEST_SITE_KEY } from '@forepath/shared/frontend/util-configuration';

import { createDecabillShell } from './shell';
import type { DecabillLandingEnvironment } from './environment.interface';

export const environment: DecabillLandingEnvironment = {
  ...createDecabillShell({
    production: true,
    socialPreviewImageUrl: 'https://decabill.com/assets/images/og-preview.png',
    cookieConsentEnabled: true,
  }),
  landing: {
    tenantId: 'decabill',
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
