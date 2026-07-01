/** Socket.IO event names on the `projects` namespace (server → client). */
export const PROJECTS_BOARD_EVENTS = {
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
