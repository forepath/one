import { IDENTITY_STATISTICS_SERVICE } from '@forepath/identity/backend';
import { Global, Module } from '@nestjs/common';

import { StatisticsService } from '../services/statistics.service';

import { StatisticsModule } from './statistics.module';

/**
 * Global bridge module that wires the identity library's optional
 * `IDENTITY_STATISTICS_SERVICE` token to the framework's `StatisticsService`.
 *
 * This makes statistics tracking available to identity services (`UsersService`,
 * `ClientUsersService`) across all modules without requiring each identity module
 * to import `StatisticsModule` directly.
 *
 * Import this module once in `AppModule`.
 */
@Global()
@Module({
  imports: [StatisticsModule],
  providers: [
    {
      provide: IDENTITY_STATISTICS_SERVICE,
      useExisting: StatisticsService,
    },
  ],
  exports: [IDENTITY_STATISTICS_SERVICE],
})
export class IdentityStatisticsBridgeModule {}
