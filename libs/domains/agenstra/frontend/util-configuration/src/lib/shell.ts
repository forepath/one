import type { BaseEnvironment } from '@forepath/shared/frontend/util-configuration';

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
    },
    cookieConsent: {
      enabled: true,
      domain: '.agenstra.com',
      urls: {
        privacyPolicy: 'https://agenstra.com/legal/privacy',
        terms: 'https://agenstra.com/legal/terms',
        legalDisclosure: 'https://agenstra.com/legal/disclosure',
      },
    },
    socialPreview: {
      urls: {
        image: options.socialPreviewImageUrl,
      },
    },
  };
}
