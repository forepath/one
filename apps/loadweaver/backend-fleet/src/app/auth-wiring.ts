import { FLEET_PAT_SCOPES } from '@forepath/loadweaver/backend/feature-fleet';
import {
  getHybridAuthGuards,
  getKeycloakPatAuthGuards,
  KeycloakModule,
  KeycloakService,
  KeycloakUserSyncModule,
  PatAuthModule,
  UsersAuthModule,
} from '@forepath/identity/backend';
import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { KeycloakConnectModule } from 'nest-keycloak-connect';

/**
 * Authentication wiring of the fleet service, per `AUTHENTICATION_METHOD` (kept apart from `AppModule` so a unit
 * test can compile it for every mode without a database). Users sign in once here (3.24).
 */
export function fleetAuthImports(authMethod: string): Array<Type<unknown> | DynamicModule> {
  if (authMethod === 'keycloak') {
    return [
      KeycloakModule,
      KeycloakConnectModule.registerAsync({ useExisting: KeycloakService }),
      KeycloakUserSyncModule,
      PatAuthModule.register({ patScopeCatalog: FLEET_PAT_SCOPES }),
    ];
  }

  if (authMethod === 'users') {
    return [UsersAuthModule.register({ patScopeCatalog: FLEET_PAT_SCOPES })];
  }

  return [];
}

/** Global guard chain (APP_GUARD order matters; see `getKeycloakPatAuthGuards`). */
export function fleetAuthGuards(authMethod: string): Provider[] {
  return authMethod === 'keycloak' ? getKeycloakPatAuthGuards() : getHybridAuthGuards();
}
