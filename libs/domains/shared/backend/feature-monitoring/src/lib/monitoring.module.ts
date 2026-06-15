import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

/**
 * Module for monitoring feature.
 * Provides health check controller.
 */
@Module({
  controllers: [HealthController],
})
export class MonitoringModule {}
