import { LOADWEAVER_PAT_SCOPES } from '@forepath/loadweaver/backend/feature-control-plane';
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
 * Authentication wiring of the control plane, per `AUTHENTICATION_METHOD` (kept apart from
 * `AppModule` so a unit test can compile it for every mode without a database).
 */
export function controlPlaneAuthImports(authMethod: string): Array<Type<unknown> | DynamicModule> {
  if (authMethod === 'keycloak') {
    return [
      KeycloakModule,
      KeycloakConnectModule.registerAsync({ useExisting: KeycloakService }),
      KeycloakUserSyncModule,
      PatAuthModule.register({ patScopeCatalog: LOADWEAVER_PAT_SCOPES }),
    ];
  }

  if (authMethod === 'users') {
    return [UsersAuthModule.register({ patScopeCatalog: LOADWEAVER_PAT_SCOPES })];
  }

  return [];
}

/** Global guard chain (APP_GUARD order matters; see `getKeycloakPatAuthGuards`). */
export function controlPlaneAuthGuards(authMethod: string): Provider[] {
  return authMethod === 'keycloak' ? getKeycloakPatAuthGuards() : getHybridAuthGuards();
}
