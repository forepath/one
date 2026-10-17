import type { BaseEnvironment } from '@forepath/shared/frontend/util-configuration';

import { loadweaverAuthMarketing } from './auth-marketing';

export function createLoadweaverShell(options: {
  production: boolean;
  socialPreviewImageUrl: string;
}): BaseEnvironment {
  return {
    application: {
      production: options.production,
      productName: 'Loadweaver',
    },
    authentication: {
      config: {
        type: 'users',
        disableSignup: false,
        disableForceLogin2fa: false,
      },
      marketing: loadweaverAuthMarketing,
    },
    cookieConsent: {
      enabled: true,
      domain: '.loadweaver.com',
      urls: {
        privacyPolicy: 'https://loadweaver.com/legal/privacy',
        terms: 'https://loadweaver.com/legal/terms',
      },
    },
    socialPreview: {
      urls: {
        image: options.socialPreviewImageUrl,
      },
    },
  };
}
