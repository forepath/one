import { getAuthenticationMethod, getHybridAuthGuards } from '@forepath/identity/backend/util-auth';
import { CanActivate } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { KeycloakAuthGuard } from '../guards/keycloak-auth.guard';
import { KeycloakRolesGuard } from '../guards/keycloak-roles.guard';
import { PatBearerAuthGuard } from '../guards/pat-bearer-auth.guard';
import { PatScopesGuard } from '../guards/pat-scopes.guard';
import { UsersRolesGuard } from '../guards/users-roles.guard';

type AppGuardProvider = { provide: typeof APP_GUARD; useClass: new (...args: unknown[]) => CanActivate };

/**
 * Single APP_GUARD chain for Keycloak + PAT hybrid.
 *
 * Order (must stay explicit — do not also register these as APP_GUARD in feature modules):
 * 1. PatBearerAuthGuard — accept app-signed `amr: pat` JWTs
 * 2. Hybrid + nest-keycloak Auth/Resource/Role (skip when `patAuthenticated`)
 * 3. KeycloakAuthGuard — sync OIDC user → local `users` row
 * 4. KeycloakRolesGuard — `@KeycloakRoles` for interactive OIDC
 * 5. UsersRolesGuard — `@UsersRoles` for PAT JWTs (and users-mode)
 * 6. PatScopesGuard — fail-closed scopes / interactive-session-only routes
 */
export function getKeycloakPatAuthGuards(): AppGuardProvider[] {
  if (getAuthenticationMethod() !== 'keycloak') {
    return getHybridAuthGuards() as AppGuardProvider[];
  }

  return [
    { provide: APP_GUARD, useClass: PatBearerAuthGuard },
    ...(getHybridAuthGuards() as AppGuardProvider[]),
    { provide: APP_GUARD, useClass: KeycloakAuthGuard },
    { provide: APP_GUARD, useClass: KeycloakRolesGuard },
    { provide: APP_GUARD, useClass: UsersRolesGuard },
    { provide: APP_GUARD, useClass: PatScopesGuard },
  ];
}
