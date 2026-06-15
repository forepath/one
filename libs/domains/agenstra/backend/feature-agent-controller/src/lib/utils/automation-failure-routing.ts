import { TicketAutomationFailureCode } from '../entities/ticket-automation.enums';
import { TicketStatus } from '../entities/ticket.enums';

export type AutomationRunTerminalStatus = 'succeeded' | 'failed' | 'timed_out' | 'escalated' | 'cancelled' | 'none';

export interface AutomationFailureRoute {
  runStatus: AutomationRunTerminalStatus;
  ticketStatus: TicketStatus | 'unchanged';
  requeue: boolean;
}

/**
 * Deterministic routing from `failure_code` to run terminal status, ticket workspace state, and scheduler requeue.
 * Adjust cells here when product policy changes; keep unit tests in sync.
 */
export function routeAutomationFailure(code: TicketAutomationFailureCode): AutomationFailureRoute {
  switch (code) {
    case TicketAutomationFailureCode.APPROVAL_MISSING:
      return { runStatus: 'cancelled', ticketStatus: 'unchanged', requeue: false };
    case TicketAutomationFailureCode.LEASE_CONTENTION:
      return { runStatus: 'none', ticketStatus: 'unchanged', requeue: true };
    case TicketAutomationFailureCode.VCS_DIRTY_WORKSPACE:
      return { runStatus: 'failed', ticketStatus: TicketStatus.TODO, requeue: true };
    case TicketAutomationFailureCode.VCS_BRANCH_EXISTS:
      return { runStatus: 'failed', ticketStatus: TicketStatus.IN_PROGRESS, requeue: false };
    case TicketAutomationFailureCode.AGENT_PROVIDER_ERROR:
      return { runStatus: 'failed', ticketStatus: TicketStatus.IN_PROGRESS, requeue: true };
    case TicketAutomationFailureCode.AGENT_NO_COMPLETION_MARKER:
      return { runStatus: 'timed_out', ticketStatus: TicketStatus.TODO, requeue: true };
    case TicketAutomationFailureCode.MARKER_WITHOUT_VERIFY:
      return { runStatus: 'failed', ticketStatus: TicketStatus.IN_PROGRESS, requeue: true };
    case TicketAutomationFailureCode.VERIFY_COMMAND_FAILED:
      return { runStatus: 'failed', ticketStatus: TicketStatus.IN_PROGRESS, requeue: true };
    case TicketAutomationFailureCode.COMMIT_FAILED:
      return { runStatus: 'failed', ticketStatus: TicketStatus.IN_PROGRESS, requeue: true };
    case TicketAutomationFailureCode.PUSH_FAILED:
      return { runStatus: 'failed', ticketStatus: TicketStatus.IN_PROGRESS, requeue: true };
    case TicketAutomationFailureCode.BUDGET_EXCEEDED:
      return { runStatus: 'timed_out', ticketStatus: TicketStatus.TODO, requeue: true };
    case TicketAutomationFailureCode.HUMAN_ESCALATION:
      return { runStatus: 'escalated', ticketStatus: TicketStatus.IN_PROGRESS, requeue: false };
    case TicketAutomationFailureCode.ORCHESTRATOR_STALE:
      return { runStatus: 'timed_out', ticketStatus: TicketStatus.IN_PROGRESS, requeue: true };
  }
}
