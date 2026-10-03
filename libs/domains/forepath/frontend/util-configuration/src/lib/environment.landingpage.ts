import { CLOUDFLARE_TURNSTILE_TEST_SITE_KEY } from '@forepath/shared/frontend/util-configuration';

import { createForepathShell } from './shell';
import type { ForepathLandingEnvironment } from './environment.interface';

export const environment: ForepathLandingEnvironment = {
  ...createForepathShell({
    production: false,
    socialPreviewImageUrl: 'http://localhost:4400/assets/images/og-preview.png',
  }),
  landing: {
    tenantId: 'forepath',
    urls: {
      portal: 'http://localhost:4500',
      restApi: 'http://localhost:3200/api',
    },
  },
  communication: {
    urls: {
      restApi: 'http://localhost:3300/api',
    },
    turnstileSiteKey: CLOUDFLARE_TURNSTILE_TEST_SITE_KEY,
  },
  blog: {
    urls: {
      contentApi: 'https://blog.forepath.io',
    },
    contentApiKey: '851c4d770ec5fbc780ba2fc925',
  },
};
