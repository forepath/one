import { ActionCenterModule, getTenantIdOrDefault, runWithTenantId } from '@forepath/shared/backend';

/** Shared action center engine for Decabill: one scope per tenant, sources run tenant-bound. */
export const billingActionCenterModule = ActionCenterModule.register({
  applicationId: 'decabill',
  resolveScopeKey: () => getTenantIdOrDefault(),
  runInScope: (scopeKey, fn) => runWithTenantId(scopeKey, fn),
});
