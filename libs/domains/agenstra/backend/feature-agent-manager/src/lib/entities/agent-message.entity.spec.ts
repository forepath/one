import { AgentMessageEntity } from './agent-message.entity';
import { AgentEntity } from './agent.entity';

describe('AgentMessageEntity', () => {
  it('should create an instance', () => {
    const message = new AgentMessageEntity();

    expect(message).toBeDefined();
  });

  it('should have all required properties', () => {
    const message = new AgentMessageEntity();

    message.id = 'test-uuid';
    message.agentId = 'agent-uuid-123';
    message.actor = 'user';
    message.message = 'Test message content';
    message.createdAt = new Date();
    message.updatedAt = new Date();

    expect(message.id).toBe('test-uuid');
    expect(message.agentId).toBe('agent-uuid-123');
    expect(message.actor).toBe('user');
    expect(message.message).toBe('Test message content');
    expect(message.createdAt).toBeInstanceOf(Date);
    expect(message.updatedAt).toBeInstanceOf(Date);
  });

  it('should support agent actor', () => {
    const message = new AgentMessageEntity();

    message.id = 'test-uuid';
    message.agentId = 'agent-uuid-123';
    message.actor = 'agent';
    message.message = 'Agent response message';
    message.createdAt = new Date();
    message.updatedAt = new Date();

    expect(message.actor).toBe('agent');
  });

  it('should support user actor', () => {
    const message = new AgentMessageEntity();

    message.id = 'test-uuid';
    message.agentId = 'agent-uuid-123';
    message.actor = 'user';
    message.message = 'User message content';
    message.createdAt = new Date();
    message.updatedAt = new Date();

    expect(message.actor).toBe('user');
  });

  it('should support relationship to AgentEntity', () => {
    const agent = new AgentEntity();

    agent.id = 'agent-uuid-123';
    agent.name = 'Test Agent';
    agent.hashedPassword = 'hashed-password';
    agent.createdAt = new Date();
    agent.updatedAt = new Date();

    const message = new AgentMessageEntity();

    message.id = 'test-uuid';
    message.agentId = 'agent-uuid-123';
    message.agent = agent;
    message.actor = 'user';
    message.message = 'Test message';
    message.createdAt = new Date();
    message.updatedAt = new Date();

    expect(message.agent).toBe(agent);
    expect(message.agent.id).toBe('agent-uuid-123');
    expect(message.agent.name).toBe('Test Agent');
  });

  it('should handle long message content', () => {
    const longMessage = 'A'.repeat(1000);
    const message = new AgentMessageEntity();

    message.id = 'test-uuid';
    message.agentId = 'agent-uuid-123';
    message.actor = 'user';
    message.message = longMessage;
    message.createdAt = new Date();
    message.updatedAt = new Date();

    expect(message.message).toBe(longMessage);
    expect(message.message.length).toBe(1000);
  });
});
