import {
  BullBoardSkippingThrottlerGuard,
  getAuthenticationMethod,
  getHybridAuthGuards,
  getRateLimitConfig,
  KeycloakModule,
  KeycloakService,
  KeycloakUserSyncModule,
  UsersAuthModule,
} from '@forepath/identity/backend';
import { MarpdownModule } from '@forepath/marpdown/backend/feature-data-manager';
import { MonitoringModule } from '@forepath/shared/backend';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeycloakConnectModule } from 'nest-keycloak-connect';

import { typeormConfig } from '../typeorm.config';

const authMethod = getAuthenticationMethod();

@Module({
  imports: [
    TypeOrmModule.forRoot(typeormConfig),
    ThrottlerModule.forRoot(getRateLimitConfig()),
    MarpdownModule,
    ...(authMethod === 'keycloak'
      ? [KeycloakModule, KeycloakConnectModule.registerAsync({ useExisting: KeycloakService }), KeycloakUserSyncModule]
      : []),
    ...(authMethod === 'users' ? [UsersAuthModule] : []),
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
