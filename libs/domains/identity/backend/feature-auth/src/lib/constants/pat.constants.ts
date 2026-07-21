/** Injection token for the product PAT scope catalog (mirrors webhook eventCatalog). */
export const IDENTITY_PAT_SCOPE_CATALOG = 'IDENTITY_PAT_SCOPE_CATALOG';

export const PAT_TOKEN_PREFIX = 'fp_pat_';

/**
 * Prefix length for DB lookup: `fp_pat_` (7) + first 8 chars of the random base64url body.
 * Unique index on token_prefix; collisions are rejected at insert.
 */
export const PAT_LOOKUP_PREFIX_LENGTH = 15;

export const REQUIRE_SCOPES_KEY = 'identity.require_scopes';

export const REQUIRE_PASSWORD_SESSION_KEY = 'identity.require_password_session';

/**
 * Precomputed bcrypt of a fixed string for timing-safe compares when a PAT is unknown
 * or when interactive login rejects `fp_pat_` secrets (cost 12).
 */
export const DUMMY_PAT_BCRYPT_HASH = '$2b$12$lXC..FNUXmNW34wYlfnXpOnNCP2LCz0pK/WSd3QcdUXeqO17T.Ksq';

/**
 * Admin-only scopes that non-admin users cannot grant on create/update.
 * Workspace/customer scopes (clients/tickets/projects/…) stay grantable to role=user.
 */
export const ADMIN_ONLY_PAT_SCOPES = new Set([
  'users:admin',
  'webhooks:admin',
  'usage:write',
  'catalog:write',
  'promotions:write',
  'billing_admin:read',
  'billing_admin:write',
  'datev:write',
  'filter_rules:write',
  'imports:write',
  'invoices:write',
  'customer_profile:admin',
]);
