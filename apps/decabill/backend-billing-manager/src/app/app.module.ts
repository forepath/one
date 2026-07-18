import {
  BillingIdentityNotificationBridgeModule,
  BillingKeycloakUserSyncModule,
  BillingModule,
  BillingPatAuthModule,
  BillingUsersAuthModule,
} from '@forepath/decabill/backend';
import {
  BullBoardSkippingThrottlerGuard,
  getAuthenticationMethod,
  getHybridAuthGuards,
  getKeycloakPatAuthGuards,
  getRateLimitConfig,
  KeycloakModule,
  KeycloakService,
} from '@forepath/identity/backend';
import { getTypeOrmOptionsForQueueRole, MonitoringModule } from '@forepath/shared/backend';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeycloakConnectModule } from 'nest-keycloak-connect';

import { BillingQueueModule } from '../queue/billing-queue.module';
import { typeormConfig } from '../typeorm.config';

const authMethod = getAuthenticationMethod();

@Module({
  imports: [
    TypeOrmModule.forRoot(getTypeOrmOptionsForQueueRole(typeormConfig)),
    BillingQueueModule,
    ThrottlerModule.forRoot(getRateLimitConfig()),
    BillingModule,
    BillingIdentityNotificationBridgeModule,
    ...(authMethod === 'keycloak'
      ? [
          KeycloakModule,
          KeycloakConnectModule.registerAsync({ useExisting: KeycloakService }),
          BillingKeycloakUserSyncModule,
          BillingPatAuthModule,
        ]
      : []),
    ...(authMethod === 'users' ? [BillingUsersAuthModule] : []),
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
