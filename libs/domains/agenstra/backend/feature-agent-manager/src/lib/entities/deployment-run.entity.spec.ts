import { DeploymentConfigurationEntity } from './deployment-configuration.entity';
import { DeploymentRunEntity } from './deployment-run.entity';

describe('DeploymentRunEntity', () => {
  it('should create an instance', () => {
    const run = new DeploymentRunEntity();

    expect(run).toBeDefined();
  });

  it('should have all required properties', () => {
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'in_progress';
    run.ref = 'refs/heads/main';
    run.sha = 'abc123def456';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.id).toBe('test-uuid');
    expect(run.configurationId).toBe('config-uuid-123');
    expect(run.providerRunId).toBe('run-12345');
    expect(run.runName).toBe('CI Build');
    expect(run.status).toBe('in_progress');
    expect(run.ref).toBe('refs/heads/main');
    expect(run.sha).toBe('abc123def456');
    expect(run.createdAt).toBeInstanceOf(Date);
    expect(run.updatedAt).toBeInstanceOf(Date);
  });

  it('should support optional conclusion property', () => {
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'completed';
    run.conclusion = 'success';
    run.ref = 'refs/heads/main';
    run.sha = 'abc123def456';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.conclusion).toBe('success');
  });

  it('should support optional workflowId property', () => {
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'in_progress';
    run.workflowId = 'workflow-123';
    run.ref = 'refs/heads/main';
    run.sha = 'abc123def456';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.workflowId).toBe('workflow-123');
  });

  it('should support optional workflowName property', () => {
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'in_progress';
    run.workflowName = 'Continuous Integration';
    run.ref = 'refs/heads/main';
    run.sha = 'abc123def456';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.workflowName).toBe('Continuous Integration');
  });

  it('should support optional startedAt property', () => {
    const startTime = new Date('2024-01-01T10:00:00Z');
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'in_progress';
    run.startedAt = startTime;
    run.ref = 'refs/heads/main';
    run.sha = 'abc123def456';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.startedAt).toBe(startTime);
    expect(run.startedAt).toBeInstanceOf(Date);
  });

  it('should support optional completedAt property', () => {
    const completedTime = new Date('2024-01-01T10:15:00Z');
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'completed';
    run.conclusion = 'success';
    run.completedAt = completedTime;
    run.ref = 'refs/heads/main';
    run.sha = 'abc123def456';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.completedAt).toBe(completedTime);
    expect(run.completedAt).toBeInstanceOf(Date);
  });

  it('should support optional htmlUrl property', () => {
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'in_progress';
    run.htmlUrl = 'https://github.com/owner/repo/actions/runs/12345';
    run.ref = 'refs/heads/main';
    run.sha = 'abc123def456';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.htmlUrl).toBe('https://github.com/owner/repo/actions/runs/12345');
  });

  it('should allow undefined optional properties', () => {
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'queued';
    run.ref = 'refs/heads/main';
    run.sha = 'abc123def456';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.conclusion).toBeUndefined();
    expect(run.workflowId).toBeUndefined();
    expect(run.workflowName).toBeUndefined();
    expect(run.startedAt).toBeUndefined();
    expect(run.completedAt).toBeUndefined();
    expect(run.htmlUrl).toBeUndefined();
  });

  it('should support relationship to DeploymentConfigurationEntity', () => {
    const config = new DeploymentConfigurationEntity();

    config.id = 'config-uuid-123';
    config.agentId = 'agent-uuid-123';
    config.providerType = 'github';
    config.repositoryId = 'owner/repo';
    config.providerToken = 'encrypted-token-value';
    config.createdAt = new Date();
    config.updatedAt = new Date();

    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.configuration = config;
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'in_progress';
    run.ref = 'refs/heads/main';
    run.sha = 'abc123def456';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.configuration).toBe(config);
    expect(run.configuration.id).toBe('config-uuid-123');
    expect(run.configuration.providerType).toBe('github');
  });

  it('should support queued status', () => {
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'queued';
    run.ref = 'refs/heads/main';
    run.sha = 'abc123def456';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.status).toBe('queued');
  });

  it('should support in_progress status', () => {
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'in_progress';
    run.ref = 'refs/heads/main';
    run.sha = 'abc123def456';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.status).toBe('in_progress');
  });

  it('should support completed status with success conclusion', () => {
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'completed';
    run.conclusion = 'success';
    run.ref = 'refs/heads/main';
    run.sha = 'abc123def456';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.status).toBe('completed');
    expect(run.conclusion).toBe('success');
  });

  it('should support completed status with failure conclusion', () => {
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'completed';
    run.conclusion = 'failure';
    run.ref = 'refs/heads/main';
    run.sha = 'abc123def456';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.status).toBe('completed');
    expect(run.conclusion).toBe('failure');
  });

  it('should store full run with all optional fields', () => {
    const startTime = new Date('2024-01-01T10:00:00Z');
    const completedTime = new Date('2024-01-01T10:15:00Z');
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'completed';
    run.conclusion = 'success';
    run.ref = 'refs/heads/main';
    run.sha = 'abc123def456';
    run.workflowId = 'workflow-123';
    run.workflowName = 'Continuous Integration';
    run.startedAt = startTime;
    run.completedAt = completedTime;
    run.htmlUrl = 'https://github.com/owner/repo/actions/runs/12345';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.id).toBe('test-uuid');
    expect(run.configurationId).toBe('config-uuid-123');
    expect(run.providerRunId).toBe('run-12345');
    expect(run.runName).toBe('CI Build');
    expect(run.status).toBe('completed');
    expect(run.conclusion).toBe('success');
    expect(run.ref).toBe('refs/heads/main');
    expect(run.sha).toBe('abc123def456');
    expect(run.workflowId).toBe('workflow-123');
    expect(run.workflowName).toBe('Continuous Integration');
    expect(run.startedAt).toBe(startTime);
    expect(run.completedAt).toBe(completedTime);
    expect(run.htmlUrl).toBe('https://github.com/owner/repo/actions/runs/12345');
    expect(run.createdAt).toBeInstanceOf(Date);
    expect(run.updatedAt).toBeInstanceOf(Date);
  });

  it('should handle SHA with full 40 characters', () => {
    const fullSha = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'in_progress';
    run.ref = 'refs/heads/main';
    run.sha = fullSha;
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.sha).toBe(fullSha);
    expect(run.sha.length).toBe(40);
  });

  it('should handle branch ref', () => {
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'CI Build';
    run.status = 'in_progress';
    run.ref = 'refs/heads/feature/new-feature';
    run.sha = 'abc123def456';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.ref).toBe('refs/heads/feature/new-feature');
  });

  it('should handle tag ref', () => {
    const run = new DeploymentRunEntity();

    run.id = 'test-uuid';
    run.configurationId = 'config-uuid-123';
    run.providerRunId = 'run-12345';
    run.runName = 'Release Build';
    run.status = 'in_progress';
    run.ref = 'refs/tags/v1.0.0';
    run.sha = 'abc123def456';
    run.createdAt = new Date();
    run.updatedAt = new Date();

    expect(run.ref).toBe('refs/tags/v1.0.0');
  });
});
