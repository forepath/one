import { PasswordService } from '@forepath/identity/backend';
import {
  AGENSTRA_EXTENSION_KINDS,
  AgentProviderDepsModule,
  AGENT_PROVIDER_REGISTRY,
  AgenstraPluginHostModule,
  CHAT_FILTER_REGISTRY,
  ChatFilterDepsModule,
  PIPELINE_PROVIDER_REGISTRY,
} from '@forepath/agenstra/backend/util-plugin-host';
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
import { ConfigService } from '../services/config.service';
import { DeploymentsService } from '../services/deployments.service';
import { DockerService } from '../services/docker.service';
import { PromptContextComposerService } from '../services/prompt-context-composer.service';
import { RegexFilterRulesCacheService } from '../services/regex-filter-rules-cache.service';
import { RegexFilterRulesEvaluateService } from '../services/regex-filter-rules-evaluate.service';
import { WorkspaceConfigurationOverridesService } from '../services/workspace-configuration-overrides.service';

const DEFAULT_AGENT_PROVIDERS = [
  '@forepath/agenstra/backend/provider-cursor',
  '@forepath/agenstra/backend/provider-opencode',
  '@forepath/agenstra/backend/provider-openclaw',
] as const;

const DEFAULT_PIPELINE_PROVIDERS = [
  '@forepath/agenstra/backend/provider-github-pipeline',
  '@forepath/agenstra/backend/provider-gitlab-pipeline',
] as const;

const DEFAULT_CHAT_FILTERS = [
  '@forepath/agenstra/backend/provider-chat-filter-noop',
  '@forepath/agenstra/backend/provider-chat-filter-incoming',
  '@forepath/agenstra/backend/provider-chat-filter-outgoing',
  '@forepath/agenstra/backend/provider-chat-filter-bidirectional',
  '@forepath/agenstra/backend/provider-chat-filter-db-regex-incoming',
  '@forepath/agenstra/backend/provider-chat-filter-db-regex-outgoing',
] as const;

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
    AgentProviderDepsModule.forRoot({
      providers: [DockerService],
      exports: [DockerService],
    }),
    ChatFilterDepsModule.forRoot({
      imports: [TypeOrmModule.forFeature([RegexFilterRuleEntity])],
      providers: [RegexFilterRulesRepository, RegexFilterRulesCacheService, RegexFilterRulesEvaluateService],
      exports: [RegexFilterRulesEvaluateService],
    }),
    AgenstraPluginHostModule.forRootAsync({
      kind: AGENSTRA_EXTENSION_KINDS.AGENT_PROVIDER,
      registryToken: AGENT_PROVIDER_REGISTRY,
      extensionsEnvKey: 'AGENSTRA_AGENT_PROVIDER_EXTENSIONS',
      defaultExtensions: DEFAULT_AGENT_PROVIDERS,
    }),
    AgenstraPluginHostModule.forRootAsync({
      kind: AGENSTRA_EXTENSION_KINDS.PIPELINE_PROVIDER,
      registryToken: PIPELINE_PROVIDER_REGISTRY,
      extensionsEnvKey: 'AGENSTRA_PIPELINE_PROVIDER_EXTENSIONS',
      defaultExtensions: DEFAULT_PIPELINE_PROVIDERS,
    }),
    AgenstraPluginHostModule.forRootAsync({
      kind: AGENSTRA_EXTENSION_KINDS.CHAT_FILTER,
      registryToken: CHAT_FILTER_REGISTRY,
      extensionsEnvKey: 'AGENSTRA_CHAT_FILTER_EXTENSIONS',
      defaultExtensions: DEFAULT_CHAT_FILTERS,
    }),
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
    RegexFilterRulesRepository,
    RegexFilterRulesCacheService,
    RegexFilterRulesEvaluateService,
    AgentsFiltersService,
    WorkspaceConfigurationOverridesRepository,
    WorkspaceConfigurationOverridesService,
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
