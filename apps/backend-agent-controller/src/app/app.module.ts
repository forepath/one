import { ClientsModule, IdentityStatisticsBridgeModule, MonitoringModule } from '@forepath/framework/backend';
import {
  getAuthenticationMethod,
  getHybridAuthGuards,
  getRateLimitConfig,
  KeycloakModule,
  KeycloakService,
  KeycloakUserSyncModule,
  UsersAuthModule,
} from '@forepath/identity/backend';
import { getTypeOrmOptionsForQueueRole } from '@forepath/shared/backend';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
      ? [KeycloakModule, KeycloakConnectModule.registerAsync({ useExisting: KeycloakService }), KeycloakUserSyncModule]
      : []),
    ...(authMethod === 'users' ? [UsersAuthModule] : []),
    ClientsModule,
    IdentityStatisticsBridgeModule,
    MonitoringModule,
  ],
  // Use hybrid guards (checks STATIC_API_KEY to determine authentication method)
  providers: [
    ...getHybridAuthGuards(),
    // Apply rate limiting globally to all routes
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
