export * from './lib/auth-marketing';
export * from './lib/environment.interface';
export * from './lib/environment';
export * from './lib/load-runtime-environment';
export {
  ENVIRONMENT,
  provideLocale,
  LocaleService,
  buildPageTitle,
  resolveApiWebsocketUrl,
  CLOUDFLARE_TURNSTILE_TEST_SITE_KEY,
} from '@forepath/shared/frontend/util-configuration';
export type {
  BaseEnvironment,
  AuthMarketing,
  AuthLayoutConfig,
  ApiConfig,
  ApiConfigWithWebsocket,
  CommunicationConfig,
  DocsConfig,
  LandingConfig,
  LandingConfigWithRestApi,
} from '@forepath/shared/frontend/util-configuration';
