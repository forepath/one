import type { TicketAutomationRunPhase, TicketAutomationRunStatus } from '../../entities/ticket-automation.enums';

export class TicketAutomationRunStepResponseDto {
  id!: string;
  stepIndex!: number;
  phase!: string;
  kind!: string;
  payload!: Record<string, unknown> | null;
  excerpt!: string | null;
  createdAt!: Date;
}

export class TicketAutomationRunResponseDto {
  id!: string;
  ticketId!: string;
  clientId!: string;
  agentId!: string;
  status!: TicketAutomationRunStatus;
  phase!: TicketAutomationRunPhase;
  ticketStatusBefore!: string;
  branchName!: string | null;
  baseBranch!: string | null;
  baseSha!: string | null;
  startedAt!: Date;
  finishedAt!: Date | null;
  updatedAt!: Date;
  iterationCount!: number;
  completionMarkerSeen!: boolean;
  verificationPassed!: boolean | null;
  failureCode!: string | null;
  summary!: Record<string, unknown> | null;
  cancelRequestedAt!: Date | null;
  cancelledByUserId!: string | null;
  cancellationReason!: string | null;
  steps?: TicketAutomationRunStepResponseDto[];
}
