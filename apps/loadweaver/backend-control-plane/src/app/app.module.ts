import {
  ControlPlaneModule,
  LoadweaverIdentityEmailBridgeModule,
  LoadweaverIdentityLifecycleBridgeModule,
  LoadweaverOtelModule,
} from '@forepath/loadweaver/backend/feature-control-plane';
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

import { ControlPlaneQueueModule } from '../queue/control-plane-queue.module';
import { typeormConfig } from '../typeorm.config';

import { controlPlaneAuthGuards, controlPlaneAuthImports } from './auth-wiring';

const authMethod = getAuthenticationMethod();

@Module({
  imports: [
    TypeOrmModule.forRoot(getTypeOrmOptionsForQueueRole(typeormConfig)),
    ThrottlerModule.forRoot(getRateLimitConfig()),
    ...controlPlaneAuthImports(authMethod),
    ControlPlaneModule,
    LoadweaverIdentityEmailBridgeModule,
    // Claiming the cluster (first account) makes the claimer a cluster admin (2026-10-27).
    LoadweaverIdentityLifecycleBridgeModule,
    ControlPlaneQueueModule,
    LoadweaverOtelModule,
    MonitoringModule,
  ],
  providers: [
    ...controlPlaneAuthGuards(authMethod),
    {
      provide: APP_GUARD,
      useClass: BullBoardSkippingThrottlerGuard,
    },
  ],
})
export class AppModule {}
