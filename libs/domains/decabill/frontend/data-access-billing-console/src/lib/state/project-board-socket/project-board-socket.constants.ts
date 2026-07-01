export const PROJECT_BOARD_SOCKET_EVENTS = {
  ticketUpsert: 'ticketUpsert',
  ticketRemoved: 'ticketRemoved',
  ticketCommentCreated: 'ticketCommentCreated',
  ticketActivityCreated: 'ticketActivityCreated',
  milestoneUpsert: 'milestoneUpsert',
  milestoneRemoved: 'milestoneRemoved',
  timeEntryUpsert: 'timeEntryUpsert',
  timeEntryRemoved: 'timeEntryRemoved',
  projectSummaryChanged: 'projectSummaryChanged',
} as const;
