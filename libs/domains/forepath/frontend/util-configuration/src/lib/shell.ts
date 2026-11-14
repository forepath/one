import type { BaseEnvironment } from '@forepath/shared/frontend/util-configuration';

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
    },
    cookieConsent: {
      enabled: true,
      domain: '.forepath.io',
      urls: {
        privacyPolicy: 'https://forepath.io/legal/privacy',
        terms: 'https://forepath.io/legal/terms',
        legalDisclosure: 'https://forepath.io/legal/disclosure',
      },
    },
    socialPreview: {
      urls: {
        image: options.socialPreviewImageUrl,
      },
    },
  };
}
