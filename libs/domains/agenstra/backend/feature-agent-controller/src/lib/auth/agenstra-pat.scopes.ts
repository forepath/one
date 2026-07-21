import { IDENTITY_PAT_SCOPES } from '@forepath/identity/backend';

/**
 * Agenstra PAT capability scopes (allowlist for create + JWT).
 * Every entry must be enforced via `@RequireScopes` (or equivalent) on machine routes.
 */
export const AGENSTRA_PAT_SCOPES = [
  'clients:read',
  'clients:write',
  'tickets:read',
  'tickets:write',
  'knowledge:read',
  'knowledge:write',
  'filter_rules:write',
  'agents:read',
  'agents:write',
  'agents:lifecycle',
  'agents:files',
  'agents:environment',
  'agents:vcs',
  'agents:deployments',
  'imports:write',
  'statistics:read',
  ...IDENTITY_PAT_SCOPES,
] as const;

export type AgenstraPatScope = (typeof AGENSTRA_PAT_SCOPES)[number];
