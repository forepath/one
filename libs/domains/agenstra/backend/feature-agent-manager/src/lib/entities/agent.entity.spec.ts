import { GitRepositorySetupMode } from '../constants/git-repository-setup-mode';

import { AgentEntity } from './agent.entity';

describe('AgentEntity', () => {
  it('should create an instance', () => {
    const agent = new AgentEntity();

    expect(agent).toBeDefined();
  });

  it('should have all required properties', () => {
    const agent = new AgentEntity();

    agent.id = 'test-uuid';
    agent.name = 'Test Agent';
    agent.description = 'Test Description';
    agent.hashedPassword = 'hashed-password';
    agent.containerId = 'container-id-123';
    agent.gitRepositoryUrl = 'https://github.com/user/repo.git';
    agent.createdAt = new Date();
    agent.updatedAt = new Date();

    expect(agent.id).toBe('test-uuid');
    expect(agent.name).toBe('Test Agent');
    expect(agent.description).toBe('Test Description');
    expect(agent.hashedPassword).toBe('hashed-password');
    expect(agent.containerId).toBe('container-id-123');
    expect(agent.gitRepositoryUrl).toBe('https://github.com/user/repo.git');
    expect(agent.createdAt).toBeInstanceOf(Date);
    expect(agent.updatedAt).toBeInstanceOf(Date);
  });

  it('should allow optional description and containerId', () => {
    const agent = new AgentEntity();

    agent.id = 'test-uuid';
    agent.name = 'Test Agent';
    agent.hashedPassword = 'hashed-password';
    agent.createdAt = new Date();
    agent.updatedAt = new Date();

    expect(agent.description).toBeUndefined();
    expect(agent.containerId).toBeUndefined();
  });

  it('should handle nullable containerId', () => {
    const agent = new AgentEntity();

    agent.id = 'test-uuid';
    agent.name = 'Test Agent';
    agent.hashedPassword = 'hashed-password';
    agent.containerId = null as any;
    agent.createdAt = new Date();
    agent.updatedAt = new Date();

    expect(agent.containerId).toBeNull();
  });

  it('should allow nullable gitRepositoryUrl', () => {
    const agent = new AgentEntity();

    agent.id = 'test-uuid';
    agent.name = 'Test Agent';
    agent.hashedPassword = 'hashed-password';
    agent.gitRepositoryUrl = null as any;
    agent.createdAt = new Date();
    agent.updatedAt = new Date();

    expect(agent.gitRepositoryUrl).toBeNull();
  });

  it('should allow nullable gitRepositorySetupMode', () => {
    const agent = new AgentEntity();

    agent.id = 'test-uuid';
    agent.name = 'Test Agent';
    agent.hashedPassword = 'hashed-password';
    agent.gitRepositorySetupMode = GitRepositorySetupMode.EMPTY;
    agent.createdAt = new Date();
    agent.updatedAt = new Date();

    expect(agent.gitRepositorySetupMode).toBe(GitRepositorySetupMode.EMPTY);
  });
});
