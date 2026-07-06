import { Environment } from './environment.interface';
import { marpdownAuthMarketing } from './auth-marketing.marpdown';

export const environment: Environment = {
  production: true,
  productName: 'Marpdown',
  controller: {
    restApiUrl: 'https://api.agenstra.com/api',
    websocketUrl: 'wss://api.agenstra.com/clients',
  },
  billing: {
    restApiUrl: 'https://api.decabill.com/api',
    frontendUrl: 'https://app.decabill.com',
  },
  marpdown: {
    restApiUrl: 'https://api.marpdown.com/api',
  },
  authentication: {
    type: 'users',
    disableSignup: false,
  },
  authMarketing: marpdownAuthMarketing,
  chatModelOptions: {
    cursor: {},
    opencode: {},
  },
  editor: {
    openInNewWindow: false,
  },
  deployment: {
    openInNewWindow: false,
  },
  cookieConsent: {
    enabled: true,
    domain: '.marpdown.com',
    privacyPolicyUrl: 'https://marpdown.com/legal/privacy',
    termsUrl: 'https://marpdown.com/legal/terms',
  },
  socialPreview: {
    imageUrl: 'https://marpdown.com/assets/images/og-preview.png',
  },
  docs: {
    contentRoot: 'marpdown',
  },
  communication: {
    restApiUrl: 'https://api.forepath.com/api',
    turnstileSiteKey: '1x00000000000000000000AA',
  },
};
