import type { BaseEnvironment } from '@forepath/shared/frontend/util-configuration';

import { forepathAuthMarketing } from './auth-marketing';

export function createForepathShell(options: { production: boolean; socialPreviewImageUrl: string }): BaseEnvironment {
  return {
    application: {
      production: options.production,
      productName: 'ForePath',
    },
    authentication: {
      config: {
        type: 'users',
        disableSignup: false,
        disableForceLogin2fa: false,
      },
      marketing: forepathAuthMarketing,
    },
    cookieConsent: {
      enabled: true,
      domain: '.forepath.io',
      urls: {
        privacyPolicy: 'https://forepath.io/legal/privacy',
        terms: 'https://forepath.io/legal/terms',
      },
    },
    socialPreview: {
      urls: {
        image: options.socialPreviewImageUrl,
      },
    },
  };
}
