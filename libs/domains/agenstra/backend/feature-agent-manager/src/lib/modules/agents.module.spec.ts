import { PasswordService } from '@forepath/identity/backend';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AgentsDeploymentsController } from '../controllers/agents-deployments.controller';
import { AgentsMessagesController } from '../controllers/agents-messages.controller';
import { AgentsController } from '../controllers/agents.controller';
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
import { GitHubProvider } from '../providers/pipelines/github.provider';
import { GitLabProvider } from '../providers/pipelines/gitlab.provider';
import { AgentEnvironmentVariablesRepository } from '../repositories/agent-environment-variables.repository';
import { AgentMessagesRepository } from '../repositories/agent-messages.repository';
import { AgentsRepository } from '../repositories/agents.repository';
import { DeploymentConfigurationsRepository } from '../repositories/deployment-configurations.repository';
import { DeploymentRunsRepository } from '../repositories/deployment-runs.repository';
import { AgentEnvironmentVariablesService } from '../services/agent-environment-variables.service';
import { AgentMessagesService } from '../services/agent-messages.service';
import { AgentsService } from '../services/agents.service';
import { DeploymentsService } from '../services/deployments.service';
import { DockerService } from '../services/docker.service';

import { AgentsModule } from './agents.module';

describe('AgentsModule', () => {
  let module: TestingModule;
  const mockRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    count: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [AgentsModule],
    })
      .overrideProvider(getRepositoryToken(AgentEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(AgentMessageEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(AgentEnvironmentVariableEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(AgentMessageEventEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(DeploymentConfigurationEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(DeploymentRunEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(RegexFilterRuleEntity))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(WorkspaceConfigurationOverrideEntity))
      .useValue(mockRepository)
      .compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should provide AgentsService', () => {
    const service = module.get<AgentsService>(AgentsService);

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(AgentsService);
  });

  it('should provide AgentsRepository', () => {
    const repository = module.get<AgentsRepository>(AgentsRepository);

    expect(repository).toBeDefined();
    expect(repository).toBeInstanceOf(AgentsRepository);
  });

  it('should provide PasswordService', () => {
    const service = module.get<PasswordService>(PasswordService);

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(PasswordService);
  });

  it('should provide DockerService', () => {
    const service = module.get<DockerService>(DockerService);

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(DockerService);
  });

  it('should provide AgentsController', () => {
    const controller = module.get<AgentsController>(AgentsController);

    expect(controller).toBeDefined();
    expect(controller).toBeInstanceOf(AgentsController);
  });

  it('should provide AgentsMessagesController', () => {
    const controller = module.get<AgentsMessagesController>(AgentsMessagesController);

    expect(controller).toBeDefined();
    expect(controller).toBeInstanceOf(AgentsMessagesController);
  });

  it('should provide AgentsGateway', () => {
    const gateway = module.get<AgentsGateway>(AgentsGateway);

    expect(gateway).toBeDefined();
    expect(gateway).toBeInstanceOf(AgentsGateway);
  });

  it('should export AgentsService', () => {
    const service = module.get<AgentsService>(AgentsService);

    expect(service).toBeDefined();
  });

  it('should export AgentsRepository', () => {
    const repository = module.get<AgentsRepository>(AgentsRepository);

    expect(repository).toBeDefined();
  });

  it('should provide AgentProviderFactory', () => {
    const factory = module.get<AgentProviderFactory>(AgentProviderFactory);

    expect(factory).toBeDefined();
    expect(factory).toBeInstanceOf(AgentProviderFactory);
  });

  it('should provide CursorAgentProvider', () => {
    const provider = module.get<CursorAgentProvider>(CursorAgentProvider);

    expect(provider).toBeDefined();
    expect(provider).toBeInstanceOf(CursorAgentProvider);
  });

  it('should provide OpenCodeAgentProvider', () => {
    const provider = module.get<OpenCodeAgentProvider>(OpenCodeAgentProvider);

    expect(provider).toBeDefined();
    expect(provider).toBeInstanceOf(OpenCodeAgentProvider);
  });

  it('should provide OpenClawAgentProvider', () => {
    const provider = module.get<OpenClawAgentProvider>(OpenClawAgentProvider);

    expect(provider).toBeDefined();
    expect(provider).toBeInstanceOf(OpenClawAgentProvider);
  });

  it('should register CursorAgentProvider and OpenCodeAgentProvider via AGENT_PROVIDER_INIT factory', () => {
    const factory = module.get<AgentProviderFactory>(AgentProviderFactory);
    const cursorProvider = module.get<CursorAgentProvider>(CursorAgentProvider);
    const opencodeProvider = module.get<OpenCodeAgentProvider>(OpenCodeAgentProvider);

    // Verify the provider is registered
    expect(factory.hasProvider('cursor')).toBe(true);
    expect(factory.getProvider('cursor')).toBe(cursorProvider);
    expect(cursorProvider.getType()).toBe('cursor');

    expect(factory.hasProvider('opencode')).toBe(true);
    expect(factory.getProvider('opencode')).toBe(opencodeProvider);
    expect(opencodeProvider.getType()).toBe('opencode');
  });

  it('should initialize AGENT_PROVIDER_INIT factory', () => {
    const initValue = module.get<boolean>('AGENT_PROVIDER_INIT');

    expect(initValue).toBe(true);
  });

  it('should provide ChatFilterFactory', () => {
    const factory = module.get<ChatFilterFactory>(ChatFilterFactory);

    expect(factory).toBeDefined();
    expect(factory).toBeInstanceOf(ChatFilterFactory);
  });

  it('should provide NoopChatFilter', () => {
    const filter = module.get<NoopChatFilter>(NoopChatFilter);

    expect(filter).toBeDefined();
    expect(filter).toBeInstanceOf(NoopChatFilter);
  });

  it('should provide IncomingChatFilter', () => {
    const filter = module.get<IncomingChatFilter>(IncomingChatFilter);

    expect(filter).toBeDefined();
    expect(filter).toBeInstanceOf(IncomingChatFilter);
  });

  it('should provide OutgoingChatFilter', () => {
    const filter = module.get<OutgoingChatFilter>(OutgoingChatFilter);

    expect(filter).toBeDefined();
    expect(filter).toBeInstanceOf(OutgoingChatFilter);
  });

  it('should provide BidirectionalChatFilter', () => {
    const filter = module.get<BidirectionalChatFilter>(BidirectionalChatFilter);

    expect(filter).toBeDefined();
    expect(filter).toBeInstanceOf(BidirectionalChatFilter);
  });

  it('should register all filters via CHAT_FILTER_INIT factory', () => {
    const factory = module.get<ChatFilterFactory>(ChatFilterFactory);
    const noopFilter = module.get<NoopChatFilter>(NoopChatFilter);
    const incomingFilter = module.get<IncomingChatFilter>(IncomingChatFilter);
    const outgoingFilter = module.get<OutgoingChatFilter>(OutgoingChatFilter);
    const bidirectionalFilter = module.get<BidirectionalChatFilter>(BidirectionalChatFilter);

    // Verify all filters are registered
    expect(factory.hasFilter('noop')).toBe(true);
    expect(factory.getFilter('noop')).toBe(noopFilter);
    expect(noopFilter.getType()).toBe('noop');

    expect(factory.hasFilter('incoming-example')).toBe(true);
    expect(factory.getFilter('incoming-example')).toBe(incomingFilter);
    expect(incomingFilter.getType()).toBe('incoming-example');

    expect(factory.hasFilter('outgoing-example')).toBe(true);
    expect(factory.getFilter('outgoing-example')).toBe(outgoingFilter);
    expect(outgoingFilter.getType()).toBe('outgoing-example');

    expect(factory.hasFilter('bidirectional-example')).toBe(true);
    expect(factory.getFilter('bidirectional-example')).toBe(bidirectionalFilter);
    expect(bidirectionalFilter.getType()).toBe('bidirectional-example');

    const dbIn = module.get(DatabaseRegexIncomingChatFilter);
    const dbOut = module.get(DatabaseRegexOutgoingChatFilter);

    expect(factory.hasFilter('database-regex-incoming')).toBe(true);
    expect(factory.getFilter('database-regex-incoming')).toBe(dbIn);
    expect(factory.hasFilter('database-regex-outgoing')).toBe(true);
    expect(factory.getFilter('database-regex-outgoing')).toBe(dbOut);
  });

  it('should initialize CHAT_FILTER_INIT factory', () => {
    const initValue = module.get<boolean>('CHAT_FILTER_INIT');

    expect(initValue).toBe(true);
  });

  it('should provide DeploymentsService', () => {
    const service = module.get<DeploymentsService>(DeploymentsService);

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(DeploymentsService);
  });

  it('should provide DeploymentConfigurationsRepository', () => {
    const repository = module.get<DeploymentConfigurationsRepository>(DeploymentConfigurationsRepository);

    expect(repository).toBeDefined();
    expect(repository).toBeInstanceOf(DeploymentConfigurationsRepository);
  });

  it('should provide DeploymentRunsRepository', () => {
    const repository = module.get<DeploymentRunsRepository>(DeploymentRunsRepository);

    expect(repository).toBeDefined();
    expect(repository).toBeInstanceOf(DeploymentRunsRepository);
  });

  it('should provide PipelineProviderFactory', () => {
    const factory = module.get<PipelineProviderFactory>(PipelineProviderFactory);

    expect(factory).toBeDefined();
    expect(factory).toBeInstanceOf(PipelineProviderFactory);
  });

  it('should provide AgentEnvironmentVariablesService', () => {
    const service = module.get<AgentEnvironmentVariablesService>(AgentEnvironmentVariablesService);

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(AgentEnvironmentVariablesService);
  });

  it('should provide AgentEnvironmentVariablesRepository', () => {
    const repository = module.get<AgentEnvironmentVariablesRepository>(AgentEnvironmentVariablesRepository);

    expect(repository).toBeDefined();
    expect(repository).toBeInstanceOf(AgentEnvironmentVariablesRepository);
  });

  it('should provide AgentMessagesService', () => {
    const service = module.get<AgentMessagesService>(AgentMessagesService);

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(AgentMessagesService);
  });

  it('should provide AgentMessagesRepository', () => {
    const repository = module.get<AgentMessagesRepository>(AgentMessagesRepository);

    expect(repository).toBeDefined();
    expect(repository).toBeInstanceOf(AgentMessagesRepository);
  });

  it('should provide GitHubProvider', () => {
    const provider = module.get<GitHubProvider>(GitHubProvider);

    expect(provider).toBeDefined();
    expect(provider).toBeInstanceOf(GitHubProvider);
  });

  it('should provide GitLabProvider', () => {
    const provider = module.get<GitLabProvider>(GitLabProvider);

    expect(provider).toBeDefined();
    expect(provider).toBeInstanceOf(GitLabProvider);
  });

  it('should register GitHubProvider and GitLabProvider via PIPELINE_PROVIDER_INIT factory', () => {
    const factory = module.get<PipelineProviderFactory>(PipelineProviderFactory);
    const githubProvider = module.get<GitHubProvider>(GitHubProvider);
    const gitlabProvider = module.get<GitLabProvider>(GitLabProvider);

    // Verify the providers are registered
    expect(factory.hasProvider('github')).toBe(true);
    expect(factory.getProvider('github')).toBe(githubProvider);
    expect(githubProvider.getType()).toBe('github');

    expect(factory.hasProvider('gitlab')).toBe(true);
    expect(factory.getProvider('gitlab')).toBe(gitlabProvider);
    expect(gitlabProvider.getType()).toBe('gitlab');
  });

  it('should initialize PIPELINE_PROVIDER_INIT factory', () => {
    const initValue = module.get<boolean>('PIPELINE_PROVIDER_INIT');

    expect(initValue).toBe(true);
  });

  it('should provide AgentsDeploymentsController', () => {
    const controller = module.get<AgentsDeploymentsController>(AgentsDeploymentsController);

    expect(controller).toBeDefined();
    expect(controller).toBeInstanceOf(AgentsDeploymentsController);
  });

  it('should export DeploymentsService', () => {
    const service = module.get<DeploymentsService>(DeploymentsService);

    expect(service).toBeDefined();
  });

  it('should export DeploymentConfigurationsRepository', () => {
    const repository = module.get<DeploymentConfigurationsRepository>(DeploymentConfigurationsRepository);

    expect(repository).toBeDefined();
  });

  it('should export DeploymentRunsRepository', () => {
    const repository = module.get<DeploymentRunsRepository>(DeploymentRunsRepository);

    expect(repository).toBeDefined();
  });
});
