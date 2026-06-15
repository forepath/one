import { Environment } from './environment.interface';

export const environment: Environment = {
  production: false,
  controller: {
    restApiUrl: 'http://localhost:3100/api',
    websocketUrl: 'http://localhost:8081/clients',
  },
  billing: {
    restApiUrl: 'http://localhost:3200/api',
    frontendUrl: 'http://localhost:4500',
    websocketUrl: 'http://localhost:8082/billing',
  },
  authentication: {
    type: 'users',
    disableSignup: false,
  },
  chatModelOptions: {
    cursor: {},
    opencode: {},
  },
  editor: {
    openInNewWindow: true,
  },
  deployment: {
    openInNewWindow: true,
  },
  cookieConsent: {
    domain: '.forepath.io',
    privacyPolicyUrl: 'https://forepath.io/legal/privacy',
    termsUrl: 'https://forepath.io/legal/terms',
  },
  socialPreview: {
    imageUrl: 'http://localhost:4400/assets/images/og-preview.png',
  },
};
