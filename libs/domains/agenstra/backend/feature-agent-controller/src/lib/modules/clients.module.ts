import {
  DynamicProviderLoaderService,
  registerDynamicProviders,
} from '@forepath/shared/backend/util-dynamic-provider-registry';
import { RedisCacheModule } from '@forepath/shared/backend/util-redis-cache';
import {
  ClientAgentCredentialEntity,
  ClientAgentCredentialsRepository,
  ClientAgentCredentialsService,
  ClientEntity,
  ClientUserEntity,
  ClientUsersRepository,
  ClientUsersService,
  getAuthenticationMethod,
  KeycloakService,
  KeycloakTokenService,
  RevokedUserTokenEntity,
  RevokedUserTokensRepository,
  SocketAuthService,
  UserEntity,
  UsersRepository,
} from '@forepath/identity/backend';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeycloakConnectModule } from 'nest-keycloak-connect';

import { ClientAgentAutonomyDirectoryController } from '../controllers/client-agent-autonomy-directory.controller';
import { ClientAgentAutonomyController } from '../controllers/client-agent-autonomy.controller';
import { ClientStatisticsController } from '../controllers/client-statistics.controller';
import { ClientsAgentAutomationProxyController } from '../controllers/clients-agent-automation-proxy.controller';
import { ClientsConfigurationOverridesController } from '../controllers/clients-configuration-overrides.controller';
import { ClientsDeploymentsController } from '../controllers/clients-deployments.controller';
import { ClientsVcsController } from '../controllers/clients-vcs.controller';
import { ClientsController } from '../controllers/clients.controller';
import { KnowledgeTreeController } from '../controllers/knowledge-tree.controller';
import { StatisticsController } from '../controllers/statistics.controller';
import { TicketAutomationController } from '../controllers/ticket-automation.controller';
import { TicketsController } from '../controllers/tickets.controller';
import { ClientAgentAutonomyEntity } from '../entities/client-agent-autonomy.entity';
import { KnowledgeNodeEmbeddingEntity } from '../entities/knowledge-node-embedding.entity';
import { KnowledgeNodeEntity } from '../entities/knowledge-node.entity';
import { KnowledgePageActivityEntity } from '../entities/knowledge-page-activity.entity';
import { KnowledgeRelationEntity } from '../entities/knowledge-relation.entity';
import { ProvisioningReferenceEntity } from '../entities/provisioning-reference.entity';
import { TicketActivityEntity } from '../entities/ticket-activity.entity';
import { TicketAutomationLeaseEntity } from '../entities/ticket-automation-lease.entity';
import { TicketAutomationRunStepEntity } from '../entities/ticket-automation-run-step.entity';
import { TicketAutomationRunEntity } from '../entities/ticket-automation-run.entity';
import { TicketAutomationEntity } from '../entities/ticket-automation.entity';
import { TicketBodyGenerationSessionEntity } from '../entities/ticket-body-generation-session.entity';
import { TicketCommentEntity } from '../entities/ticket-comment.entity';
import { TicketEntity } from '../entities/ticket.entity';
import { UserEnvironmentReadStateEntity } from '../entities/user-environment-read-state.entity';
import { ClientsGateway } from '../gateways/clients.gateway';
import { KnowledgeBoardGateway } from '../gateways/knowledge-board.gateway';
import { StatusGateway } from '../gateways/status.gateway';
import { TicketsBoardGateway } from '../gateways/tickets-board.gateway';
import { DigitalOceanProvider } from '../providers/provisioning/digital-ocean.provider';
import { HetznerProvider } from '../providers/provisioning/hetzner.provider';
import { ProvisioningProviderFactory } from '../providers/provisioning-provider.factory';
import { ProvisioningProvider } from '../providers/provisioning-provider.interface';
import { ClientsRepository } from '../repositories/clients.repository';
import { ProvisioningReferencesRepository } from '../repositories/provisioning-references.repository';
import { TicketAutomationRunsStatusRepository } from '../repositories/ticket-automation-runs-status.repository';
import { UserEnvironmentReadStateRepository } from '../repositories/user-environment-read-state.repository';
import { AgentConsoleStatusRealtimeService } from '../services/agent-console-status-realtime.service';
import { AgentConsoleStatusService } from '../services/agent-console-status.service';
import { AutoContextResolverService } from '../services/auto-context-resolver.service';
import { AutonomousRunOrchestratorService } from '../services/autonomous-run-orchestrator.service';
import { ClientAgentAutonomyService } from '../services/client-agent-autonomy.service';
import { ClientAgentDeploymentsProxyService } from '../services/client-agent-deployments-proxy.service';
import { ClientAgentEnvironmentVariablesProxyService } from '../services/client-agent-environment-variables-proxy.service';
import { ClientAgentFileSystemProxyService } from '../services/client-agent-file-system-proxy.service';
import { ClientAgentMessagesProxyService } from '../services/client-agent-messages-proxy.service';
import { ClientAgentProxyService } from '../services/client-agent-proxy.service';
import { ClientAgentVcsProxyService } from '../services/client-agent-vcs-proxy.service';
import { ClientAutomationChatRealtimeService } from '../services/client-automation-chat-realtime.service';
import { ClientWorkspaceConfigurationOverridesProxyService } from '../services/client-workspace-configuration-overrides-proxy.service';
import { ClientsService } from '../services/clients.service';
import { KnowledgeEmbeddingIndexService } from '../services/embeddings/knowledge-embedding-index.service';
import { LocalEmbeddingProvider } from '../services/embeddings/local-embedding.provider';
import { KnowledgeBoardRealtimeService } from '../services/knowledge-board-realtime.service';
import { KnowledgeTreeService } from '../services/knowledge-tree.service';
import { ProvisioningService } from '../services/provisioning.service';
import { RemoteAgentsSessionService } from '../services/remote-agents-session.service';
import { StatisticsAgentSyncService } from '../services/statistics-agent-sync.service';
import { TicketAutomationChatSyncService } from '../services/ticket-automation-chat-sync.service';
import { TicketAutomationService } from '../services/ticket-automation.service';
import { TicketBoardRealtimeService } from '../services/ticket-board-realtime.service';
import { TicketsService } from '../services/tickets.service';

import { ContextImportModule } from './context-import.module';
import { FilterRulesModule } from './filter-rules.module';
import { StatisticsModule } from './statistics.module';

const authMethod = getAuthenticationMethod();

/**
 * Module for agent clients feature.
 * Provides controllers, services, and repository for agent CRUD operations and file system operations.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ClientEntity,
      ClientAgentCredentialEntity,
      ProvisioningReferenceEntity,
      ClientUserEntity,
      UserEntity,
      RevokedUserTokenEntity,
      TicketEntity,
      TicketCommentEntity,
      TicketActivityEntity,
      TicketBodyGenerationSessionEntity,
      TicketAutomationEntity,
      TicketAutomationRunEntity,
      TicketAutomationLeaseEntity,
      TicketAutomationRunStepEntity,
      ClientAgentAutonomyEntity,
      KnowledgeNodeEntity,
      KnowledgeNodeEmbeddingEntity,
      KnowledgePageActivityEntity,
      KnowledgeRelationEntity,
      UserEnvironmentReadStateEntity,
    ]),
    RedisCacheModule,
    StatisticsModule,
    forwardRef(() => FilterRulesModule),
    forwardRef(() => ContextImportModule),
    // Import KeycloakConnectModule conditionally to make KEYCLOAK_INSTANCE available to SocketAuthService
    ...(authMethod === 'keycloak' ? [KeycloakConnectModule.registerAsync({ useExisting: KeycloakService })] : []),
  ],
  controllers: [
    ClientsController,
    ClientsConfigurationOverridesController,
    ClientsVcsController,
    ClientsDeploymentsController,
    ClientStatisticsController,
    StatisticsController,
    TicketsController,
    KnowledgeTreeController,
    TicketAutomationController,
    ClientAgentAutonomyController,
    ClientAgentAutonomyDirectoryController,
    ClientsAgentAutomationProxyController,
  ],
  providers: [
    ClientsService,
    TicketsService,
    KnowledgeTreeService,
    AutoContextResolverService,
    KnowledgeEmbeddingIndexService,
    LocalEmbeddingProvider,
    TicketAutomationService,
    ClientAgentAutonomyService,
    RemoteAgentsSessionService,
    AutonomousRunOrchestratorService,
    ClientsRepository,
    ClientUsersRepository,
    ClientUsersService,
    UsersRepository,
    RevokedUserTokensRepository,
    KeycloakTokenService,
    ClientAgentProxyService,
    ClientAgentFileSystemProxyService,
    ClientAgentVcsProxyService,
    ClientAgentDeploymentsProxyService,
    ClientAgentEnvironmentVariablesProxyService,
    ClientWorkspaceConfigurationOverridesProxyService,
    ClientAgentCredentialsRepository,
    ClientAgentCredentialsService,
    SocketAuthService,
    AgentConsoleStatusRealtimeService,
    AgentConsoleStatusService,
    ClientAgentMessagesProxyService,
    UserEnvironmentReadStateRepository,
    TicketAutomationRunsStatusRepository,
    ClientsGateway,
    TicketBoardRealtimeService,
    KnowledgeBoardRealtimeService,
    ClientAutomationChatRealtimeService,
    TicketAutomationChatSyncService,
    TicketsBoardGateway,
    KnowledgeBoardGateway,
    StatusGateway,
    ProvisioningService,
    ProvisioningProviderFactory,
    ProvisioningReferencesRepository,
    HetznerProvider,
    DigitalOceanProvider,
    DynamicProviderLoaderService,
    StatisticsAgentSyncService,
    {
      provide: 'PROVISIONING_PROVIDERS',
      useFactory: async (
        factory: ProvisioningProviderFactory,
        hetzner: HetznerProvider,
        digitalOcean: DigitalOceanProvider,
        dynamicLoader: DynamicProviderLoaderService,
      ) => {
        factory.registerProvider(hetzner);
        factory.registerProvider(digitalOcean);

        await registerDynamicProviders<ProvisioningProvider>({
          envKey: 'DYNAMIC_PROVISIONING_PROVIDERS',
          criticality: 'critical',
          register: (provider) => factory.registerProvider(provider),
          dynamicLoader,
          loggerContext: 'ProvisioningProviderFactory',
        });

        return factory;
      },
      inject: [ProvisioningProviderFactory, HetznerProvider, DigitalOceanProvider, DynamicProviderLoaderService],
    },
  ],
  exports: [
    ClientsService,
    ClientsRepository,
    ClientUsersRepository,
    ClientUsersService,
    KeycloakTokenService,
    ClientAgentProxyService,
    ClientAgentFileSystemProxyService,
    ClientAgentVcsProxyService,
    ClientAgentDeploymentsProxyService,
    ClientAgentEnvironmentVariablesProxyService,
    ClientWorkspaceConfigurationOverridesProxyService,
    ClientAgentCredentialsRepository,
    ClientAgentCredentialsService,
    ClientsGateway,
    ProvisioningService,
    ProvisioningProviderFactory,
    TicketsService,
    KnowledgeTreeService,
    KnowledgeEmbeddingIndexService,
    AutonomousRunOrchestratorService,
  ],
})
export class ClientsModule {}
