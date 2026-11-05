/**
 * Search index webhook event types. Shared by every product with an OpenSearch index; domain catalogs spread this
 * in (same idea as `IDENTITY_NOTIFICATION_EVENTS`).
 */
export const SEARCH_NOTIFICATION_EVENTS = [
  'search.reindex.started',
  'search.reindex.completed',
  'search.reindex.failed',
  'search.document.sync_failed',
] as const;

export type SearchNotificationEventType = (typeof SEARCH_NOTIFICATION_EVENTS)[number];
