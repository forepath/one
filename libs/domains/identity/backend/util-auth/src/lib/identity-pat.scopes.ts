/**
 * Shared PAT scopes for identity surfaces used by all products.
 * Product catalogs union these in (same idea as IDENTITY_EMAIL_EVENTS).
 */
export const IDENTITY_PAT_SCOPES = ['users:admin', 'webhooks:admin'] as const;

export type IdentityPatScope = (typeof IDENTITY_PAT_SCOPES)[number];
