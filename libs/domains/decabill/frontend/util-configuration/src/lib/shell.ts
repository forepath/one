import type { BaseEnvironment } from '@forepath/shared/frontend/util-configuration';

import { decabillAuthMarketing } from './auth-marketing';

export function createDecabillShell(options: {
  production: boolean;
  socialPreviewImageUrl: string;
  cookieConsentEnabled?: boolean;
}): BaseEnvironment {
  return {
    application: {
      production: options.production,
      productName: 'Decabill',
    },
    authentication: {
      config: {
        type: 'users',
        disableSignup: false,
        disableForceLogin2fa: false,
      },
      marketing: decabillAuthMarketing,
    },
    cookieConsent: {
      enabled: options.cookieConsentEnabled ?? false,
      domain: '.decabill.com',
      urls: {
        privacyPolicy: 'https://decabill.com/legal/privacy',
        terms: 'https://decabill.com/legal/terms',
      },
    },
    socialPreview: {
      urls: {
        image: options.socialPreviewImageUrl,
      },
    },
  };
}
