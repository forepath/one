import {
  TicketAutomationRunChatEventPayload,
  TicketAutomationRunChatRunSummary,
  TicketAutomationRunChatTicketSummary,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { TicketAutomationRunResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';
import { TicketResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  ticketAutomationRunResponseDtoToChatRunSummary,
  ticketResponseDtoToChatTicketSummary,
} from '@forepath/agenstra/frontend/data-access-agent-console';

function pickNewerChatRunSummary(
  base: TicketAutomationRunChatRunSummary,
  cached: TicketAutomationRunResponseDto,
): TicketAutomationRunChatRunSummary {
  const baseT = Date.parse(base.updatedAt);
  const cacheT = Date.parse(cached.updatedAt);

  if (!Number.isNaN(cacheT) && (Number.isNaN(baseT) || cacheT >= baseT)) {
    return ticketAutomationRunResponseDtoToChatRunSummary(cached);
  }

  return base;
}

function chatTicketSummaryEqual(
  a: TicketAutomationRunChatTicketSummary,
  b: TicketAutomationRunChatTicketSummary,
): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.status === b.status &&
    a.priority === b.priority &&
    a.automationEligible === b.automationEligible &&
    (a.preferredChatAgentId ?? null) === (b.preferredChatAgentId ?? null) &&
    a.updatedAt === b.updatedAt
  );
}

function chatRunSummaryEqual(a: TicketAutomationRunChatRunSummary, b: TicketAutomationRunChatRunSummary): boolean {
  return (
    a.status === b.status &&
    a.phase === b.phase &&
    a.updatedAt === b.updatedAt &&
    (a.finishedAt ?? null) === (b.finishedAt ?? null) &&
    (a.iterationCount ?? 0) === (b.iterationCount ?? 0)
  );
}

/**
 * Overlay live ticket list data and the global automation run cache onto a chat automation card payload.
 */
export function mergeTicketAutomationChatCardPayload(
  base: TicketAutomationRunChatEventPayload,
  liveTicket: TicketResponseDto | undefined,
  cachedRun: TicketAutomationRunResponseDto | undefined,
): TicketAutomationRunChatEventPayload {
  const ticket: TicketAutomationRunChatTicketSummary = liveTicket
    ? ticketResponseDtoToChatTicketSummary(liveTicket)
    : base.ticket;
  const run = cachedRun && cachedRun.id === base.run.id ? pickNewerChatRunSummary(base.run, cachedRun) : base.run;

  if (chatTicketSummaryEqual(ticket, base.ticket) && chatRunSummaryEqual(run, base.run)) {
    return base;
  }

  return { ...base, ticket, run };
}
