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
  'plans:approve',
  'projects:admin',
  'logs:read',
  'metrics:read',
  'alerts:read',
  'alerts:write',
  'live:access',
  // Machine exec in a project's replicas (socket/exec only, operators / admins; Agenstra's agent manager).
  'live:exec',
  'secrets:read',
  'secrets:write',
  'audit:read',
  'registry:pull',
  'registry:push',
  'certificates:write',
  'vpn:read',
  'vpn:write',
  // Git connections (3.29): create / change, sync, export, webhook secret.
  'git:admin',
  // The caller's own Git account links (plan bot, 3.30).
  'git:accounts',
  ...IDENTITY_PAT_SCOPES,
] as const;

export type LoadweaverPatScope = (typeof LOADWEAVER_PAT_SCOPES)[number];
