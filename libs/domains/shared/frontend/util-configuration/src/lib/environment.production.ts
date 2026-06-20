import { Environment } from './environment.interface';
import { agenstraAuthMarketing } from './auth-marketing.agenstra';

export const environment: Environment = {
  production: true,
  productName: 'Agenstra',
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
    /*
    type: 'api-key',
    */
    type: 'users',
    disableSignup: false,
    /*
    type: 'keycloak',
    authServerUrl: 'http://host.docker.internal:8380',
    realm: 'agenstra',
    clientId: 'agent-frontend',
    */
  },
  authMarketing: agenstraAuthMarketing,
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
    domain: '.agenstra.com',
    privacyPolicyUrl: 'https://agenstra.com/legal/privacy',
    termsUrl: 'https://agenstra.com/legal/terms',
  },
  socialPreview: {
    imageUrl: 'https://agenstra.com/assets/images/og-preview.png',
  },
  docs: {
    contentRoot: 'agenstra',
  },
};
