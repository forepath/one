import { Environment } from './environment.interface';
import { forepathAuthMarketing } from './auth-marketing.forepath';
import { CLOUDFLARE_TURNSTILE_TEST_SITE_KEY } from './communication.constants';

export const environment: Environment = {
  production: true,
  productName: 'ForePath',
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
    imageUrl: 'https://forepath.io/assets/images/og-preview.png',
  },
  docs: {
    contentRoot: 'forepath',
  },
  communication: {
    restApiUrl: 'http://host.docker.internal:3300/api',
    turnstileSiteKey: CLOUDFLARE_TURNSTILE_TEST_SITE_KEY,
  },
};
