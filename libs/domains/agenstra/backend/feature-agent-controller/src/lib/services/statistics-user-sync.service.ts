import { UsersRepository } from '@forepath/identity/backend';
import { Injectable, Logger } from '@nestjs/common';

import { StatisticsRepository } from '../repositories/statistics.repository';

/**
 * Syncs users from the users table to the statistics_users mirror table on container startup.
 * Creates mirror entries that do not exist and updates existing mirrors (e.g. role changes).
 * Runs after migrations, similar to the migration lifecycle.
 */
@Injectable()
export class StatisticsUserSyncService {
  private readonly logger = new Logger(StatisticsUserSyncService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly statisticsRepository: StatisticsRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      this.logger.log('🔄 Syncing users to statistics mirror table...');
      const users = await this.usersRepository.findAllIdsAndRoles();

      for (const user of users) {
        await this.statisticsRepository.upsertStatisticsUser(user.id, user.role);
      }

      this.logger.log(`✅ Statistics user sync completed: ${users.length} user(s) synced`);
    } catch (error) {
      this.logger.error('❌ Failed to sync users to statistics mirror table:', error);
      throw error;
    }
  }
}
