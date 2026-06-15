import { AgentEnvironmentVariableEntity } from './agent-environment-variable.entity';
import { AgentEntity } from './agent.entity';

describe('AgentEnvironmentVariableEntity', () => {
  it('should create an instance', () => {
    const variable = new AgentEnvironmentVariableEntity();

    expect(variable).toBeDefined();
  });

  it('should have all required properties', () => {
    const variable = new AgentEnvironmentVariableEntity();

    variable.id = 'test-uuid';
    variable.agentId = 'agent-uuid-123';
    variable.variable = 'TEST_VARIABLE';
    variable.content = 'Test variable content';
    variable.createdAt = new Date();
    variable.updatedAt = new Date();

    expect(variable.id).toBe('test-uuid');
    expect(variable.agentId).toBe('agent-uuid-123');
    expect(variable.variable).toBe('TEST_VARIABLE');
    expect(variable.content).toBe('Test variable content');
    expect(variable.createdAt).toBeInstanceOf(Date);
    expect(variable.updatedAt).toBeInstanceOf(Date);
  });

  it('should support relationship to AgentEntity', () => {
    const agent = new AgentEntity();

    agent.id = 'agent-uuid-123';
    agent.name = 'Test Agent';
    agent.hashedPassword = 'hashed-password';
    agent.createdAt = new Date();
    agent.updatedAt = new Date();

    const variable = new AgentEnvironmentVariableEntity();

    variable.id = 'test-uuid';
    variable.agentId = 'agent-uuid-123';
    variable.agent = agent;
    variable.variable = 'TEST_VARIABLE';
    variable.content = 'Test variable content';
    variable.createdAt = new Date();
    variable.updatedAt = new Date();

    expect(variable.agent).toBe(agent);
    expect(variable.agent.id).toBe('agent-uuid-123');
    expect(variable.agent.name).toBe('Test Agent');
  });

  it('should handle long variable content', () => {
    const longMessage = 'A'.repeat(1000);
    const variable = new AgentEnvironmentVariableEntity();

    variable.id = 'test-uuid';
    variable.agentId = 'agent-uuid-123';
    variable.variable = 'TEST_VARIABLE';
    variable.content = longMessage;
    variable.createdAt = new Date();
    variable.updatedAt = new Date();

    expect(variable.content).toBe(longMessage);
    expect(variable.content.length).toBe(1000);
  });
});
