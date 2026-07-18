import { IDENTITY_PAT_SCOPES } from '@forepath/identity/backend';

/**
 * Decabill PAT capability scopes (allowlist for create + JWT).
 * Every entry must be enforced via `@RequireScopes` (or equivalent) on machine routes.
 */
export const BILLING_PAT_SCOPES = [
  'catalog:write',
  'subscriptions:read',
  'subscriptions:write',
  'invoices:read',
  'invoices:write',
  'invoices:pay',
  'customer_profile:write',
  'customer_profile:admin',
  'usage:read',
  'usage:write',
  'promotions:read',
  'promotions:write',
  'projects:read',
  'projects:write',
  'tickets:read',
  'tickets:write',
  'milestones:write',
  'time_entries:write',
  'billing_admin:read',
  'billing_admin:write',
  'datev:write',
  ...IDENTITY_PAT_SCOPES,
] as const;

export type BillingPatScope = (typeof BILLING_PAT_SCOPES)[number];
