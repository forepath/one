import { TicketAutomationFailureCode } from '../entities/ticket-automation.enums';
import { TicketStatus } from '../entities/ticket.enums';

import { AutomationFailureRoute, routeAutomationFailure } from './automation-failure-routing';

describe('routeAutomationFailure', () => {
  const expectedByCode: Record<TicketAutomationFailureCode, AutomationFailureRoute> = {
    [TicketAutomationFailureCode.APPROVAL_MISSING]: {
      runStatus: 'cancelled',
      ticketStatus: 'unchanged',
      requeue: false,
    },
    [TicketAutomationFailureCode.LEASE_CONTENTION]: {
      runStatus: 'none',
      ticketStatus: 'unchanged',
      requeue: true,
    },
    [TicketAutomationFailureCode.VCS_DIRTY_WORKSPACE]: {
      runStatus: 'failed',
      ticketStatus: TicketStatus.TODO,
      requeue: true,
    },
    [TicketAutomationFailureCode.VCS_BRANCH_EXISTS]: {
      runStatus: 'failed',
      ticketStatus: TicketStatus.IN_PROGRESS,
      requeue: false,
    },
    [TicketAutomationFailureCode.AGENT_PROVIDER_ERROR]: {
      runStatus: 'failed',
      ticketStatus: TicketStatus.IN_PROGRESS,
      requeue: true,
    },
    [TicketAutomationFailureCode.AGENT_NO_COMPLETION_MARKER]: {
      runStatus: 'timed_out',
      ticketStatus: TicketStatus.TODO,
      requeue: true,
    },
    [TicketAutomationFailureCode.MARKER_WITHOUT_VERIFY]: {
      runStatus: 'failed',
      ticketStatus: TicketStatus.IN_PROGRESS,
      requeue: true,
    },
    [TicketAutomationFailureCode.VERIFY_COMMAND_FAILED]: {
      runStatus: 'failed',
      ticketStatus: TicketStatus.IN_PROGRESS,
      requeue: true,
    },
    [TicketAutomationFailureCode.COMMIT_FAILED]: {
      runStatus: 'failed',
      ticketStatus: TicketStatus.IN_PROGRESS,
      requeue: true,
    },
    [TicketAutomationFailureCode.PUSH_FAILED]: {
      runStatus: 'failed',
      ticketStatus: TicketStatus.IN_PROGRESS,
      requeue: true,
    },
    [TicketAutomationFailureCode.BUDGET_EXCEEDED]: {
      runStatus: 'timed_out',
      ticketStatus: TicketStatus.TODO,
      requeue: true,
    },
    [TicketAutomationFailureCode.HUMAN_ESCALATION]: {
      runStatus: 'escalated',
      ticketStatus: TicketStatus.IN_PROGRESS,
      requeue: false,
    },
    [TicketAutomationFailureCode.ORCHESTRATOR_STALE]: {
      runStatus: 'timed_out',
      ticketStatus: TicketStatus.IN_PROGRESS,
      requeue: true,
    },
  };

  it('maps every TicketAutomationFailureCode to the policy table', () => {
    const codes = Object.values(TicketAutomationFailureCode);

    expect(codes.length).toBeGreaterThan(0);

    for (const code of codes) {
      expect(routeAutomationFailure(code)).toEqual(expectedByCode[code]);
    }
  });
});
