import { ClientEntity, UserEntity, UsersRepository } from '@forepath/identity/backend';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StatisticsAgentEntity } from '../entities/statistics-agent.entity';
import { StatisticsChatFilterDropEntity } from '../entities/statistics-chat-filter-drop.entity';
import { StatisticsChatFilterFlagEntity } from '../entities/statistics-chat-filter-flag.entity';
import { StatisticsChatIoEntity } from '../entities/statistics-chat-io.entity';
import { StatisticsClientUserEntity } from '../entities/statistics-client-user.entity';
import { StatisticsClientEntity } from '../entities/statistics-client.entity';
import { StatisticsEgressEventEntity } from '../entities/statistics-egress-event.entity';
import { StatisticsEntityEventEntity } from '../entities/statistics-entity-event.entity';
import { StatisticsProvisioningReferenceEntity } from '../entities/statistics-provisioning-reference.entity';
import { StatisticsUserEntity } from '../entities/statistics-user.entity';
import { ClientsRepository } from '../repositories/clients.repository';
import { StatisticsSecurityRepository } from '../repositories/statistics-security.repository';
import { StatisticsRepository } from '../repositories/statistics.repository';
import { AgenstraSearchModule } from '../search/agenstra-search.module';
import { StatisticsClientSyncService } from '../services/statistics-client-sync.service';
import { StatisticsQueryService } from '../services/statistics-query.service';
import { StatisticsUserSyncService } from '../services/statistics-user-sync.service';
import { StatisticsService } from '../services/statistics.service';

/**
 * Module for persistent statistics. Provides StatisticsService for recording
 * chat I/O, filter drops, egress guard decisions and entity lifecycle events, and StatisticsQueryService
 * for REST API queries. Syncs users and clients to statistics mirror tables on startup.
 */
@Module({
  imports: [
    AgenstraSearchModule,
    TypeOrmModule.forFeature([
      ClientEntity,
      UserEntity,
      StatisticsUserEntity,
      StatisticsClientEntity,
      StatisticsAgentEntity,
      StatisticsProvisioningReferenceEntity,
      StatisticsClientUserEntity,
      StatisticsChatIoEntity,
      StatisticsChatFilterDropEntity,
      StatisticsChatFilterFlagEntity,
      StatisticsEgressEventEntity,
      StatisticsEntityEventEntity,
    ]),
  ],
  providers: [
    StatisticsRepository,
    StatisticsSecurityRepository,
    StatisticsService,
    StatisticsQueryService,
    StatisticsUserSyncService,
    StatisticsClientSyncService,
    ClientsRepository,
    UsersRepository,
  ],
  exports: [StatisticsService, StatisticsQueryService, StatisticsRepository, StatisticsSecurityRepository],
})
export class StatisticsModule {}
