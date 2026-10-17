import { IDENTITY_PAT_SCOPES } from '@forepath/identity/backend';

/**
 * Loadweaver PAT capability scopes (allowlist for create + JWT, 3.17).
 * Every entry must be enforced via `@RequireScopes` (or equivalent) on machine routes.
 * A token can never exceed the roles of its owner: scopes only narrow, roles still apply.
 */
export const LOADWEAVER_PAT_SCOPES = [
  'cluster:read',
  'cluster:nodes',
  'cluster:admin',
  'projects:read',
  'resources:read',
  'plans:create',
  'plans:apply',
  'logs:read',
  'secrets:read',
  'secrets:write',
  'audit:read',
  'registry:pull',
  'registry:push',
  'certificates:write',
  'vpn:read',
  'vpn:write',
  ...IDENTITY_PAT_SCOPES,
] as const;

export type LoadweaverPatScope = (typeof LOADWEAVER_PAT_SCOPES)[number];
