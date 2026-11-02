import { IDENTITY_PAT_SCOPES } from '@forepath/identity/backend';

/**
 * Fleet service PAT capability scopes (allowlist for create + JWT, 3.24). Scopes only narrow: per-cluster grants
 * (viewer / operator / admin) still apply on every route.
 */
export const FLEET_PAT_SCOPES = [
  // Fleet views: cards, inbox, sites, comparison; read-only relay calls.
  'fleet:read',
  // Changing relay calls (plans, applies, node actions, ...) and the socket relay, bounded by the grants.
  'fleet:relay',
  // Cross-cluster restore / clone operations.
  'fleet:restore',
  // Cluster connections and grants (fleet admins).
  'fleet:admin',
  // Loadweaver Cloud: register a Decabill-provisioned cluster (Decabill / operators).
  'cloud:register',
  // Loadweaver Cloud: final backup + read-only grace before a teardown (Decabill's dedicated credential).
  'cloud:teardown',
  ...IDENTITY_PAT_SCOPES,
] as const;

export type FleetPatScope = (typeof FLEET_PAT_SCOPES)[number];
