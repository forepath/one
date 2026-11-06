import { OidcAuthModule } from '@forepath/identity/backend';

import { BILLING_PAT_SCOPES } from '../auth/billing-pat.scopes';

/**
 * OIDC-mode auth for billing-manager with Decabill PAT scope catalog (includes the PAT stack).
 * Registered lazily by the app module (only when AUTHENTICATION_METHOD=oidc) because it resolves JWT_SECRET.
 */
export function createBillingOidcAuthModule() {
  return OidcAuthModule.register({ patScopeCatalog: BILLING_PAT_SCOPES });
}
