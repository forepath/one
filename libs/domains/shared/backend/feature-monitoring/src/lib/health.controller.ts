// eslint-disable-next-line @nx/enforce-module-boundaries
import { Public as HybridPublic } from '@forepath/identity/backend/util-auth/core';
import { Controller, Get } from '@nestjs/common';

/**
 * Health check response DTO.
 */
export interface HealthResponseDto {
  status: 'ok';
  timestamp: number;
}

/**
 * Controller for health check endpoints.
 * Provides health status for monitoring and load balancer checks.
 */
@HybridPublic()
@Controller('health')
export class HealthController {
  /**
   * Get health status of the application.
   * @returns Health status with timestamp
   */
  @HybridPublic()
  @Get()
  getHealth(): HealthResponseDto {
    return {
      status: 'ok',
      timestamp: Date.now(),
    };
  }
}
