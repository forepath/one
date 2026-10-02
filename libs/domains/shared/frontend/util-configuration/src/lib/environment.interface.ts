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

export interface Environment {
  production: boolean;
  /** Product name shown in page titles, auth screens, and other branded UI. */
  productName: string;
  /** Optional frontend build version (e.g. from CI `VERSION` env var). */
  appVersion?: string;
  controller: {
    restApiUrl: string;
    websocketUrl: string;
    /** When unset, derived from `websocketUrl` by swapping the `/socket/clients` suffix for `/socket/tickets`. */
    ticketsWebsocketUrl?: string;
    /** When unset, derived from `websocketUrl` by swapping the `/socket/clients` suffix for `/socket/status`. */
    statusWebsocketUrl?: string;
    /** When unset, derived from `websocketUrl` by swapping the `/socket/clients` suffix for `/socket/vnc`. */
    vncWebsocketUrl?: string;
  };
  billing: {
    restApiUrl: string;
    frontendUrl: string;
    websocketUrl?: string;
    /** When unset, derived from `websocketUrl` host with `/socket/projects` namespace. */
    projectsWebsocketUrl?: string;
    /** Optional tenant id sent as `X-Tenant` on billing API requests; defaults to `default`. */
    tenantId?: string;
  };
  authentication: AuthenticationConfig;
  /** Brand-specific copy for login, registration, and related auth screens. */
  authMarketing: AuthMarketing;
  /** Layout options for login, registration, and related public auth screens. */
  authLayout?: AuthLayoutConfig;
  chatModelOptions: { [provider: string]: Record<string, string> };
  cookieConsent: {
    /** When false, cookie consent UI and providers are omitted (e.g. Decabill billing console). */
    enabled: boolean;
    domain: string;
    privacyPolicyUrl: string;
    termsUrl: string;
  };
  socialPreview: {
    imageUrl: string;
  };
  docs: {
    /** Folder name under /docs/ and docs/ repo root, e.g. "agenstra" | "decabill" */
    contentRoot: string;
  };
  /** Public contact form API (Forepath Communication service) and Cloudflare Turnstile site key. */
  communication: {
    restApiUrl: string;
    turnstileSiteKey: string;
  };
  /**
   * Ghost Content API (public, read-only). When set, enables the marketing blog pages.
   * Content API keys are designed for browser use.
   */
  blog?: {
    /** Ghost site origin, e.g. https://blog.forepath.io */
    contentApiUrl: string;
    /** Ghost Content API key */
    contentApiKey: string;
  };
}
