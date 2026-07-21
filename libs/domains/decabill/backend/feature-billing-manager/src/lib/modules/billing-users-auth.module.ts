import { UsersAuthModule } from '@forepath/identity/backend';

import { BILLING_PAT_SCOPES } from '../auth/billing-pat.scopes';

/**
 * Users-mode auth for billing-manager with Decabill PAT scope catalog.
 */
export const BillingUsersAuthModule = UsersAuthModule.register({
  patScopeCatalog: BILLING_PAT_SCOPES,
});
