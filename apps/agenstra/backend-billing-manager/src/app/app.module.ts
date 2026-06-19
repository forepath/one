import { BillingKeycloakUserSyncModule, BillingModule, BillingUsersAuthModule } from '@forepath/agenstra/backend';
import {
  BullBoardSkippingThrottlerGuard,
  getAuthenticationMethod,
  getHybridAuthGuards,
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
    ...(authMethod === 'keycloak'
      ? [
          KeycloakModule,
          KeycloakConnectModule.registerAsync({ useExisting: KeycloakService }),
          BillingKeycloakUserSyncModule,
        ]
      : []),
    ...(authMethod === 'users' ? [BillingUsersAuthModule] : []),
    MonitoringModule,
  ],
  providers: [
    ...getHybridAuthGuards(),
    {
      provide: APP_GUARD,
      useClass: BullBoardSkippingThrottlerGuard,
    },
  ],
})
export class AppModule {}
