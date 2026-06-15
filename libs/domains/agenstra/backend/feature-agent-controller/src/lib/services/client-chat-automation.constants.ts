/** Socket.IO event names on the `clients` namespace for ticket automation in chat (server → client). */
export const CLIENT_CHAT_AUTOMATION_EVENTS = {
  ticketAutomationRunChatUpsert: 'ticketAutomationRunChatUpsert',
  /** Full ticket row (same shape as REST / tickets-board `ticketUpsert`) so chat can refresh cards without `/tickets`. */
  ticketChatTicketUpsert: 'ticketChatTicketUpsert',
} as const;
