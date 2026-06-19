import { PasswordService } from '@forepath/identity/backend';
import {
  AGENT_PROVIDER_REGISTRY,
  AgentProvider,
  CHAT_FILTER_REGISTRY,
  ChatFilter,
  PIPELINE_PROVIDER_REGISTRY,
  PipelineProvider,
  ProviderRegistry,
} from '@forepath/agenstra/backend/util-plugin-host';
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

  it('should provide agent provider registry with default providers', () => {
    const registry = module.get<ProviderRegistry<AgentProvider>>(AGENT_PROVIDER_REGISTRY);

    expect(registry).toBeDefined();
    expect(registry.hasProvider('cursor')).toBe(true);
    expect(registry.hasProvider('opencode')).toBe(true);
    expect(registry.hasProvider('openclaw')).toBe(true);
    expect(registry.getProvider('cursor').getType()).toBe('cursor');
  });

  it('should provide chat filter registry with default filters', () => {
    const registry = module.get<ProviderRegistry<ChatFilter>>(CHAT_FILTER_REGISTRY);

    expect(registry).toBeDefined();
    expect(registry.hasProvider('noop')).toBe(true);
    expect(registry.hasProvider('incoming-example')).toBe(true);
    expect(registry.hasProvider('outgoing-example')).toBe(true);
    expect(registry.hasProvider('bidirectional-example')).toBe(true);
    expect(registry.hasProvider('database-regex-incoming')).toBe(true);
    expect(registry.hasProvider('database-regex-outgoing')).toBe(true);
  });

  it('should provide pipeline provider registry with default providers', () => {
    const registry = module.get<ProviderRegistry<PipelineProvider>>(PIPELINE_PROVIDER_REGISTRY);

    expect(registry).toBeDefined();
    expect(registry.hasProvider('github')).toBe(true);
    expect(registry.hasProvider('gitlab')).toBe(true);
    expect(registry.getProvider('github').getType()).toBe('github');
    expect(registry.getProvider('gitlab').getType()).toBe('gitlab');
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
