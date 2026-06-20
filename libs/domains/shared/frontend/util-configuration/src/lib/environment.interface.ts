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

export interface Environment {
  production: boolean;
  /** Product name shown in page titles, auth screens, and other branded UI. */
  productName: string;
  controller: {
    restApiUrl: string;
    websocketUrl: string;
    /** When unset, derived from `websocketUrl` by swapping the `/clients` suffix for `/tickets`. */
    ticketsWebsocketUrl?: string;
    /** When unset, derived from `websocketUrl` by swapping the `/clients` suffix for `/status`. */
    statusWebsocketUrl?: string;
  };
  billing: {
    restApiUrl: string;
    frontendUrl: string;
    websocketUrl?: string;
    /** Optional tenant id sent as `X-Tenant` on billing API requests; defaults to `default`. */
    tenantId?: string;
  };
  authentication: AuthenticationConfig;
  /** Brand-specific copy for login, registration, and related auth screens. */
  authMarketing: AuthMarketing;
  chatModelOptions: { [provider: string]: Record<string, string> };
  editor: {
    openInNewWindow: boolean;
  };
  deployment: {
    openInNewWindow: boolean;
  };
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
}
