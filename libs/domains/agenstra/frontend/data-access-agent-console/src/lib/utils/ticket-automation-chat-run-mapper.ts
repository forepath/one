import type {
  TicketAutomationRunChatRunSummary,
  TicketAutomationRunChatTicketSummary,
} from '../state/sockets/sockets.types';
import type { TicketAutomationRunResponseDto } from '../state/ticket-automation/ticket-automation.types';
import type { TicketResponseDto } from '../state/tickets/tickets.types';

/** Build a full run DTO from a clients-chat snapshot (unknown fields use safe defaults; merged with board cache preserves richer data). */
export function ticketAutomationRunChatSummaryToResponseDto(
  summary: TicketAutomationRunChatRunSummary,
): TicketAutomationRunResponseDto {
  return {
    id: summary.id,
    ticketId: summary.ticketId,
    clientId: summary.clientId,
    agentId: summary.agentId,
    status: summary.status as TicketAutomationRunResponseDto['status'],
    phase: summary.phase as TicketAutomationRunResponseDto['phase'],
    ticketStatusBefore: 'todo',
    branchName: null,
    baseBranch: null,
    baseSha: null,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    updatedAt: summary.updatedAt,
    iterationCount: summary.iterationCount ?? 0,
    completionMarkerSeen: false,
    verificationPassed: null,
    failureCode: null,
    summary: null,
    cancelRequestedAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
  };
}

export function ticketResponseDtoToChatTicketSummary(t: TicketResponseDto): TicketAutomationRunChatTicketSummary {
  return {
    id: t.id,
    clientId: t.clientId,
    title: t.title,
    priority: t.priority,
    status: t.status,
    automationEligible: t.automationEligible,
    preferredChatAgentId: t.preferredChatAgentId ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export function ticketAutomationRunResponseDtoToChatRunSummary(
  run: TicketAutomationRunResponseDto,
): TicketAutomationRunChatRunSummary {
  return {
    id: run.id,
    ticketId: run.ticketId,
    clientId: run.clientId,
    agentId: run.agentId,
    status: run.status,
    phase: run.phase,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
    iterationCount: run.iterationCount,
  };
}
