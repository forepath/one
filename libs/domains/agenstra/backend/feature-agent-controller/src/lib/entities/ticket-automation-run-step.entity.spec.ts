import { TicketAutomationRunStepEntity } from './ticket-automation-run-step.entity';

describe('TicketAutomationRunStepEntity', () => {
  it('should create an instance', () => {
    const entity = new TicketAutomationRunStepEntity();

    expect(entity).toBeDefined();
  });

  it('should map step audit fields', () => {
    const entity = new TicketAutomationRunStepEntity();

    entity.id = 'step-uuid';
    entity.runId = 'run-uuid';
    entity.stepIndex = 0;
    entity.phase = 'agent_loop';
    entity.kind = 'chat_turn';
    entity.payload = { correlationId: 'c1' };
    entity.excerpt = 'partial output';
    entity.createdAt = new Date();

    expect(entity.runId).toBe('run-uuid');
    expect(entity.stepIndex).toBe(0);
    expect(entity.phase).toBe('agent_loop');
    expect(entity.kind).toBe('chat_turn');
    expect(entity.payload).toEqual({ correlationId: 'c1' });
    expect(entity.excerpt).toBe('partial output');
  });
});
