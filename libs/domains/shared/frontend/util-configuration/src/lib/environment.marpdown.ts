import { marpdownAuthMarketing } from './auth-marketing.marpdown';
import { Environment } from './environment.interface';

export const environment: Environment = {
  production: false,
  productName: 'Marpdown',
  controller: {
    restApiUrl: 'http://localhost:3100/api',
    websocketUrl: 'http://localhost:8081/clients',
  },
  billing: {
    restApiUrl: 'http://localhost:3200/api',
    frontendUrl: 'http://localhost:4500',
  },
  marpdown: {
    restApiUrl: 'http://localhost:3400/api',
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
    domain: '.marpdown.local',
    privacyPolicyUrl: 'https://marpdown.local/legal/privacy',
    termsUrl: 'https://marpdown.local/legal/terms',
  },
  socialPreview: {
    imageUrl: 'http://localhost:4600/assets/images/og-preview.png',
  },
  docs: {
    contentRoot: 'marpdown',
  },
  communication: {
    restApiUrl: 'http://localhost:3300/api',
    turnstileSiteKey: '1x00000000000000000000AA',
  },
};
