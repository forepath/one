import { FleetModule } from '@forepath/loadweaver/backend/feature-fleet';
import {
  BullBoardSkippingThrottlerGuard,
  getAuthenticationMethod,
  getRateLimitConfig,
} from '@forepath/identity/backend';
import { getTypeOrmOptionsForQueueRole, MonitoringModule } from '@forepath/shared/backend';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FleetQueueModule } from '../queue/fleet-queue.module';
import { typeormConfig } from '../typeorm.config';

import { fleetAuthGuards, fleetAuthImports } from './auth-wiring';

const authMethod = getAuthenticationMethod();

@Module({
  imports: [
    TypeOrmModule.forRoot(getTypeOrmOptionsForQueueRole(typeormConfig)),
    ThrottlerModule.forRoot(getRateLimitConfig()),
    ...fleetAuthImports(authMethod),
    FleetModule,
    FleetQueueModule,
    MonitoringModule,
  ],
  providers: [
    ...fleetAuthGuards(authMethod),
    {
      provide: APP_GUARD,
      useClass: BullBoardSkippingThrottlerGuard,
    },
  ],
})
export class AppModule {}
