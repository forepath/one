import type { BaseEnvironment } from '@forepath/shared/frontend/util-configuration';

import { agenstraAuthMarketing } from './auth-marketing';

export function createAgenstraShell(options: { production: boolean; socialPreviewImageUrl: string }): BaseEnvironment {
  return {
    application: {
      production: options.production,
      productName: 'Agenstra',
    },
    authentication: {
      config: {
        type: 'users',
        disableSignup: false,
        disableForceLogin2fa: false,
      },
      marketing: agenstraAuthMarketing,
    },
    cookieConsent: {
      enabled: true,
      domain: '.agenstra.com',
      urls: {
        privacyPolicy: 'https://agenstra.com/legal/privacy',
        terms: 'https://agenstra.com/legal/terms',
      },
    },
    socialPreview: {
      urls: {
        image: options.socialPreviewImageUrl,
      },
    },
  };
}
