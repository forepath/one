import { AuthenticationType } from '@forepath/identity/backend';
import { Injectable, Logger } from '@nestjs/common';

import { ClientsRepository } from '../repositories/clients.repository';
import { StatisticsRepository } from '../repositories/statistics.repository';

/**
 * Syncs clients from the clients table to the statistics_clients mirror table on container startup.
 * Creates mirror entries that do not exist and updates existing mirrors (e.g. name, endpoint changes).
 * Runs after migrations, similar to the migration lifecycle.
 */
@Injectable()
export class StatisticsClientSyncService {
  private readonly logger = new Logger(StatisticsClientSyncService.name);

  constructor(
    private readonly clientsRepository: ClientsRepository,
    private readonly statisticsRepository: StatisticsRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      this.logger.log('🔄 Syncing clients to statistics mirror table...');
      const clients = await this.clientsRepository.findAllForStatisticsSync();

      for (const client of clients) {
        await this.statisticsRepository.upsertStatisticsClient(client.id, {
          name: client.name,
          endpoint: client.endpoint,
          authenticationType: client.authenticationType as AuthenticationType,
        });
      }

      this.logger.log(`✅ Statistics client sync completed: ${clients.length} client(s) synced`);
    } catch (error) {
      this.logger.error('❌ Failed to sync clients to statistics mirror table:', error);
      throw error;
    }
  }
}
