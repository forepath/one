import { Environment } from './environment.interface';
import { decabillAuthMarketing } from './auth-marketing.decabill';

export const environment: Environment = {
  production: false,
  productName: 'Decabill',
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
  authMarketing: decabillAuthMarketing,
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
    enabled: false,
    domain: '.decabill.com',
    privacyPolicyUrl: 'https://decabill.com/legal/privacy',
    termsUrl: 'https://decabill.com/legal/terms',
  },
  socialPreview: {
    imageUrl: 'http://localhost:4500/assets/images/og-preview.png',
  },
};
