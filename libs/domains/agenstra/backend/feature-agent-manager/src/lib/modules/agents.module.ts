import {
  DynamicProviderLoaderService,
  registerDynamicProviders,
} from '@forepath/shared/backend/util-dynamic-provider-registry';
import { PasswordService } from '@forepath/identity/backend';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AgentsChatSessionsController } from '../controllers/agents-chat-sessions.controller';
import { AgentsContextController } from '../controllers/agents-context.controller';
import { AgentsContextDeploymentsController } from '../controllers/agents-context-deployments.controller';
import { AgentGraphsComposeController, AgentsGraphController } from '../controllers/agents-graph.controller';
import { AgentsGraphContextController } from '../controllers/agents-graph-context.controller';
import { AgentsTasksController } from '../controllers/agents-tasks.controller';
import { AgentsHandoffsController } from '../controllers/agents-handoffs.controller';
import { InstanceStatusController } from '../controllers/instance-status.controller';
import { AgentsEnvironmentVariablesController } from '../controllers/agents-environment-variables.controller';
import { AgentsFilesController } from '../controllers/agents-files.controller';
import { AgentsSystemFilesController } from '../controllers/agents-system-files.controller';
import { AgentsEgressController } from '../controllers/agents-egress.controller';
import { AgentsMessagesController } from '../controllers/agents-messages.controller';
import { AgentsVcsController } from '../controllers/agents-vcs.controller';
import { AgentsVerificationController } from '../controllers/agents-verification.controller';
import { AgentsVncController } from '../controllers/agents-vnc.controller';
import { AgentsController } from '../controllers/agents.controller';
import { AgentsOpencodeConfigController } from '../controllers/agents-opencode-config.controller';
import { AgentsOpencodeMcpController } from '../controllers/agents-opencode-mcp.controller';
import { AgentsPermissionsController } from '../controllers/agents-permissions.controller';
import { AgentsWorkspaceIndexController } from '../controllers/agents-workspace-index.controller';
import { ConfigController } from '../controllers/config.controller';
import { IsolationController } from '../controllers/isolation.controller';
import { WorkspaceConfigurationOverridesController } from '../controllers/workspace-configuration-overrides.controller';
import { AgentChatSessionEntity } from '../entities/agent-chat-session.entity';
import { AgentEnvironmentVariableEntity } from '../entities/agent-environment-variable.entity';
import { AgentMessageEventEntity } from '../entities/agent-message-event.entity';
import { AgentMessageEntity } from '../entities/agent-message.entity';
import { AgentEntity } from '../entities/agent.entity';
import { AgentDirectoryIndexEntity } from '../entities/agent-directory-index.entity';
import { AgentGraphPromptEntity } from '../entities/agent-graph-prompt.entity';
import { AgentGraphEntity } from '../entities/agent-graph.entity';
import { AgentEgressEventEntity } from '../entities/agent-egress-event.entity';
import { WorkspaceConfigurationOverrideEntity } from '../entities/workspace-configuration-override.entity';
import { AgentsGateway } from '../gateways/agents.gateway';
import { VncGateway } from '../gateways/vnc.gateway';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { OpenCodeAgentProvider } from '../providers/agents/opencode-agent.provider';
import { OpenCodeClientFactory } from '../providers/opencode/opencode-client.factory';
import { OpenCodeConfigSyncService } from '../providers/opencode/opencode-config-sync.service';
import { OpenCodeEventBridge } from '../providers/opencode/opencode-event-bridge';
import { OpenCodeEventMapper } from '../providers/opencode/opencode-event-mapper';
import { OpenCodePtyService } from '../providers/opencode/opencode-pty.service';
import { OpenCodeRuntimeService } from '../providers/opencode/opencode-runtime.service';
import { OpenCodeSessionService } from '../providers/opencode/opencode-session.service';
import {
  NoopOutboundAgentEventPublisher,
  OutboundAgentEventPublisher,
} from '../providers/outbound-agent-event-publisher';
import { ChatFilterFactory } from '../providers/chat-filter.factory';
import { BidirectionalChatFilter } from '../providers/filters/bidirectional-chat-filter';
import { IncomingChatFilter } from '../providers/filters/incoming-chat-filter';
import { MessageFiltersIncomingChatFilter } from '../providers/filters/message-filters-incoming-chat-filter';
import { MessageFiltersOutgoingChatFilter } from '../providers/filters/message-filters-outgoing-chat-filter';
import { NoopChatFilter } from '../providers/filters/noop-chat-filter';
import { OutgoingChatFilter } from '../providers/filters/outgoing-chat-filter';
import { AgenstraManagerMetricsCollectorService } from '../services/agenstra-manager-metrics-collector.service';
import type { ChatFilter } from '../providers/chat-filter.interface';
import { AgentChatSessionsRepository } from '../repositories/agent-chat-sessions.repository';
import { AgentEnvironmentVariablesRepository } from '../repositories/agent-environment-variables.repository';
import { AgentMessageEventsRepository } from '../repositories/agent-message-events.repository';
import { AgentMessagesRepository } from '../repositories/agent-messages.repository';
import { AgentsRepository } from '../repositories/agents.repository';
import { AgentEgressEventsRepository } from '../repositories/agent-egress-events.repository';
import { WorkspaceConfigurationOverridesRepository } from '../repositories/workspace-configuration-overrides.repository';
import { AgentChatSessionsService } from '../services/agent-chat-sessions.service';
import { AgentContextAccessService } from '../services/agent-context-access.service';
import { AgentContextApiService } from '../services/agent-context-api.service';
import { AgentContextChangesService } from '../services/agent-context-changes.service';
import { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentContextTicketsService } from '../services/agent-context-tickets.service';
import { AgentTasksApiService } from '../services/agent-tasks-api.service';
import { AgentDeploymentActionsService } from '../services/agent-deployment-actions.service';
import { AgentDeploymentsApiService } from '../services/agent-deployments-api.service';
import { AgentHandoffsApiService } from '../services/agent-handoffs-api.service';
import { AgentWorkspaceMountsService } from '../services/agent-workspace-mounts.service';
import { AgentGraphAccessService } from '../services/agent-graph-access.service';
import { AgentGraphCollectorService } from '../services/agent-graph-collector.service';
import { AgentGraphReferencesService } from '../services/agent-graph-references.service';
import { AgentGraphService } from '../services/agent-graph.service';
import { AgentGraphPromptsRepository } from '../repositories/agent-graph-prompts.repository';
import { AgentGraphsRepository } from '../repositories/agent-graphs.repository';
import { AgentActiveTurnsService } from '../services/agent-active-turns.service';
import { AgentToolCallsService } from '../services/agent-tool-calls.service';
import { AgentEnvironmentVariablesService } from '../services/agent-environment-variables.service';
import { AgentFileSystemService } from '../services/agent-file-system.service';
import { AgentDirectoryIndexService } from '../services/agent-directory-index.service';
import { AgentGitStateBroadcastService } from '../services/agent-git-state-broadcast.service';
import { AgentMessageEventsService } from '../services/agent-message-events.service';
import { AgentMessagesService } from '../services/agent-messages.service';
import { AgentGitCredentialsService } from '../services/agent-git-credentials.service';
import { AgentRuntimeRefreshService } from '../services/agent-runtime-refresh.service';
import { AgentSessionHydrationService } from '../services/agent-session-hydration.service';
import { AgentEgressEventsCollectorService } from '../services/agent-egress-events-collector.service';
import { AgentEgressService } from '../services/agent-egress.service';
import { AgentMessageFiltersService } from '../services/agent-message-filters.service';
import { AgentsVcsService } from '../services/agents-vcs.service';
import { AgentsVerificationService } from '../services/agents-verification.service';
import { AgentsService } from '../services/agents.service';
import { ConfigService } from '../services/config.service';
import { InstanceStatusService } from '../services/instance-status.service';
import { IsolationCapabilitiesService } from '../services/isolation-capabilities.service';
import { DockerService } from '../services/docker.service';
import { EnvironmentProgressService } from '../services/environment-progress.service';
import { PromptContextComposerService } from '../services/prompt-context-composer.service';
import { VncBridgeService } from '../services/vnc-bridge.service';
import { VncSessionsService } from '../services/vnc-sessions.service';
import { VncTicketService } from '../services/vnc-ticket.service';
import { WorkspaceConfigurationOverridesService } from '../services/workspace-configuration-overrides.service';
import { WorkspaceChangeNotifierService } from '../services/workspace-change-notifier.service';
import { WorkspaceInotifySupervisor } from '../services/workspace-inotify-supervisor.service';

/**
 * Module for agent management feature.
 * Provides controllers, services, and repository for agent CRUD operations and file system operations.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentEntity,
      AgentDirectoryIndexEntity,
      AgentGraphEntity,
      AgentGraphPromptEntity,
      AgentMessageEntity,
      AgentMessageEventEntity,
      AgentChatSessionEntity,
      AgentEnvironmentVariableEntity,
      AgentEgressEventEntity,
      WorkspaceConfigurationOverrideEntity,
    ]),
  ],
  controllers: [
    AgentsController,
    AgentsOpencodeConfigController,
    AgentsOpencodeMcpController,
    AgentsPermissionsController,
    AgentsMessagesController,
    AgentsFilesController,
    AgentsSystemFilesController,
    AgentsWorkspaceIndexController,
    AgentsVcsController,
    AgentsVerificationController,
    AgentsVncController,
    AgentsEnvironmentVariablesController,
    AgentsChatSessionsController,
    AgentsContextController,
    AgentsTasksController,
    AgentsHandoffsController,
    AgentsContextDeploymentsController,
    AgentsGraphController,
    AgentGraphsComposeController,
    AgentsGraphContextController,
    AgentsEgressController,
    ConfigController,
    IsolationController,
    InstanceStatusController,
    WorkspaceConfigurationOverridesController,
  ],
  providers: [
    AgenstraManagerMetricsCollectorService,
    AgentsGateway,
    VncGateway,
    VncTicketService,
    VncBridgeService,
    VncSessionsService,
    AgentsService,
    AgentMessagesService,
    PromptContextComposerService,
    AgentContextTicketsService,
    AgentContextAccessService,
    AgentContextMcpService,
    AgentContextApiService,
    AgentContextChangesService,
    AgentTasksApiService,
    AgentHandoffsApiService,
    AgentDeploymentsApiService,
    AgentDeploymentActionsService,
    AgentWorkspaceMountsService,
    AgentGraphService,
    AgentGraphCollectorService,
    AgentGraphReferencesService,
    AgentGraphAccessService,
    AgentGraphsRepository,
    AgentGraphPromptsRepository,
    AgentActiveTurnsService,
    AgentToolCallsService,
    AgentMessageEventsService,
    AgentSessionHydrationService,
    AgentChatSessionsService,
    AgentEnvironmentVariablesService,
    AgentGitStateBroadcastService,
    EnvironmentProgressService,
    AgentFileSystemService,
    AgentDirectoryIndexService,
    AgentsVcsService,
    WorkspaceChangeNotifierService,
    WorkspaceInotifySupervisor,
    AgentRuntimeRefreshService,
    AgentGitCredentialsService,
    AgentsVerificationService,
    ConfigService,
    IsolationCapabilitiesService,
    InstanceStatusService,
    PasswordService,
    AgentsRepository,
    AgentMessagesRepository,
    AgentMessageEventsRepository,
    AgentChatSessionsRepository,
    AgentEnvironmentVariablesRepository,
    DockerService,
    OpenCodeClientFactory,
    OpenCodeSessionService,
    OpenCodeEventBridge,
    OpenCodeEventMapper,
    OpenCodeRuntimeService,
    OpenCodePtyService,
    OpenCodeConfigSyncService,
    { provide: OutboundAgentEventPublisher, useClass: NoopOutboundAgentEventPublisher },
    AgentProviderFactory,
    OpenCodeAgentProvider,
    ChatFilterFactory,
    NoopChatFilter,
    IncomingChatFilter,
    OutgoingChatFilter,
    BidirectionalChatFilter,
    AgentMessageFiltersService,
    AgentEgressService,
    AgentEgressEventsRepository,
    AgentEgressEventsCollectorService,
    WorkspaceConfigurationOverridesRepository,
    WorkspaceConfigurationOverridesService,
    MessageFiltersIncomingChatFilter,
    MessageFiltersOutgoingChatFilter,
    DynamicProviderLoaderService,
    {
      provide: 'AGENT_PROVIDER_INIT',
      useFactory: (factory: AgentProviderFactory, opencodeProvider: OpenCodeAgentProvider) => {
        // OpenCode is the only supported harness; do not load DYNAMIC_AGENT_PROVIDERS.
        factory.registerProvider(opencodeProvider);
        return true;
      },
      inject: [AgentProviderFactory, OpenCodeAgentProvider],
    },
    {
      provide: 'CHAT_FILTER_INIT',
      useFactory: async (
        factory: ChatFilterFactory,
        noopFilter: NoopChatFilter,
        incomingFilter: IncomingChatFilter,
        outgoingFilter: OutgoingChatFilter,
        bidirectionalFilter: BidirectionalChatFilter,
        messageFiltersIncoming: MessageFiltersIncomingChatFilter,
        messageFiltersOutgoing: MessageFiltersOutgoingChatFilter,
        dynamicLoader: DynamicProviderLoaderService,
      ) => {
        factory.registerFilter(noopFilter);
        factory.registerFilter(incomingFilter);
        factory.registerFilter(outgoingFilter);
        factory.registerFilter(bidirectionalFilter);
        factory.registerFilter(messageFiltersIncoming);
        factory.registerFilter(messageFiltersOutgoing);

        await registerDynamicProviders<ChatFilter>({
          envKey: 'DYNAMIC_CHAT_FILTERS',
          criticality: 'optional',
          register: (filter) => factory.registerFilter(filter),
          dynamicLoader,
          loggerContext: 'ChatFilterFactory',
        });

        return true;
      },
      inject: [
        ChatFilterFactory,
        NoopChatFilter,
        IncomingChatFilter,
        OutgoingChatFilter,
        BidirectionalChatFilter,
        MessageFiltersIncomingChatFilter,
        MessageFiltersOutgoingChatFilter,
        DynamicProviderLoaderService,
      ],
    },
  ],
  exports: [
    AgentsService,
    EnvironmentProgressService,
    AgentChatSessionsService,
    AgentEnvironmentVariablesService,
    AgentMessagesService,
    AgentsRepository,
    AgentChatSessionsRepository,
    AgentEnvironmentVariablesRepository,
    AgentMessagesRepository,
  ],
})
export class AgentsModule {}
