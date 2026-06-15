/** Server → client event names on the controller `tickets` Socket.IO namespace. */
export const TICKETS_BOARD_SOCKET_EVENTS = {
  ticketUpsert: 'ticketUpsert',
  ticketRemoved: 'ticketRemoved',
  ticketCommentCreated: 'ticketCommentCreated',
  ticketActivityCreated: 'ticketActivityCreated',
  knowledgeRelationChanged: 'knowledgeRelationChanged',
  ticketAutomationUpsert: 'ticketAutomationUpsert',
  ticketAutomationRunUpsert: 'ticketAutomationRunUpsert',
  ticketAutomationRunStepAppended: 'ticketAutomationRunStepAppended',
} as const;
