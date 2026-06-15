/** Socket.IO event names on the `tickets` namespace (server → client). */
export const TICKETS_BOARD_EVENTS = {
  ticketUpsert: 'ticketUpsert',
  ticketRemoved: 'ticketRemoved',
  ticketCommentCreated: 'ticketCommentCreated',
  ticketActivityCreated: 'ticketActivityCreated',
  knowledgeRelationChanged: 'knowledgeRelationChanged',
  ticketAutomationUpsert: 'ticketAutomationUpsert',
  ticketAutomationRunUpsert: 'ticketAutomationRunUpsert',
  ticketAutomationRunStepAppended: 'ticketAutomationRunStepAppended',
} as const;
