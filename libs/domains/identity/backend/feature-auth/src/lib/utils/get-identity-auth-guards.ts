import {
  getAuthenticationMethod,
  getHybridAuthGuards,
  HybridAuthGuard,
  OidcAuthGuard,
} from '@forepath/identity/backend/util-auth';
import { CanActivate } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { ExternalIdentityAuthGuard } from '../guards/external-identity-auth.guard';
import { PatBearerAuthGuard } from '../guards/pat-bearer-auth.guard';
import { PatScopesGuard } from '../guards/pat-scopes.guard';
import { UsersRolesGuard } from '../guards/users-roles.guard';

type AppGuardProvider = { provide: typeof APP_GUARD; useClass: new (...args: never[]) => CanActivate };

/**
 * APP_GUARD chain for apps with a local users table (controller, billing).
 *
 * oidc (order must stay explicit — do not also register these as APP_GUARD in feature modules):
 * 1. PatBearerAuthGuard — accept app-signed PAT / app access JWTs (`amr: pat`)
 * 2. HybridAuthGuard — health / ops / public routes
 * 3. OidcAuthGuard — verify OIDC access tokens (skipped when `patAuthenticated`)
 * 4. ExternalIdentityAuthGuard — map the OIDC identity to the local `users` row (roles, lock, tenant)
 * 5. UsersRolesGuard — `@UsersRoles`
 * 6. PatScopesGuard — fail-closed PAT scopes / interactive-session-only routes
 *
 * users / saml register their JWT guards in UsersAuthModule / SamlAuthModule; api-key uses HybridAuthGuard only.
 */
export function getIdentityAuthGuards(): AppGuardProvider[] {
  if (getAuthenticationMethod() !== 'oidc') {
    return getHybridAuthGuards() as AppGuardProvider[];
  }

  return [
    { provide: APP_GUARD, useClass: PatBearerAuthGuard },
    { provide: APP_GUARD, useClass: HybridAuthGuard },
    { provide: APP_GUARD, useClass: OidcAuthGuard },
    { provide: APP_GUARD, useClass: ExternalIdentityAuthGuard },
    { provide: APP_GUARD, useClass: UsersRolesGuard },
    { provide: APP_GUARD, useClass: PatScopesGuard },
  ];
}
