import {
  ClientsModule,
  IdentityEmailBridgeModule,
  IdentityNotificationBridgeModule,
  IdentityStatisticsBridgeModule,
  AGENSTRA_PAT_SCOPES,
} from '@forepath/agenstra/backend/feature-agent-controller';
import { MonitoringModule } from '@forepath/shared/backend';
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
import { getTypeOrmOptionsForQueueRole } from '@forepath/shared/backend';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeycloakConnectModule } from 'nest-keycloak-connect';

import { ControllerQueueModule } from '../queue/controller-queue.module';
import { typeormConfig } from '../typeorm.config';

const authMethod = getAuthenticationMethod();

@Module({
  imports: [
    TypeOrmModule.forRoot(getTypeOrmOptionsForQueueRole(typeormConfig)),
    ControllerQueueModule,
    ThrottlerModule.forRoot(getRateLimitConfig()),
    ...(authMethod === 'keycloak'
      ? [
          KeycloakModule,
          KeycloakConnectModule.registerAsync({ useExisting: KeycloakService }),
          KeycloakUserSyncModule,
          PatAuthModule.register({ patScopeCatalog: AGENSTRA_PAT_SCOPES }),
        ]
      : []),
    ...(authMethod === 'users' ? [UsersAuthModule.register({ patScopeCatalog: AGENSTRA_PAT_SCOPES })] : []),
    ClientsModule,
    IdentityStatisticsBridgeModule,
    IdentityNotificationBridgeModule,
    IdentityEmailBridgeModule,
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
