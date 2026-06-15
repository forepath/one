import { AgentEntity } from './agent.entity';
import { DeploymentConfigurationEntity } from './deployment-configuration.entity';

describe('DeploymentConfigurationEntity', () => {
  it('should create an instance', () => {
    const config = new DeploymentConfigurationEntity();

    expect(config).toBeDefined();
  });

  it('should have all required properties', () => {
    const config = new DeploymentConfigurationEntity();

    config.id = 'test-uuid';
    config.agentId = 'agent-uuid-123';
    config.providerType = 'github';
    config.repositoryId = 'owner/repo';
    config.providerToken = 'encrypted-token-value';
    config.createdAt = new Date();
    config.updatedAt = new Date();

    expect(config.id).toBe('test-uuid');
    expect(config.agentId).toBe('agent-uuid-123');
    expect(config.providerType).toBe('github');
    expect(config.repositoryId).toBe('owner/repo');
    expect(config.providerToken).toBe('encrypted-token-value');
    expect(config.createdAt).toBeInstanceOf(Date);
    expect(config.updatedAt).toBeInstanceOf(Date);
  });

  it('should support optional defaultBranch property', () => {
    const config = new DeploymentConfigurationEntity();

    config.id = 'test-uuid';
    config.agentId = 'agent-uuid-123';
    config.providerType = 'github';
    config.repositoryId = 'owner/repo';
    config.defaultBranch = 'main';
    config.providerToken = 'encrypted-token-value';
    config.createdAt = new Date();
    config.updatedAt = new Date();

    expect(config.defaultBranch).toBe('main');
  });

  it('should support optional workflowId property', () => {
    const config = new DeploymentConfigurationEntity();

    config.id = 'test-uuid';
    config.agentId = 'agent-uuid-123';
    config.providerType = 'github';
    config.repositoryId = 'owner/repo';
    config.workflowId = 'workflow-123';
    config.providerToken = 'encrypted-token-value';
    config.createdAt = new Date();
    config.updatedAt = new Date();

    expect(config.workflowId).toBe('workflow-123');
  });

  it('should support optional providerBaseUrl property', () => {
    const config = new DeploymentConfigurationEntity();

    config.id = 'test-uuid';
    config.agentId = 'agent-uuid-123';
    config.providerType = 'github';
    config.repositoryId = 'owner/repo';
    config.providerBaseUrl = 'https://github.enterprise.com';
    config.providerToken = 'encrypted-token-value';
    config.createdAt = new Date();
    config.updatedAt = new Date();

    expect(config.providerBaseUrl).toBe('https://github.enterprise.com');
  });

  it('should allow undefined optional properties', () => {
    const config = new DeploymentConfigurationEntity();

    config.id = 'test-uuid';
    config.agentId = 'agent-uuid-123';
    config.providerType = 'github';
    config.repositoryId = 'owner/repo';
    config.providerToken = 'encrypted-token-value';
    config.createdAt = new Date();
    config.updatedAt = new Date();

    expect(config.defaultBranch).toBeUndefined();
    expect(config.workflowId).toBeUndefined();
    expect(config.providerBaseUrl).toBeUndefined();
  });

  it('should support relationship to AgentEntity', () => {
    const agent = new AgentEntity();

    agent.id = 'agent-uuid-123';
    agent.name = 'Test Agent';
    agent.hashedPassword = 'hashed-password';
    agent.createdAt = new Date();
    agent.updatedAt = new Date();

    const config = new DeploymentConfigurationEntity();

    config.id = 'test-uuid';
    config.agentId = 'agent-uuid-123';
    config.agent = agent;
    config.providerType = 'github';
    config.repositoryId = 'owner/repo';
    config.providerToken = 'encrypted-token-value';
    config.createdAt = new Date();
    config.updatedAt = new Date();

    expect(config.agent).toBe(agent);
    expect(config.agent.id).toBe('agent-uuid-123');
    expect(config.agent.name).toBe('Test Agent');
  });

  it('should support GitHub provider type', () => {
    const config = new DeploymentConfigurationEntity();

    config.id = 'test-uuid';
    config.agentId = 'agent-uuid-123';
    config.providerType = 'github';
    config.repositoryId = 'owner/repo';
    config.providerToken = 'encrypted-token-value';
    config.createdAt = new Date();
    config.updatedAt = new Date();

    expect(config.providerType).toBe('github');
  });

  it('should support GitLab provider type', () => {
    const config = new DeploymentConfigurationEntity();

    config.id = 'test-uuid';
    config.agentId = 'agent-uuid-123';
    config.providerType = 'gitlab';
    config.repositoryId = 'group/project';
    config.providerToken = 'encrypted-token-value';
    config.createdAt = new Date();
    config.updatedAt = new Date();

    expect(config.providerType).toBe('gitlab');
  });

  it('should store full configuration with all optional fields', () => {
    const config = new DeploymentConfigurationEntity();

    config.id = 'test-uuid';
    config.agentId = 'agent-uuid-123';
    config.providerType = 'github';
    config.repositoryId = 'owner/repo';
    config.defaultBranch = 'main';
    config.workflowId = 'workflow-123';
    config.providerToken = 'encrypted-token-value';
    config.providerBaseUrl = 'https://github.enterprise.com';
    config.createdAt = new Date();
    config.updatedAt = new Date();

    expect(config.id).toBe('test-uuid');
    expect(config.agentId).toBe('agent-uuid-123');
    expect(config.providerType).toBe('github');
    expect(config.repositoryId).toBe('owner/repo');
    expect(config.defaultBranch).toBe('main');
    expect(config.workflowId).toBe('workflow-123');
    expect(config.providerToken).toBe('encrypted-token-value');
    expect(config.providerBaseUrl).toBe('https://github.enterprise.com');
    expect(config.createdAt).toBeInstanceOf(Date);
    expect(config.updatedAt).toBeInstanceOf(Date);
  });

  it('should handle long repository ID', () => {
    const config = new DeploymentConfigurationEntity();

    config.id = 'test-uuid';
    config.agentId = 'agent-uuid-123';
    config.providerType = 'github';
    config.repositoryId = 'organization-with-long-name/repository-with-very-long-name-that-could-exist';
    config.providerToken = 'encrypted-token-value';
    config.createdAt = new Date();
    config.updatedAt = new Date();

    expect(config.repositoryId).toBe('organization-with-long-name/repository-with-very-long-name-that-could-exist');
  });

  it('should handle long provider token', () => {
    const longToken = 'ghp_' + 'A'.repeat(2000);
    const config = new DeploymentConfigurationEntity();

    config.id = 'test-uuid';
    config.agentId = 'agent-uuid-123';
    config.providerType = 'github';
    config.repositoryId = 'owner/repo';
    config.providerToken = longToken;
    config.createdAt = new Date();
    config.updatedAt = new Date();

    expect(config.providerToken).toBe(longToken);
    expect(config.providerToken.length).toBe(2004);
  });
});
