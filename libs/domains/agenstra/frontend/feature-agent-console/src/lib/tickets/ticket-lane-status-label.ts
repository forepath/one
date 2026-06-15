import type { TicketStatus } from '@forepath/agenstra/frontend/data-access-agent-console';

/**
 * Human-readable swimlane / workflow status for tickets (board cards, chat chips, etc.).
 * Keep in sync with board styling keys in `tickets-board.component.ts` (`ticketStatusBadgeClass`).
 */
export function ticketLaneStatusLabel(status: string): string {
  switch (status as TicketStatus) {
    case 'draft':
      return $localize`:@@featureTicketsBoard-laneDraft:Draft`;
    case 'todo':
      return $localize`:@@featureTicketsBoard-laneTodo:To do`;
    case 'in_progress':
      return $localize`:@@featureTicketsBoard-laneInProgress:In progress`;
    case 'prototype':
      return $localize`:@@featureTicketsBoard-lanePrototype:Prototype`;
    case 'done':
      return $localize`:@@featureTicketsBoard-laneDone:Done`;
    case 'closed':
      return $localize`:@@featureTicketsBoard-laneClosed:Closed`;
    default:
      return status;
  }
}
