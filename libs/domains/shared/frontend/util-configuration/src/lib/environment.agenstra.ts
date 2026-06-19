import { agenstraAuthMarketing } from './auth-marketing.agenstra';
import { Environment } from './environment.interface';

export const environment: Environment = {
  production: false,
  productName: 'Agenstra',
  controller: {
    restApiUrl: 'http://localhost:3100/api',
    websocketUrl: 'http://localhost:8081/clients',
  },
  billing: {
    restApiUrl: 'http://localhost:3200/api',
    frontendUrl: 'http://localhost:4500',
    websocketUrl: 'http://localhost:8082/billing',
    tenantId: 'agenstra',
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
    imageUrl: 'http://localhost:4300/assets/images/og-preview.png',
  },
};
