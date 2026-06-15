import { TicketAutomationLeaseEntity } from './ticket-automation-lease.entity';
import { TicketAutomationLeaseStatus } from './ticket-automation.enums';

describe('TicketAutomationLeaseEntity', () => {
  it('should create an instance', () => {
    const entity = new TicketAutomationLeaseEntity();

    expect(entity).toBeDefined();
  });

  it('should map lease columns', () => {
    const entity = new TicketAutomationLeaseEntity();

    entity.ticketId = 'ticket-uuid';
    entity.holderAgentId = 'agent-uuid';
    entity.runId = 'run-uuid';
    entity.leaseVersion = 1;
    entity.expiresAt = new Date('2026-01-01');
    entity.status = TicketAutomationLeaseStatus.ACTIVE;
    entity.createdAt = new Date();
    entity.updatedAt = new Date();

    expect(entity.ticketId).toBe('ticket-uuid');
    expect(entity.holderAgentId).toBe('agent-uuid');
    expect(entity.runId).toBe('run-uuid');
    expect(entity.leaseVersion).toBe(1);
    expect(entity.status).toBe(TicketAutomationLeaseStatus.ACTIVE);
    expect(entity.status).toBe('active');
  });
});
