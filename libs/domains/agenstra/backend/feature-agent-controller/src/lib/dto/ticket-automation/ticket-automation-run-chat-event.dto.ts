import type { TicketAutomationRunResponseDto } from './ticket-automation-run-response.dto';

/** Minimal ticket snapshot for chat bubbles (aligns with OpenAPI TicketAutomationRunChatTicketSummary). */
export interface TicketAutomationRunChatTicketSummaryDto {
  id: string;
  clientId: string;
  title: string;
  priority: string;
  status: string;
  automationEligible: boolean;
  preferredChatAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TicketAutomationRunChatActionType = 'openTicketAutomationRun';

export interface TicketAutomationRunChatOpenActionDto {
  type: 'openTicketAutomationRun';
  ticketId: string;
  runId: string;
  label: string;
}

export type TicketAutomationRunChatActionDto = TicketAutomationRunChatOpenActionDto;

export interface ContextInjectionDto {
  includeWorkspace?: boolean;
  environmentIds?: string[];
  autoEnrichmentEnabled?: boolean;
}

/**
 * Server → client payload on namespace `clients`, event {@link CLIENT_CHAT_AUTOMATION_EVENTS.ticketAutomationRunChatUpsert}.
 * `timelineAt` is ISO-8601: hydrate rows use `run.startedAt`; live updates use `run.updatedAt` for ordering.
 */
export interface TicketAutomationRunChatEventDto {
  timelineAt: string;
  hydrate: boolean;
  ticket: TicketAutomationRunChatTicketSummaryDto;
  run: TicketAutomationRunResponseDto;
  actions: TicketAutomationRunChatActionDto[];
  contextInjection?: ContextInjectionDto;
}
