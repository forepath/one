import { type SocketEventScopes, websocketScope } from '@forepath/identity/backend';

import { PROJECTS_BOARD_EVENTS } from '../projects/services/project-board-realtime.constants';

/**
 * Scopes machine tokens (PAT / app access tokens) need per Decabill socket event.
 *
 * Connecting to socket `<name>` needs `websocket:<name>:read`. Every event also needs the domain scopes of its
 * HTTP equivalent; user limitations (ownership, no console-admin bypass for `amr: pat`) apply unchanged on top.
 * Unlisted events are denied (fail-closed).
 */
export const BILLING_WEBSOCKETS = {
  billing: 'billing',
  projects: 'projects',
} as const;

const billingRead = websocketScope(BILLING_WEBSOCKETS.billing, 'read');
const projectsRead = websocketScope(BILLING_WEBSOCKETS.projects, 'read');

/** `billing` namespace: client → server. */
export const BILLING_SOCKET_INBOUND_SCOPES: SocketEventScopes = {
  subscribeDashboardStatus: [billingRead, 'subscriptions:read'],
  unsubscribeDashboardStatus: [billingRead],
  subscribeSubscriptionMeters: [billingRead, 'subscriptions:read'],
  unsubscribeSubscriptionMeters: [billingRead],
};

/** `billing` namespace: server → client. */
export const BILLING_SOCKET_OUTBOUND_SCOPES: SocketEventScopes = {
  error: [],
  dashboardStatusUpdate: ['subscriptions:read'],
  meterSummaryUpdate: ['subscriptions:read'],
};

/** Admin-only meter watching of other users' subscriptions (same scope as the admin meters REST API). */
export const BILLING_SOCKET_ADMIN_METERS_SCOPE = 'usage:admin';

/** `projects` namespace: client → server. */
export const PROJECTS_SOCKET_INBOUND_SCOPES: SocketEventScopes = {
  setProject: [projectsRead, 'projects:read'],
};

/**
 * `projects` namespace: server → client. Owners need the resource read scopes; admins watching another user's
 * project need the resource admin scopes (same as `ensureProjectReadable(..., '<resource>:admin')` on REST).
 */
export function projectsSocketOutboundScopes(crossOwner: boolean): SocketEventScopes {
  const level = crossOwner ? 'admin' : 'read';

  return {
    error: [],
    setProjectSuccess: [],
    [PROJECTS_BOARD_EVENTS.ticketUpsert]: [`tickets:${level}`],
    [PROJECTS_BOARD_EVENTS.ticketRemoved]: [`tickets:${level}`],
    [PROJECTS_BOARD_EVENTS.ticketCommentCreated]: [`tickets:${level}`],
    [PROJECTS_BOARD_EVENTS.ticketActivityCreated]: [`tickets:${level}`],
    [PROJECTS_BOARD_EVENTS.milestoneUpsert]: [`milestones:${level}`],
    [PROJECTS_BOARD_EVENTS.milestoneRemoved]: [`milestones:${level}`],
    [PROJECTS_BOARD_EVENTS.timeEntryUpsert]: [`time_entries:${level}`],
    [PROJECTS_BOARD_EVENTS.timeEntryRemoved]: [`time_entries:${level}`],
    [PROJECTS_BOARD_EVENTS.projectSummaryChanged]: [`projects:${level}`],
  };
}
