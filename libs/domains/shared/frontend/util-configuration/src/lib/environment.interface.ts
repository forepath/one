import type {
  ApiKeyAuthenticationConfig,
  AuthenticationConfig,
  KeycloakAuthenticationConfig,
  UsersAuthenticationConfig,
} from '@forepath/identity/frontend';

import type { AuthMarketing } from './auth-marketing.interface';

// Re-export auth config types from identity for backward compatibility
export type {
  ApiKeyAuthenticationConfig,
  AuthenticationConfig,
  KeycloakAuthenticationConfig,
  UsersAuthenticationConfig,
};

export interface AuthLayoutConfig {
  /**
   * When false, hides the left marketing panel on login-like pages so the form area spans full width.
   * Defaults to true when omitted.
   */
  showMarketingPanel?: boolean;
}

/** Former top-level production + productName + appVersion. */
export interface ApplicationEnvironment {
  production: boolean;
  productName: string;
  /** Optional frontend build version (e.g. from CI `VERSION` env var). Former `appVersion`. */
  version?: string;
}

/** Former top-level authentication + authMarketing + authLayout. */
export interface AuthenticationEnvironment {
  /** Provider/method config (users | keycloak | api-key) — former top-level `authentication`. */
  config: AuthenticationConfig;
  /** Brand copy for login/register screens — former `authMarketing`. */
  marketing: AuthMarketing;
  /** Optional layout flags for public auth screens — former `authLayout`. */
  layout?: AuthLayoutConfig;
}

export interface CookieConsentUrls {
  privacyPolicy: string;
  terms: string;
}

export interface CookieConsentConfig {
  /** When false, cookie consent UI and providers are omitted (e.g. Decabill billing console). */
  enabled: boolean;
  domain: string;
  urls: CookieConsentUrls;
}

export interface SocialPreviewUrls {
  image: string;
}

export interface SocialPreviewConfig {
  urls: SocialPreviewUrls;
}

/** Only fields every product environment shares. No api / websocket / docs / communication. */
export interface BaseEnvironment {
  application: ApplicationEnvironment;
  authentication: AuthenticationEnvironment;
  cookieConsent: CookieConsentConfig;
  socialPreview: SocialPreviewConfig;
}

/** @deprecated Use {@link BaseEnvironment}. Kept as an alias during migration. */
export type Environment = BaseEnvironment;

export interface ApiUrls {
  restApi: string;
  frontend?: string;
}

export interface ApiConfig {
  urls: ApiUrls;
  tenantId?: string;
}

/** Object form of websocket config; endpoint keys are supplied by the consuming app/domain. */
export type ApiWebsocketEndpoints<E extends string = string> = {
  default: string;
} & Partial<Record<E, string>>;

/** Generic websocket union; endpoint keys are supplied by the consuming app/domain. */
export type ApiWebsocketConfig<E extends string = string> = string | ApiWebsocketEndpoints<E>;

export interface ApiUrlsWithWebsocket<E extends string = string> extends ApiUrls {
  websocket: ApiWebsocketConfig<E>;
}

export interface ApiConfigWithWebsocket<E extends string = string> {
  urls: ApiUrlsWithWebsocket<E>;
  tenantId?: string;
}

export interface CommunicationUrls {
  restApi: string;
}

export interface CommunicationConfig {
  urls: CommunicationUrls;
  turnstileSiteKey: string;
}

export interface DocsConfig {
  /** Folder name under /docs/ and docs/ repo root, e.g. "agenstra" | "decabill" */
  contentRoot: string;
}

/** Landing-page cross-link to the billing portal; REST optional (forepath landing often only needs portal). */
export interface LandingUrls {
  portal: string;
  restApi?: string;
}

export interface LandingConfig {
  urls: LandingUrls;
  tenantId?: string;
}

/** Landing page when public plan REST is required (agenstra/decabill landings). */
export interface LandingUrlsWithRestApi {
  portal: string;
  restApi: string;
}

export interface LandingConfigWithRestApi {
  urls: LandingUrlsWithRestApi;
  tenantId?: string;
}

/** Chat model picker map (agenstra agent-console). */
export interface ChatModelOptions {
  [provider: string]: Record<string, string>;
}

/** Ghost Content API (forepath landing). Shared exports the shape; only forepath composes it. */
export interface BlogUrls {
  contentApi: string;
}

export interface BlogConfig {
  urls: BlogUrls;
  contentApiKey: string;
}

export type EnvironmentWithCommunication = BaseEnvironment & {
  communication: CommunicationConfig;
};

export type EnvironmentWithDocs = BaseEnvironment & {
  docs: DocsConfig;
};

export type EnvironmentWithLanding = BaseEnvironment & {
  landing: LandingConfig;
};

export type EnvironmentWithLandingAndCommunication = EnvironmentWithLanding & {
  communication: CommunicationConfig;
};
