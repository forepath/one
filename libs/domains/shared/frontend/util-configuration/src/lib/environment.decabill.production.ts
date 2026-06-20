import { Environment } from './environment.interface';
import { decabillAuthMarketing } from './auth-marketing.decabill';

export const environment: Environment = {
  production: true,
  productName: 'Decabill',
  controller: {
    restApiUrl: 'http://host.docker.internal:3100/api',
    websocketUrl: 'http://host.docker.internal:8081/clients',
  },
  billing: {
    restApiUrl: 'http://host.docker.internal:3200/api',
    frontendUrl: 'http://host.docker.internal:4500',
    websocketUrl: 'http://host.docker.internal:8082/billing',
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
    imageUrl: 'https://decabill.com/assets/images/og-preview.png',
  },
  docs: {
    contentRoot: 'decabill',
  },
};
