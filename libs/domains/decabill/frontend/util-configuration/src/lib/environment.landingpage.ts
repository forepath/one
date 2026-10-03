import { CLOUDFLARE_TURNSTILE_TEST_SITE_KEY } from '@forepath/shared/frontend/util-configuration';

import { createDecabillShell } from './shell';
import type { DecabillLandingEnvironment } from './environment.interface';

export const environment: DecabillLandingEnvironment = {
  ...createDecabillShell({
    production: false,
    socialPreviewImageUrl: 'http://localhost:4302/assets/images/og-preview.png',
    cookieConsentEnabled: true,
  }),
  landing: {
    tenantId: 'decabill',
    urls: {
      restApi: 'http://localhost:3200/api',
      portal: 'http://localhost:4500',
    },
  },
  communication: {
    urls: {
      restApi: 'http://localhost:3300/api',
    },
    turnstileSiteKey: CLOUDFLARE_TURNSTILE_TEST_SITE_KEY,
  },
};
