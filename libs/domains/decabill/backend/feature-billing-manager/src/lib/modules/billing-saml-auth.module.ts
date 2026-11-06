import { SamlAuthModule } from '@forepath/identity/backend';

import { BILLING_PAT_SCOPES } from '../auth/billing-pat.scopes';

/**
 * SAML-mode auth for billing-manager with Decabill PAT scope catalog.
 * Registered lazily by the app module (only when AUTHENTICATION_METHOD=saml) because it validates SAML settings.
 */
export function createBillingSamlAuthModule() {
  return SamlAuthModule.register({ patScopeCatalog: BILLING_PAT_SCOPES });
}
