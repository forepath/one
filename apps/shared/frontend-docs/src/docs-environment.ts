import {
  createLoadRuntimeEnvironment,
  ENVIRONMENT,
  provideLocale,
  type BaseEnvironment,
  type DocsConfig,
} from '@forepath/shared/frontend/util-configuration';

export type SharedDocsEnvironment = BaseEnvironment & { docs: DocsConfig };

export const environment: SharedDocsEnvironment = {
  application: {
    production: false,
    productName: 'Forepath',
  },
  authentication: {
    config: {
      type: 'users',
      disableSignup: false,
      disableForceLogin2fa: false,
    },
    marketing: {
      loginDescription: '',
      registerDescription: '',
      requestPasswordResetDescription: '',
      resetPasswordConfirmationDescription: '',
      resetPasswordDescription: '',
      confirmEmailDescription: '',
      features: [],
    },
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
      image: '/assets/images/og-preview.png',
    },
  },
  docs: {
    contentRoot: 'shared',
  },
};

export const loadRuntimeEnvironment = createLoadRuntimeEnvironment<SharedDocsEnvironment>(environment);

export { ENVIRONMENT, provideLocale };
