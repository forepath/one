export * from './lib/auth-marketing';
export * from './lib/environment.interface';
export * from './lib/environment';
export * from './lib/load-runtime-environment';
export * from './lib/shell';
export {
  ENVIRONMENT,
  provideLocale,
  LocaleService,
  buildPageTitle,
  CLOUDFLARE_TURNSTILE_TEST_SITE_KEY,
  resolveApiWebsocketUrl,
} from '@forepath/shared/frontend/util-configuration';
export type {
  ApiConfig,
  ApiConfigWithWebsocket,
  AuthLayoutConfig,
  BaseEnvironment,
  AuthMarketing,
  CommunicationConfig,
  LandingConfig,
} from '@forepath/shared/frontend/util-configuration';
