import {
  ClientAgentCredentialEntity,
  ClientAgentCredentialsRepository,
  ClientAgentCredentialsService,
  ClientEntity,
  ClientUserEntity,
  ClientUsersRepository,
  ClientUsersService,
  OidcClientCredentialsService,
  RevokedUserTokenEntity,
  RevokedUserTokensRepository,
  SocketAuthService,
  UserEntity,
  UserPersonalAccessTokenEntity,
  UsersRepository,
} from '@forepath/identity/backend';
import {
  DynamicProviderLoaderService,
  registerDynamicProviders,
} from '@forepath/shared/backend/util-dynamic-provider-registry';
import { FileStorageModule } from '@forepath/shared/backend/util-file-storage';
import { RedisCacheModule } from '@forepath/shared/backend/util-redis-cache';
import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminOpencodeConfigController } from '../controllers/admin-opencode-config.controller';
import { AdminOpencodeLayerFilesController } from '../controllers/admin-opencode-layer-files.controller';
import { AgentTasksController } from '../controllers/agent-tasks.controller';
import { AttachmentsController } from '../controllers/attachments.controller';
import { ChatPlanController } from '../controllers/chat-plan.controller';
import { ClientAgentAutonomyDirectoryController } from '../controllers/client-agent-autonomy-directory.controller';
import { ClientAgentAutonomyController } from '../controllers/client-agent-autonomy.controller';
import { ClientAgentEgressController } from '../controllers/client-agent-egress.controller';
import { ClientDeploymentsController } from '../controllers/client-deployments.controller';
import { ClientIsolationController } from '../controllers/client-isolation.controller';
import { ClientOpencodeConfigController } from '../controllers/client-opencode-config.controller';
import { ClientOpencodeLayerFilesController } from '../controllers/client-opencode-layer-files.controller';
import { ClientStatisticsController } from '../controllers/client-statistics.controller';
import { ClientsAgentAutomationProxyController } from '../controllers/clients-agent-automation-proxy.controller';
import { ClientsConfigurationOverridesController } from '../controllers/clients-configuration-overrides.controller';
import { ClientsGraphController } from '../controllers/clients-graph.controller';
import { ClientsVcsController } from '../controllers/clients-vcs.controller';
import { ClientsWorkspaceSearchController } from '../controllers/clients-workspace-search.controller';
import { ClientsController } from '../controllers/clients.controller';
import { DeploymentConnectionsController } from '../controllers/deployment-connections.controller';
import { KnowledgeTreeController } from '../controllers/knowledge-tree.controller';
import { McpOAuthCallbackController } from '../controllers/mcp-oauth-callback.controller';
import { OpencodeMcpServersController } from '../controllers/opencode-mcp-servers.controller';
import { OpencodeProvidersController } from '../controllers/opencode-providers.controller';
import { StatisticsController } from '../controllers/statistics.controller';
import { TicketAutomationController } from '../controllers/ticket-automation.controller';
import { TicketsController } from '../controllers/tickets.controller';
import { AgenstraAttachmentEntity } from '../entities/agenstra-attachment.entity';
import { AgentHandoffEntity } from '../entities/agent-handoff.entity';
import { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import { AgentTaskEntity } from '../entities/agent-task.entity';
import { ChatPlanActivityEntity } from '../entities/chat-plan-activity.entity';
import { ChatPlanEntity } from '../entities/chat-plan.entity';
import { ClientAgentAutonomyEntity } from '../entities/client-agent-autonomy.entity';
import { ClientIsolationSnapshotEntity } from '../entities/client-isolation-snapshot.entity';
import { ClientOpencodeConfigEntity } from '../entities/client-opencode-config.entity';
import { DeploymentConnectionEntity } from '../entities/deployment-connection.entity';
import { DeploymentRunEntity } from '../entities/deployment-run.entity';
import { DeploymentWorkflowEntity } from '../entities/deployment-workflow.entity';
import { EgressEventIngestCursorEntity } from '../entities/egress-event-ingest-cursor.entity';
import { GlobalOpencodeConfigEntity } from '../entities/global-opencode-config.entity';
import { KnowledgeNodeEmbeddingEntity } from '../entities/knowledge-node-embedding.entity';
import { KnowledgeNodeEntity } from '../entities/knowledge-node.entity';
import { KnowledgePageActivityEntity } from '../entities/knowledge-page-activity.entity';
import { KnowledgeRelationEntity } from '../entities/knowledge-relation.entity';
import { OpencodeConfigSyncTargetEntity } from '../entities/opencode-config-sync-target.entity';
import { OpencodeLayerFileSyncTargetEntity } from '../entities/opencode-layer-file-sync-target.entity';
import { OpencodeLayerFileEntity } from '../entities/opencode-layer-file.entity';
import { OpencodeMcpServerEntity } from '../entities/opencode-mcp-server.entity';
import { OpencodeProviderEntity } from '../entities/opencode-provider.entity';
import { ProvisioningReferenceEntity } from '../entities/provisioning-reference.entity';
import { TicketActivityEntity } from '../entities/ticket-activity.entity';
import { TicketAutomationLeaseEntity } from '../entities/ticket-automation-lease.entity';
import { TicketAutomationRunStepEntity } from '../entities/ticket-automation-run-step.entity';
import { TicketAutomationRunEntity } from '../entities/ticket-automation-run.entity';
import { TicketAutomationEntity } from '../entities/ticket-automation.entity';
import { TicketBodyGenerationSessionEntity } from '../entities/ticket-body-generation-session.entity';
import { TicketCommentEntity } from '../entities/ticket-comment.entity';
import { TicketEntity } from '../entities/ticket.entity';
import { UserChatSessionReadStateEntity } from '../entities/user-chat-session-read-state.entity';
import { UserEnvironmentReadStateEntity } from '../entities/user-environment-read-state.entity';
import { WorkspaceGraphSnapshotEntity } from '../entities/workspace-graph-snapshot.entity';
import { ClientsGateway } from '../gateways/clients.gateway';
import { KnowledgeBoardGateway } from '../gateways/knowledge-board.gateway';
import { StatusGateway } from '../gateways/status.gateway';
import { TicketsBoardGateway } from '../gateways/tickets-board.gateway';
import { VncGateway } from '../gateways/vnc.gateway';
import { ClientAgentMembershipInterceptor } from '../interceptors/client-agent-membership.interceptor';
import { DeploymentProviderRegistry } from '../providers/deployment/deployment-provider.registry';
import { GitHubDeploymentProvider } from '../providers/deployment/github-deployment.provider';
import { GitLabDeploymentProvider } from '../providers/deployment/gitlab-deployment.provider';
import { JenkinsDeploymentProvider } from '../providers/deployment/jenkins-deployment.provider';
import { DigitalOceanProvider } from '../providers/provisioning/digital-ocean.provider';
import { HetznerProvider } from '../providers/provisioning/hetzner.provider';
import { ProvisioningProviderFactory } from '../providers/provisioning-provider.factory';
import { ProvisioningProvider } from '../providers/provisioning-provider.interface';
import { ClientsRepository } from '../repositories/clients.repository';
import { ProvisioningReferencesRepository } from '../repositories/provisioning-references.repository';
import { TicketAutomationRunsStatusRepository } from '../repositories/ticket-automation-runs-status.repository';
import { UserChatSessionReadStateRepository } from '../repositories/user-chat-session-read-state.repository';
import { UserEnvironmentReadStateRepository } from '../repositories/user-environment-read-state.repository';
import { WorkspaceGraphSnapshotsRepository } from '../repositories/workspace-graph-snapshots.repository';
import { AgenstraSearchModule } from '../search/agenstra-search.module';
import { WorkspaceSearchIndexService } from '../search/workspace-search-index.service';
import { AgenstraAttachmentsService } from '../services/agenstra-attachments.service';
import { AgenstraMetricsCollectorService } from '../services/agenstra-metrics-collector.service';
import { AgentConsoleStatusRealtimeService } from '../services/agent-console-status-realtime.service';
import { AgentConsoleStatusService } from '../services/agent-console-status.service';
import { AgentContentChangesService } from '../services/agent-content-changes.service';
import { AgentContextRequestHandlerService } from '../services/agent-context-request-handler.service';
import { AgentDeploymentRequestHandlerService } from '../services/agent-deployment-request-handler.service';
import { AgentDeploymentSourcesService } from '../services/agent-deployment-sources.service';
import { AgentHandoffRequestHandlerService } from '../services/agent-handoff-request-handler.service';
import { AgentHandoffRunnerService } from '../services/agent-handoff-runner.service';
import { AgentHandoffsService } from '../services/agent-handoffs.service';
import { AgentTaskChatSyncService } from '../services/agent-task-chat-sync.service';
import { AgentTaskRealtimeService } from '../services/agent-task-realtime.service';
import { AgentTaskRequestHandlerService } from '../services/agent-task-request-handler.service';
import { AgentTaskRunnerService } from '../services/agent-task-runner.service';
import { AgentTasksService } from '../services/agent-tasks.service';
import { AutoContextResolverService } from '../services/auto-context-resolver.service';
import { AutonomousRunOrchestratorService } from '../services/autonomous-run-orchestrator.service';
import { ChatPlanActivityService } from '../services/chat-plan-activity.service';
import { ChatPlanChatSyncService } from '../services/chat-plan-chat-sync.service';
import { ChatPlanOrchestratorService } from '../services/chat-plan-orchestrator.service';
import { ChatPlanRealtimeService } from '../services/chat-plan-realtime.service';
import { ChatPlanService } from '../services/chat-plan.service';
import { ClientAgentAutonomyService } from '../services/client-agent-autonomy.service';
import { ClientAgentChatsProxyService } from '../services/client-agent-chats-proxy.service';
import { ClientAgentEnvironmentVariablesProxyService } from '../services/client-agent-environment-variables-proxy.service';
import { ClientAgentFileSystemProxyService } from '../services/client-agent-file-system-proxy.service';
import { ClientAgentGraphProxyService } from '../services/client-agent-graph-proxy.service';
import { ClientAgentMembershipService } from '../services/client-agent-membership.service';
import { ClientAgentMessagesProxyService } from '../services/client-agent-messages-proxy.service';
import { ClientAgentOpencodeConfigProxyService } from '../services/client-agent-opencode-config-proxy.service';
import { ClientAgentProxyService } from '../services/client-agent-proxy.service';
import { ClientAgentVcsProxyService } from '../services/client-agent-vcs-proxy.service';
import { ClientAgentVncProxyService } from '../services/client-agent-vnc-proxy.service';
import { ClientAutomationChatRealtimeService } from '../services/client-automation-chat-realtime.service';
import { ClientIsolationService } from '../services/client-isolation.service';
import { ClientWorkspaceConfigurationOverridesProxyService } from '../services/client-workspace-configuration-overrides-proxy.service';
import { ClientsService } from '../services/clients.service';
import { ControllerVncTicketService } from '../services/controller-vnc-ticket.service';
import { DeploymentConnectionsService } from '../services/deployment-connections.service';
import { DeploymentRealtimeRelayService } from '../services/deployment-realtime-relay.service';
import { DeploymentRealtimeService } from '../services/deployment-realtime.service';
import { DeploymentRunsService } from '../services/deployment-runs.service';
import { DeploymentWorkflowsService } from '../services/deployment-workflows.service';
import { EgressEventsIngestService } from '../services/egress-events-ingest.service';
import { KnowledgeEmbeddingIndexService } from '../services/embeddings/knowledge-embedding-index.service';
import { LocalEmbeddingProvider } from '../services/embeddings/local-embedding.provider';
import { KnowledgeBoardRealtimeService } from '../services/knowledge-board-realtime.service';
import { KnowledgeTreeService } from '../services/knowledge-tree.service';
import { OpencodeConfigSyncTargetsService } from '../services/opencode-config-sync-targets.service';
import { OpencodeConfigService } from '../services/opencode-config.service';
import { OpencodeEffectiveConfigSyncService } from '../services/opencode-effective-config-sync.service';
import { OpencodeLayerFilesService } from '../services/opencode-layer-files.service';
import { OpencodeMcpServersBootstrapService } from '../services/opencode-mcp-servers-bootstrap.service';
import { OpencodeMcpServersCatalogService } from '../services/opencode-mcp-servers-catalog.service';
import { OpencodeProvidersBootstrapService } from '../services/opencode-providers-bootstrap.service';
import { OpencodeProvidersCatalogService } from '../services/opencode-providers-catalog.service';
import { ProvisioningService } from '../services/provisioning.service';
import { RemoteAgentsSessionService } from '../services/remote-agents-session.service';
import { StatisticsAgentSyncService } from '../services/statistics-agent-sync.service';
import { TicketAutomationChatSyncService } from '../services/ticket-automation-chat-sync.service';
import { TicketAutomationService } from '../services/ticket-automation.service';
import { TicketBoardRealtimeService } from '../services/ticket-board-realtime.service';
import { TicketsService } from '../services/tickets.service';
import { WorkspaceGraphChangeNotifierService } from '../services/workspace-graph-change-notifier.service';
import { WorkspaceGraphSnapshotService } from '../services/workspace-graph-snapshot.service';
import { WorkspaceGraphViewService } from '../services/workspace-graph-view.service';

import { AgenstraNotificationsModule, AGENSTRA_CONTROLLER_QUEUE_NAME } from './agenstra-notifications.module';
import { AgenstraUpdatesModule } from './agenstra-updates.module';
import { ContextImportModule } from './context-import.module';
import { StatisticsModule } from './statistics.module';

/**
 * Module for agent clients feature.
 * Provides controllers, services, and repository for agent CRUD operations and file system operations.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ClientEntity,
      DeploymentConnectionEntity,
      DeploymentWorkflowEntity,
      DeploymentRunEntity,
      ClientAgentCredentialEntity,
      ProvisioningReferenceEntity,
      ClientUserEntity,
      UserEntity,
      RevokedUserTokenEntity,
      UserPersonalAccessTokenEntity,
      TicketEntity,
      TicketCommentEntity,
      TicketActivityEntity,
      TicketBodyGenerationSessionEntity,
      TicketAutomationEntity,
      TicketAutomationRunEntity,
      TicketAutomationLeaseEntity,
      TicketAutomationRunStepEntity,
      ChatPlanEntity,
      ChatPlanActivityEntity,
      AgentTaskEntity,
      AgentTaskRunEntity,
      AgentHandoffEntity,
      AgenstraAttachmentEntity,
      ClientAgentAutonomyEntity,
      KnowledgeNodeEntity,
      KnowledgeNodeEmbeddingEntity,
      KnowledgePageActivityEntity,
      KnowledgeRelationEntity,
      UserChatSessionReadStateEntity,
      UserEnvironmentReadStateEntity,
      GlobalOpencodeConfigEntity,
      ClientOpencodeConfigEntity,
      OpencodeProviderEntity,
      OpencodeMcpServerEntity,
      OpencodeLayerFileEntity,
      OpencodeLayerFileSyncTargetEntity,
      OpencodeConfigSyncTargetEntity,
      EgressEventIngestCursorEntity,
      ClientIsolationSnapshotEntity,
      WorkspaceGraphSnapshotEntity,
    ]),
    BullModule.registerQueue({ name: AGENSTRA_CONTROLLER_QUEUE_NAME }),
    RedisCacheModule,
    FileStorageModule,
    AgenstraSearchModule,
    AgenstraNotificationsModule,
    AgenstraUpdatesModule,
    StatisticsModule,
    forwardRef(() => ContextImportModule),
  ],
  controllers: [
    ClientsController,
    DeploymentConnectionsController,
    ClientDeploymentsController,
    ClientsConfigurationOverridesController,
    ClientsVcsController,
    ClientStatisticsController,
    StatisticsController,
    TicketsController,
    AttachmentsController,
    KnowledgeTreeController,
    TicketAutomationController,
    ChatPlanController,
    AgentTasksController,
    ClientAgentAutonomyController,
    ClientAgentAutonomyDirectoryController,
    ClientsAgentAutomationProxyController,
    ClientsWorkspaceSearchController,
    ClientsGraphController,
    AdminOpencodeConfigController,
    AdminOpencodeLayerFilesController,
    ClientOpencodeConfigController,
    ClientAgentEgressController,
    ClientIsolationController,
    McpOAuthCallbackController,
    ClientOpencodeLayerFilesController,
    OpencodeProvidersController,
    OpencodeMcpServersController,
  ],
  providers: [
    AgenstraMetricsCollectorService,
    GitHubDeploymentProvider,
    GitLabDeploymentProvider,
    JenkinsDeploymentProvider,
    DeploymentProviderRegistry,
    DeploymentConnectionsService,
    DeploymentWorkflowsService,
    DeploymentRunsService,
    DeploymentRealtimeService,
    DeploymentRealtimeRelayService,
    AgentDeploymentSourcesService,
    AgentDeploymentRequestHandlerService,
    ClientsService,
    AgenstraAttachmentsService,
    TicketsService,
    KnowledgeTreeService,
    AutoContextResolverService,
    AgentContextRequestHandlerService,
    AgentContentChangesService,
    ClientAgentMembershipService,
    // Agent routes of every controller only reach agents of the addressed workspace.
    { provide: APP_INTERCEPTOR, useClass: ClientAgentMembershipInterceptor },
    AgentTasksService,
    AgentTaskRunnerService,
    AgentTaskRequestHandlerService,
    AgentTaskRealtimeService,
    AgentTaskChatSyncService,
    AgentHandoffsService,
    AgentHandoffRunnerService,
    AgentHandoffRequestHandlerService,
    KnowledgeEmbeddingIndexService,
    LocalEmbeddingProvider,
    TicketAutomationService,
    ChatPlanService,
    ChatPlanActivityService,
    ChatPlanOrchestratorService,
    ClientAgentAutonomyService,
    RemoteAgentsSessionService,
    AutonomousRunOrchestratorService,
    ClientsRepository,
    ClientUsersRepository,
    ClientUsersService,
    UsersRepository,
    RevokedUserTokensRepository,
    OidcClientCredentialsService,
    ClientAgentProxyService,
    ClientAgentFileSystemProxyService,
    WorkspaceSearchIndexService,
    ClientAgentVcsProxyService,
    ClientAgentEnvironmentVariablesProxyService,
    ClientAgentChatsProxyService,
    ClientAgentVncProxyService,
    ControllerVncTicketService,
    ClientWorkspaceConfigurationOverridesProxyService,
    ClientAgentOpencodeConfigProxyService,
    ClientAgentGraphProxyService,
    WorkspaceGraphSnapshotsRepository,
    WorkspaceGraphChangeNotifierService,
    WorkspaceGraphSnapshotService,
    WorkspaceGraphViewService,
    OpencodeConfigService,
    OpencodeProvidersCatalogService,
    OpencodeProvidersBootstrapService,
    OpencodeMcpServersCatalogService,
    OpencodeMcpServersBootstrapService,
    OpencodeEffectiveConfigSyncService,
    OpencodeConfigSyncTargetsService,
    EgressEventsIngestService,
    ClientIsolationService,
    OpencodeLayerFilesService,
    ClientAgentCredentialsRepository,
    ClientAgentCredentialsService,
    SocketAuthService,
    AgentConsoleStatusRealtimeService,
    AgentConsoleStatusService,
    ClientAgentMessagesProxyService,
    UserChatSessionReadStateRepository,
    UserEnvironmentReadStateRepository,
    TicketAutomationRunsStatusRepository,
    ClientsGateway,
    VncGateway,
    TicketBoardRealtimeService,
    KnowledgeBoardRealtimeService,
    ClientAutomationChatRealtimeService,
    TicketAutomationChatSyncService,
    ChatPlanRealtimeService,
    ChatPlanChatSyncService,
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
    DeploymentRunsService,
    DeploymentConnectionsService,
    ClientsRepository,
    ClientUsersRepository,
    ClientUsersService,
    OidcClientCredentialsService,
    ClientAgentProxyService,
    ClientAgentFileSystemProxyService,
    ClientAgentVcsProxyService,
    ClientAgentEnvironmentVariablesProxyService,
    ClientAgentChatsProxyService,
    ClientWorkspaceConfigurationOverridesProxyService,
    ClientAgentGraphProxyService,
    WorkspaceGraphSnapshotService,
    ClientAgentCredentialsRepository,
    ClientAgentCredentialsService,
    ClientsGateway,
    ProvisioningService,
    ProvisioningProviderFactory,
    TicketsService,
    KnowledgeTreeService,
    KnowledgeEmbeddingIndexService,
    AutonomousRunOrchestratorService,
    AgentTaskRunnerService,
    AgentHandoffRunnerService,
    OpencodeProvidersCatalogService,
    OpencodeMcpServersCatalogService,
    OpencodeConfigSyncTargetsService,
    EgressEventsIngestService,
    ClientIsolationService,
    OpencodeLayerFilesService,
  ],
})
export class ClientsModule {}
