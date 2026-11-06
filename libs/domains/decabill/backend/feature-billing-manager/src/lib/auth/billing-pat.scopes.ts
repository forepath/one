import { IDENTITY_PAT_SCOPES } from '@forepath/identity/backend';

/**
 * Decabill PAT capability scopes (allowlist for create + JWT).
 * Every entry must be enforced via `@RequireScopes` (or equivalent) on machine routes.
 *
 * Pattern: `<resource>:read` | `<resource>:write` (implies read) | `<resource>:admin` (implies write, admin-only).
 */
export const BILLING_PAT_SCOPES = [
  // Orderable catalog: service plans/types, plan options, pricing preview; admin: catalog management
  'catalog:read',
  'catalog:admin',
  // Subscriptions, items, servers, containers, backorders, availability; admin: all subscriptions
  'subscriptions:read',
  'subscriptions:write',
  'subscriptions:admin',
  // Invoices; write: pay; admin: issue/void/manual invoices
  'invoices:read',
  'invoices:write',
  'invoices:admin',
  'customer_profile:read',
  'customer_profile:write',
  'customer_profile:admin',
  'supplier_profile:admin',
  'supplier_invoices:admin',
  // Usage summaries; admin: record usage, meter entries
  'usage:read',
  'usage:admin',
  // Promotions; write: redeem; admin: manage promotions
  'promotions:read',
  'promotions:write',
  'promotions:admin',
  'offers:read',
  'offers:write',
  'offers:admin',
  // Projects; admin: project management, time reports, billing time
  'projects:read',
  'projects:admin',
  // Project milestones / time entries / tickets / ticket attachments; writes (except comments) are admin-only
  'milestones:read',
  'milestones:admin',
  'time_entries:read',
  'time_entries:admin',
  'tickets:read',
  'tickets:write',
  'tickets:admin',
  'attachments:read',
  'attachments:admin',
  // Billing operations: summary, capabilities, tax preview, bill-now, statistics
  'billing:admin',
  // Stored billing documents (admin file manager)
  'files:admin',
  'datev:admin',
  // WebSockets (connect + subscribe). Events stay capped by the domain scopes above (see billing-websocket.scopes.ts).
  'websocket:billing:read',
  'websocket:projects:read',
  ...IDENTITY_PAT_SCOPES,
] as const;

export type BillingPatScope = (typeof BILLING_PAT_SCOPES)[number];
