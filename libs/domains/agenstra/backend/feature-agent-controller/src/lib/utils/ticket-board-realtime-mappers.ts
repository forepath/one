import type {
  TicketAutomationRunResponseDto,
  TicketAutomationRunStepResponseDto,
} from '../dto/ticket-automation/ticket-automation-run-response.dto';
import type { TicketActivityResponseDto } from '../dto/tickets/ticket-activity-response.dto';
import { TicketActivityEntity } from '../entities/ticket-activity.entity';
import { TicketAutomationRunStepEntity } from '../entities/ticket-automation-run-step.entity';
import { TicketAutomationRunEntity } from '../entities/ticket-automation-run.entity';

/** Snapshot DTO for websocket payloads (actor email enrichment optional). */
export function ticketActivityEntityToDto(row: TicketActivityEntity): TicketActivityResponseDto {
  return {
    id: row.id,
    ticketId: row.ticketId,
    occurredAt: row.occurredAt,
    actorType: row.actorType,
    actorUserId: row.actorUserId ?? null,
    actorEmail: null,
    actionType: row.actionType,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  };
}

export function ticketAutomationRunEntityToDto(r: TicketAutomationRunEntity): TicketAutomationRunResponseDto {
  return {
    id: r.id,
    ticketId: r.ticketId,
    clientId: r.clientId,
    agentId: r.agentId,
    status: r.status,
    phase: r.phase,
    ticketStatusBefore: r.ticketStatusBefore,
    branchName: r.branchName ?? null,
    baseBranch: r.baseBranch ?? null,
    baseSha: r.baseSha ?? null,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt ?? null,
    updatedAt: r.updatedAt,
    iterationCount: r.iterationCount,
    completionMarkerSeen: r.completionMarkerSeen,
    verificationPassed: r.verificationPassed ?? null,
    failureCode: r.failureCode ?? null,
    summary: r.summary ?? null,
    cancelRequestedAt: r.cancelRequestedAt ?? null,
    cancelledByUserId: r.cancelledByUserId ?? null,
    cancellationReason: r.cancellationReason ?? null,
  };
}

export function ticketAutomationRunStepEntityToDto(
  s: TicketAutomationRunStepEntity,
): TicketAutomationRunStepResponseDto {
  return {
    id: s.id,
    stepIndex: s.stepIndex,
    phase: s.phase,
    kind: s.kind,
    payload: s.payload ?? null,
    excerpt: s.excerpt ?? null,
    createdAt: s.createdAt,
  };
}
