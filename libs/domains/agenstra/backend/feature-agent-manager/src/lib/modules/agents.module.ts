import {
  DynamicProviderLoaderService,
  registerDynamicProviders,
} from '@forepath/shared/backend/util-dynamic-provider-registry';
import { PasswordService } from '@forepath/identity/backend';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AgentsDeploymentsController } from '../controllers/agents-deployments.controller';
import { AgentsEnvironmentVariablesController } from '../controllers/agents-environment-variables.controller';
import { AgentsFilesController } from '../controllers/agents-files.controller';
import { AgentsFiltersController } from '../controllers/agents-filters.controller';
import { AgentsMessagesController } from '../controllers/agents-messages.controller';
import { AgentsVcsController } from '../controllers/agents-vcs.controller';
import { AgentsVerificationController } from '../controllers/agents-verification.controller';
import { AgentsController } from '../controllers/agents.controller';
import { ConfigController } from '../controllers/config.controller';
import { WorkspaceConfigurationOverridesController } from '../controllers/workspace-configuration-overrides.controller';
import { AgentEnvironmentVariableEntity } from '../entities/agent-environment-variable.entity';
import { AgentMessageEventEntity } from '../entities/agent-message-event.entity';
import { AgentMessageEntity } from '../entities/agent-message.entity';
import { AgentEntity } from '../entities/agent.entity';
import { DeploymentConfigurationEntity } from '../entities/deployment-configuration.entity';
import { DeploymentRunEntity } from '../entities/deployment-run.entity';
import { RegexFilterRuleEntity } from '../entities/regex-filter-rule.entity';
import { WorkspaceConfigurationOverrideEntity } from '../entities/workspace-configuration-override.entity';
import { AgentsGateway } from '../gateways/agents.gateway';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import type { AgentProvider } from '../providers/agent-provider.interface';
import { CursorAgentProvider } from '../providers/agents/cursor-agent.provider';
import { OpenClawAgentProvider } from '../providers/agents/openclaw-agent.provider';
import { OpenCodeAgentProvider } from '../providers/agents/opencode-agent.provider';
import { ChatFilterFactory } from '../providers/chat-filter.factory';
import { BidirectionalChatFilter } from '../providers/filters/bidirectional-chat-filter';
import { DatabaseRegexIncomingChatFilter } from '../providers/filters/database-regex-incoming-chat-filter';
import { DatabaseRegexOutgoingChatFilter } from '../providers/filters/database-regex-outgoing-chat-filter';
import { IncomingChatFilter } from '../providers/filters/incoming-chat-filter';
import { NoopChatFilter } from '../providers/filters/noop-chat-filter';
import { OutgoingChatFilter } from '../providers/filters/outgoing-chat-filter';
import { PipelineProviderFactory } from '../providers/pipeline-provider.factory';
import type { PipelineProvider } from '../providers/pipeline-provider.interface';
import type { ChatFilter } from '../providers/chat-filter.interface';
import { GitHubProvider } from '../providers/pipelines/github.provider';
import { GitLabProvider } from '../providers/pipelines/gitlab.provider';
import { AgentEnvironmentVariablesRepository } from '../repositories/agent-environment-variables.repository';
import { AgentMessageEventsRepository } from '../repositories/agent-message-events.repository';
import { AgentMessagesRepository } from '../repositories/agent-messages.repository';
import { AgentsRepository } from '../repositories/agents.repository';
import { DeploymentConfigurationsRepository } from '../repositories/deployment-configurations.repository';
import { DeploymentRunsRepository } from '../repositories/deployment-runs.repository';
import { RegexFilterRulesRepository } from '../repositories/regex-filter-rules.repository';
import { WorkspaceConfigurationOverridesRepository } from '../repositories/workspace-configuration-overrides.repository';
import { AgentEnvironmentVariablesService } from '../services/agent-environment-variables.service';
import { AgentFileSystemService } from '../services/agent-file-system.service';
import { AgentGitStateBroadcastService } from '../services/agent-git-state-broadcast.service';
import { AgentMessageEventsService } from '../services/agent-message-events.service';
import { AgentMessagesService } from '../services/agent-messages.service';
import { AgentSessionHydrationService } from '../services/agent-session-hydration.service';
import { AgentsFiltersService } from '../services/agents-filters.service';
import { AgentsVcsService } from '../services/agents-vcs.service';
import { AgentsVerificationService } from '../services/agents-verification.service';
import { AgentsService } from '../services/agents.service';
import { BrowserPreviewService } from '../services/browser-preview.service';
import { ConfigService } from '../services/config.service';
import { DeploymentsService } from '../services/deployments.service';
import { DockerService } from '../services/docker.service';
import { PromptContextComposerService } from '../services/prompt-context-composer.service';
import { RegexFilterRulesCacheService } from '../services/regex-filter-rules-cache.service';
import { RegexFilterRulesEvaluateService } from '../services/regex-filter-rules-evaluate.service';
import { WorkspaceConfigurationOverridesService } from '../services/workspace-configuration-overrides.service';

/**
 * Module for agent management feature.
 * Provides controllers, services, and repository for agent CRUD operations and file system operations.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentEntity,
      AgentMessageEntity,
      AgentMessageEventEntity,
      AgentEnvironmentVariableEntity,
      DeploymentConfigurationEntity,
      DeploymentRunEntity,
      RegexFilterRuleEntity,
      WorkspaceConfigurationOverrideEntity,
    ]),
  ],
  controllers: [
    AgentsController,
    AgentsMessagesController,
    AgentsFilesController,
    AgentsVcsController,
    AgentsVerificationController,
    AgentsDeploymentsController,
    AgentsEnvironmentVariablesController,
    AgentsFiltersController,
    ConfigController,
    WorkspaceConfigurationOverridesController,
  ],
  providers: [
    AgentsGateway,
    AgentsService,
    BrowserPreviewService,
    AgentMessagesService,
    PromptContextComposerService,
    AgentMessageEventsService,
    AgentSessionHydrationService,
    AgentEnvironmentVariablesService,
    AgentGitStateBroadcastService,
    AgentFileSystemService,
    AgentsVcsService,
    AgentsVerificationService,
    ConfigService,
    PasswordService,
    DeploymentsService,
    AgentsRepository,
    AgentMessagesRepository,
    AgentMessageEventsRepository,
    AgentEnvironmentVariablesRepository,
    DeploymentConfigurationsRepository,
    DeploymentRunsRepository,
    DockerService,
    AgentProviderFactory,
    CursorAgentProvider,
    OpenCodeAgentProvider,
    OpenClawAgentProvider,
    PipelineProviderFactory,
    GitHubProvider,
    GitLabProvider,
    ChatFilterFactory,
    NoopChatFilter,
    IncomingChatFilter,
    OutgoingChatFilter,
    BidirectionalChatFilter,
    RegexFilterRulesRepository,
    RegexFilterRulesCacheService,
    RegexFilterRulesEvaluateService,
    AgentsFiltersService,
    WorkspaceConfigurationOverridesRepository,
    WorkspaceConfigurationOverridesService,
    DatabaseRegexIncomingChatFilter,
    DatabaseRegexOutgoingChatFilter,
    DynamicProviderLoaderService,
    {
      provide: 'AGENT_PROVIDER_INIT',
      useFactory: async (
        factory: AgentProviderFactory,
        cursorProvider: CursorAgentProvider,
        opencodeProvider: OpenCodeAgentProvider,
        openclawProvider: OpenClawAgentProvider,
        dynamicLoader: DynamicProviderLoaderService,
      ) => {
        factory.registerProvider(cursorProvider);
        factory.registerProvider(opencodeProvider);
        factory.registerProvider(openclawProvider);

        await registerDynamicProviders<AgentProvider>({
          envKey: 'DYNAMIC_AGENT_PROVIDERS',
          criticality: 'optional',
          register: (provider) => factory.registerProvider(provider),
          dynamicLoader,
          loggerContext: 'AgentProviderFactory',
        });

        return true;
      },
      inject: [
        AgentProviderFactory,
        CursorAgentProvider,
        OpenCodeAgentProvider,
        OpenClawAgentProvider,
        DynamicProviderLoaderService,
      ],
    },
    {
      provide: 'PIPELINE_PROVIDER_INIT',
      useFactory: async (
        factory: PipelineProviderFactory,
        githubProvider: GitHubProvider,
        gitlabProvider: GitLabProvider,
        dynamicLoader: DynamicProviderLoaderService,
      ) => {
        factory.registerProvider(githubProvider);
        factory.registerProvider(gitlabProvider);

        await registerDynamicProviders<PipelineProvider>({
          envKey: 'DYNAMIC_PIPELINE_PROVIDERS',
          criticality: 'optional',
          register: (provider) => factory.registerProvider(provider),
          dynamicLoader,
          loggerContext: 'PipelineProviderFactory',
        });

        return true;
      },
      inject: [PipelineProviderFactory, GitHubProvider, GitLabProvider, DynamicProviderLoaderService],
    },
    {
      provide: 'CHAT_FILTER_INIT',
      useFactory: async (
        factory: ChatFilterFactory,
        noopFilter: NoopChatFilter,
        incomingFilter: IncomingChatFilter,
        outgoingFilter: OutgoingChatFilter,
        bidirectionalFilter: BidirectionalChatFilter,
        dbIncoming: DatabaseRegexIncomingChatFilter,
        dbOutgoing: DatabaseRegexOutgoingChatFilter,
        dynamicLoader: DynamicProviderLoaderService,
      ) => {
        factory.registerFilter(noopFilter);
        factory.registerFilter(incomingFilter);
        factory.registerFilter(outgoingFilter);
        factory.registerFilter(bidirectionalFilter);
        factory.registerFilter(dbIncoming);
        factory.registerFilter(dbOutgoing);

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
        DatabaseRegexIncomingChatFilter,
        DatabaseRegexOutgoingChatFilter,
        DynamicProviderLoaderService,
      ],
    },
  ],
  exports: [
    AgentsService,
    AgentEnvironmentVariablesService,
    AgentMessagesService,
    DeploymentsService,
    AgentsRepository,
    AgentEnvironmentVariablesRepository,
    AgentMessagesRepository,
    DeploymentConfigurationsRepository,
    DeploymentRunsRepository,
  ],
})
export class AgentsModule {}
