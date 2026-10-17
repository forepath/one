import {
  ControlPlaneModule,
  LOADWEAVER_PAT_SCOPES,
  LoadweaverOtelModule,
} from '@forepath/loadweaver/backend/feature-control-plane';
import {
  BullBoardSkippingThrottlerGuard,
  getAuthenticationMethod,
  getHybridAuthGuards,
  getKeycloakPatAuthGuards,
  getRateLimitConfig,
  KeycloakModule,
  KeycloakService,
  KeycloakUserSyncModule,
  PatAuthModule,
  UsersAuthModule,
} from '@forepath/identity/backend';
import { getTypeOrmOptionsForQueueRole, MonitoringModule } from '@forepath/shared/backend';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeycloakConnectModule } from 'nest-keycloak-connect';

import { typeormConfig } from '../typeorm.config';

const authMethod = getAuthenticationMethod();

@Module({
  imports: [
    TypeOrmModule.forRoot(getTypeOrmOptionsForQueueRole(typeormConfig)),
    ThrottlerModule.forRoot(getRateLimitConfig()),
    ...(authMethod === 'keycloak'
      ? [
          KeycloakModule,
          KeycloakConnectModule.registerAsync({ useExisting: KeycloakService }),
          KeycloakUserSyncModule,
          PatAuthModule.register({ patScopeCatalog: LOADWEAVER_PAT_SCOPES }),
        ]
      : []),
    ...(authMethod === 'users' ? [UsersAuthModule.register({ patScopeCatalog: LOADWEAVER_PAT_SCOPES })] : []),
    ControlPlaneModule,
    LoadweaverOtelModule,
    MonitoringModule,
  ],
  providers: [
    ...(authMethod === 'keycloak' ? getKeycloakPatAuthGuards() : getHybridAuthGuards()),
    {
      provide: APP_GUARD,
      useClass: BullBoardSkippingThrottlerGuard,
    },
  ],
})
export class AppModule {}
