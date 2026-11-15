import { ClientEntity } from '@forepath/identity/backend';
import { OpenSearchModule } from '@forepath/shared/backend/util-opensearch';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AtlassianSiteConnectionEntity } from '../entities/atlassian-site-connection.entity';
import { DeploymentConnectionEntity } from '../entities/deployment-connection.entity';
import { DeploymentRunEntity } from '../entities/deployment-run.entity';
import { DeploymentWorkflowEntity } from '../entities/deployment-workflow.entity';
import { ExternalImportConfigEntity } from '../entities/external-import-config.entity';
import { KnowledgeNodeEntity } from '../entities/knowledge-node.entity';
import { OpencodeMcpServerEntity } from '../entities/opencode-mcp-server.entity';
import { OpencodeProviderEntity } from '../entities/opencode-provider.entity';
import { StatisticsAgentEntity } from '../entities/statistics-agent.entity';
import { StatisticsChatFilterDropEntity } from '../entities/statistics-chat-filter-drop.entity';
import { StatisticsChatFilterFlagEntity } from '../entities/statistics-chat-filter-flag.entity';
import { StatisticsChatIoEntity } from '../entities/statistics-chat-io.entity';
import { StatisticsClientEntity } from '../entities/statistics-client.entity';
import { StatisticsEgressEventEntity } from '../entities/statistics-egress-event.entity';
import { StatisticsEntityEventEntity } from '../entities/statistics-entity-event.entity';
import { StatisticsUserEntity } from '../entities/statistics-user.entity';
import { TicketEntity } from '../entities/ticket.entity';

import { AgenstraSearchIndexService } from './agenstra-search-index.service';

@Module({
  imports: [
    OpenSearchModule,
    TypeOrmModule.forFeature([
      ClientEntity,
      TicketEntity,
      KnowledgeNodeEntity,
      AtlassianSiteConnectionEntity,
      DeploymentConnectionEntity,
      DeploymentWorkflowEntity,
      DeploymentRunEntity,
      ExternalImportConfigEntity,
      StatisticsAgentEntity,
      StatisticsClientEntity,
      StatisticsChatIoEntity,
      StatisticsChatFilterDropEntity,
      StatisticsChatFilterFlagEntity,
      StatisticsEgressEventEntity,
      StatisticsEntityEventEntity,
      StatisticsUserEntity,
      OpencodeProviderEntity,
      OpencodeMcpServerEntity,
    ]),
  ],
  providers: [AgenstraSearchIndexService],
  exports: [AgenstraSearchIndexService, OpenSearchModule],
})
export class AgenstraSearchModule {}
