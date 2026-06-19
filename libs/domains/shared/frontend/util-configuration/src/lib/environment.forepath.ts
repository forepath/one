import { forepathAuthMarketing } from './auth-marketing.forepath';
import { Environment } from './environment.interface';

export const environment: Environment = {
  production: false,
  productName: 'ForePath',
  controller: {
    restApiUrl: 'http://localhost:3100/api',
    websocketUrl: 'http://localhost:8081/clients',
  },
  billing: {
    restApiUrl: 'http://localhost:3200/api',
    frontendUrl: 'http://localhost:4500',
    websocketUrl: 'http://localhost:8082/billing',
    tenantId: 'forepath',
  },
  authentication: {
    type: 'users',
    disableSignup: false,
  },
  authMarketing: forepathAuthMarketing,
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
    enabled: true,
    domain: '.forepath.io',
    privacyPolicyUrl: 'https://forepath.io/legal/privacy',
    termsUrl: 'https://forepath.io/legal/terms',
  },
  socialPreview: {
    imageUrl: 'http://localhost:4400/assets/images/og-preview.png',
  },
};
