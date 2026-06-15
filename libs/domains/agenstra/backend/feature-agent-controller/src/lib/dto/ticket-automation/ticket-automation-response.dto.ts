import type { TicketVerifierProfileJson } from '../../entities/ticket-automation.entity';

export class TicketAutomationResponseDto {
  ticketId!: string;
  eligible!: boolean;
  allowedAgentIds!: string[];
  includeWorkspaceContext!: boolean;
  contextEnvironmentIds!: string[];
  autoEnrichmentEnabled!: boolean;
  verifierProfile!: TicketVerifierProfileJson | null;
  requiresApproval!: boolean;
  approvedAt!: Date | null;
  approvedByUserId!: string | null;
  approvalBaselineTicketUpdatedAt!: Date | null;
  defaultBranchOverride!: string | null;
  automationBranchStrategy!: 'reuse_per_ticket' | 'new_per_run';
  forceNewAutomationBranchNextRun!: boolean;
  nextRetryAt!: Date | null;
  consecutiveFailureCount!: number;
  createdAt!: Date;
  updatedAt!: Date;
}
