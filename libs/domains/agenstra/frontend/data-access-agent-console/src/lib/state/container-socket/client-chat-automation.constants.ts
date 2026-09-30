/** Matches server {@link CLIENT_CHAT_AUTOMATION_EVENTS} on agent-controller `clients` namespace. */
export const CLIENT_CHAT_AUTOMATION_SOCKET_EVENT = 'ticketAutomationRunChatUpsert' as const;

/** Ticket row snapshot for chat + tickets NgRx merge when not connected to `/tickets`. */
export const CLIENT_CHAT_TICKET_UPSERT_SOCKET_EVENT = 'ticketChatTicketUpsert' as const;
