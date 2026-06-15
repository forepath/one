import { TicketAutomationRunEntity } from './ticket-automation-run.entity';
import { TicketAutomationRunPhase, TicketAutomationRunStatus } from './ticket-automation.enums';

describe('TicketAutomationRunEntity', () => {
  it('should create an instance', () => {
    const entity = new TicketAutomationRunEntity();

    expect(entity).toBeDefined();
  });

  it('should map run lifecycle fields', () => {
    const entity = new TicketAutomationRunEntity();

    entity.id = 'run-uuid';
    entity.ticketId = 'ticket-uuid';
    entity.clientId = 'client-uuid';
    entity.agentId = 'agent-uuid';
    entity.status = TicketAutomationRunStatus.RUNNING;
    entity.phase = TicketAutomationRunPhase.AGENT_LOOP;
    entity.ticketStatusBefore = 'in_progress';
    entity.branchName = 'automation/run-1';
    entity.baseBranch = 'main';
    entity.baseSha = 'abc123';
    entity.startedAt = new Date();
    entity.finishedAt = null;
    entity.updatedAt = new Date();
    entity.iterationCount = 3;
    entity.completionMarkerSeen = false;
    entity.verificationPassed = null;
    entity.failureCode = null;
    entity.summary = { note: 'ok' };
    entity.cancelRequestedAt = null;
    entity.cancelledByUserId = null;
    entity.cancellationReason = null;

    expect(entity.status).toBe(TicketAutomationRunStatus.RUNNING);
    expect(entity.phase).toBe(TicketAutomationRunPhase.AGENT_LOOP);
    expect(entity.iterationCount).toBe(3);
    expect(entity.summary).toEqual({ note: 'ok' });
  });
});
