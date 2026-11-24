import { ActionCenterModule, INSTANCE_SCOPE_KEY } from '@forepath/shared/backend';

/** Shared action center engine for Agenstra: one instance-wide scope (no tenants). */
export const agenstraActionCenterModule = ActionCenterModule.register({
  applicationId: 'agenstra',
  resolveScopeKey: () => INSTANCE_SCOPE_KEY,
});
