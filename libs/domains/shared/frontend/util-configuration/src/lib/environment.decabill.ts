import { decabillAuthMarketing } from './auth-marketing.decabill';
import { CLOUDFLARE_TURNSTILE_TEST_SITE_KEY } from './communication.constants';
import { Environment } from './environment.interface';

export const environment: Environment = {
  production: false,
  productName: 'Decabill',
  controller: {
    restApiUrl: 'http://localhost:3100/api',
    websocketUrl: 'http://localhost:3100/socket/clients',
  },
  billing: {
    restApiUrl: 'http://localhost:3200/api',
    frontendUrl: 'http://localhost:4500',
    websocketUrl: 'http://localhost:3200/socket/billing',
    tenantId: 'decabill',
  },
  authentication: {
    type: 'users',
    disableSignup: false,
    disableForceLogin2fa: false,
  },
  authMarketing: decabillAuthMarketing,
  chatModelOptions: {
    cursor: {},
    opencode: {},
  },
  cookieConsent: {
    enabled: false,
    domain: '.decabill.com',
    privacyPolicyUrl: 'https://decabill.com/legal/privacy',
    termsUrl: 'https://decabill.com/legal/terms',
  },
  socialPreview: {
    imageUrl: 'http://localhost:4302/assets/images/og-preview.png',
  },
  docs: {
    contentRoot: 'decabill',
  },
  communication: {
    restApiUrl: 'http://localhost:3300/api',
    turnstileSiteKey: CLOUDFLARE_TURNSTILE_TEST_SITE_KEY,
  },
};
