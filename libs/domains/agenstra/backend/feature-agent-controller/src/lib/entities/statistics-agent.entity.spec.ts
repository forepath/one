import { StatisticsAgentEntity } from './statistics-agent.entity';

describe('StatisticsAgentEntity', () => {
  it('should create an instance', () => {
    const entity = new StatisticsAgentEntity();

    expect(entity).toBeDefined();
  });

  it('should have all required properties', () => {
    const entity = new StatisticsAgentEntity();

    entity.id = 'stats-agent-uuid';
    entity.originalAgentId = 'agent-uuid';
    entity.statisticsClientId = 'stats-client-uuid';
    entity.agentType = 'cursor';
    entity.containerType = 'generic';
    entity.createdAt = new Date();
    entity.updatedAt = new Date();

    expect(entity.id).toBe('stats-agent-uuid');
    expect(entity.originalAgentId).toBe('agent-uuid');
    expect(entity.statisticsClientId).toBe('stats-client-uuid');
    expect(entity.agentType).toBe('cursor');
    expect(entity.containerType).toBe('generic');
    expect(entity.createdAt).toBeInstanceOf(Date);
    expect(entity.updatedAt).toBeInstanceOf(Date);
  });

  it('should allow optional name and description', () => {
    const entity = new StatisticsAgentEntity();

    entity.id = 'stats-agent-uuid';
    entity.originalAgentId = 'agent-uuid';
    entity.statisticsClientId = 'stats-client-uuid';
    entity.name = 'Test Agent';
    entity.description = 'Test description';

    expect(entity.name).toBe('Test Agent');
    expect(entity.description).toBe('Test description');
  });

  it('should use default agentType and containerType when not set', () => {
    const entity = new StatisticsAgentEntity();

    entity.agentType = 'cursor';
    entity.containerType = 'generic';

    expect(entity.agentType).toBe('cursor');
    expect(entity.containerType).toBe('generic');
  });
});
