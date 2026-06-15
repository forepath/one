import { ClientAgentAutonomyEntity } from './client-agent-autonomy.entity';

describe('ClientAgentAutonomyEntity', () => {
  it('should create an instance', () => {
    const entity = new ClientAgentAutonomyEntity();

    expect(entity).toBeDefined();
  });

  it('should have composite primary key fields and autonomy settings', () => {
    const entity = new ClientAgentAutonomyEntity();

    entity.clientId = 'client-uuid';
    entity.agentId = 'agent-uuid';
    entity.enabled = true;
    entity.preImproveTicket = false;
    entity.maxRuntimeMs = 3_600_000;
    entity.maxIterations = 20;
    entity.tokenBudgetLimit = 500_000;
    entity.createdAt = new Date('2024-01-01');
    entity.updatedAt = new Date('2024-01-02');

    expect(entity.clientId).toBe('client-uuid');
    expect(entity.agentId).toBe('agent-uuid');
    expect(entity.enabled).toBe(true);
    expect(entity.preImproveTicket).toBe(false);
    expect(entity.maxRuntimeMs).toBe(3_600_000);
    expect(entity.maxIterations).toBe(20);
    expect(entity.tokenBudgetLimit).toBe(500_000);
    expect(entity.createdAt).toBeInstanceOf(Date);
    expect(entity.updatedAt).toBeInstanceOf(Date);
  });

  it('should allow null token budget', () => {
    const entity = new ClientAgentAutonomyEntity();

    entity.tokenBudgetLimit = null;
    expect(entity.tokenBudgetLimit).toBeNull();
  });
});
