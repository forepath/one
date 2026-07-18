import { SetMetadata } from '@nestjs/common';

import { REQUIRE_PASSWORD_SESSION_KEY, REQUIRE_SCOPES_KEY } from '../constants/pat.constants';

/**
 * Require the listed PAT scopes when the JWT was issued via personal access token.
 * Interactive console sessions (`amr` not including `pat`) always pass.
 */
export const RequireScopes = (...scopes: string[]) => SetMetadata(REQUIRE_SCOPES_KEY, scopes);

/**
 * Restrict the route to interactive console sessions (password JWT or Keycloak OIDC).
 * Rejects machine JWTs with `amr: pat`. Used for PAT CRUD so tokens cannot mint or revoke tokens.
 *
 * Keycloak interactive tokens typically have no `amr` claim; PatScopesGuard treats that as interactive.
 */
export const RequireInteractiveSession = () => SetMetadata(REQUIRE_PASSWORD_SESSION_KEY, true);

/**
 * @deprecated Prefer {@link RequireInteractiveSession}. Same metadata key — kept for existing call sites.
 */
export const RequirePasswordSession = RequireInteractiveSession;
