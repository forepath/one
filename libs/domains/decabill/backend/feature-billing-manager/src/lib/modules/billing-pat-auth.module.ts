import { PatAuthModule } from '@forepath/identity/backend';

import { BILLING_PAT_SCOPES } from '../auth/billing-pat.scopes';

/**
 * PAT auth for billing-manager (users-mode and keycloak-mode) with Decabill scope catalog.
 */
export const BillingPatAuthModule = PatAuthModule.register({
  patScopeCatalog: BILLING_PAT_SCOPES,
});
