import { DEPLOYMENT_SOCKET_EVENTS } from '@forepath/agenstra/shared/util-opencode-config';

/** Matches server `DEPLOYMENT_SOCKET_EVENTS` on the agent-controller `clients` namespace (room `client:{clientId}`). */
export const CLIENT_DEPLOYMENT_WORKFLOW_UPSERT_SOCKET_EVENT = DEPLOYMENT_SOCKET_EVENTS.workflowUpsert;

export const CLIENT_DEPLOYMENT_WORKFLOW_REMOVED_SOCKET_EVENT = DEPLOYMENT_SOCKET_EVENTS.workflowRemoved;

export const CLIENT_DEPLOYMENT_RUN_UPSERT_SOCKET_EVENT = DEPLOYMENT_SOCKET_EVENTS.runUpsert;
