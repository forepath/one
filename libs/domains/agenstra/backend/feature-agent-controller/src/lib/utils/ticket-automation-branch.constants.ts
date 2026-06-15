export const TICKET_AUTOMATION_BRANCH_STRATEGIES = ['reuse_per_ticket', 'new_per_run'] as const;
export type TicketAutomationBranchStrategy = (typeof TICKET_AUTOMATION_BRANCH_STRATEGIES)[number];

export const DEFAULT_TICKET_AUTOMATION_BRANCH_STRATEGY: TicketAutomationBranchStrategy = 'reuse_per_ticket';

/** One stable branch per ticket for consecutive automation runs (default). */
export function stableAutomationBranchNameForTicket(ticketId: string): string {
  return `automation/ticket/${ticketId.slice(0, 8)}`;
}

/** Legacy behaviour: unique branch per run (`automation/{first-8-of-run-id}`). */
export function ephemeralAutomationBranchNameForRun(runId: string): string {
  return `automation/run/${runId.slice(0, 8)}`;
}
