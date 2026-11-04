/**
 * Shared PAT scopes for identity surfaces used by all products.
 * Product catalogs union these in (same idea as IDENTITY_EMAIL_EVENTS).
 */
export const IDENTITY_PAT_SCOPES = ['users:admin', 'webhooks:admin', 'updates:admin'] as const;

export type IdentityPatScope = (typeof IDENTITY_PAT_SCOPES)[number];

/**
 * PAT scope access levels, lowest → highest. Scopes follow `<resource>:<level>`:
 *
 * - `read`  — read operations in non-admin scope
 * - `write` — all other non-admin operations (implies `read`)
 * - `admin` — operations reserved to admins and their UI / API (implies `write` and `read`)
 */
export const PAT_SCOPE_LEVELS = ['read', 'write', 'admin'] as const;

export type PatScopeLevel = (typeof PAT_SCOPE_LEVELS)[number];

const PAT_SCOPE_PATTERN = /^([a-z][a-z0-9_]*):(read|write|admin)$/;

/** Split `<resource>:<level>`; `undefined` when the scope does not follow the pattern. */
export function parsePatScope(scope: string): { resource: string; level: PatScopeLevel } | undefined {
  const match = PAT_SCOPE_PATTERN.exec(scope);

  if (!match) {
    return undefined;
  }

  return { resource: match[1], level: match[2] as PatScopeLevel };
}

/** `<resource>:admin` scopes are only grantable to (and only effective for) admin users. */
export function isAdminPatScope(scope: string): boolean {
  return parsePatScope(scope)?.level === 'admin';
}

/**
 * Whether a granted scope set satisfies one required scope.
 * A higher level on the same resource satisfies a lower one (`admin` ⊇ `write` ⊇ `read`).
 * Scopes that do not follow the pattern only match exactly (fail-closed).
 */
export function patScopeSatisfied(grantedScopes: Iterable<string>, requiredScope: string): boolean {
  const granted = grantedScopes instanceof Set ? (grantedScopes as Set<string>) : new Set(grantedScopes);

  if (granted.has(requiredScope)) {
    return true;
  }

  const required = parsePatScope(requiredScope);

  if (!required) {
    return false;
  }

  const requiredRank = PAT_SCOPE_LEVELS.indexOf(required.level);

  return PAT_SCOPE_LEVELS.slice(requiredRank + 1).some((level) => granted.has(`${required.resource}:${level}`));
}

/** Required scopes not satisfied by the granted set (all required scopes must be satisfied). */
export function getMissingPatScopes(grantedScopes: Iterable<string>, requiredScopes: readonly string[]): string[] {
  const granted = new Set(grantedScopes);

  return requiredScopes.filter((scope) => !patScopeSatisfied(granted, scope));
}
