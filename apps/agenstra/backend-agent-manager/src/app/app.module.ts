import { AgentsModule } from '@forepath/agenstra/backend';
import { MonitoringModule } from '@forepath/shared/backend';
import { getHybridAuthGuards, getRateLimitConfig, KeycloakModule, KeycloakService } from '@forepath/identity/backend';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeycloakConnectModule } from 'nest-keycloak-connect';

import { typeormConfig } from '../typeorm.config';

@Module({
  imports: [
    TypeOrmModule.forRoot(typeormConfig),
    ThrottlerModule.forRoot(getRateLimitConfig()),
    KeycloakModule,
    KeycloakConnectModule.registerAsync({ useExisting: KeycloakService }),
    AgentsModule,
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
