import { DEPLOYMENT_SOCKET_EVENTS } from '@forepath/agenstra/shared/util-opencode-config';
import { type SocketEventScopes, websocketScope } from '@forepath/identity/backend';

import { AGENT_TASK_SOCKET_EVENTS } from '../constants/agent-tasks.constants';
import { CLIENT_CHAT_AUTOMATION_EVENTS } from '../services/client-chat-automation.constants';
import { CLIENT_CHAT_PLAN_EVENTS } from '../services/client-chat-plan.constants';
import { INITIATIVES_BOARD_EVENTS } from '../services/initiative-board-realtime.constants';
import { KNOWLEDGE_BOARD_EVENTS } from '../services/knowledge-board-realtime.constants';
import { TICKETS_BOARD_EVENTS } from '../services/ticket-board-realtime.constants';

/**
 * Scopes machine tokens (PAT / app access tokens) need per Agenstra socket event.
 *
 * Connecting to socket `<name>` needs `websocket:<name>:read`; state-changing inbound events additionally need
 * `websocket:<name>:write`. Every event also needs the domain scopes of its HTTP equivalent, so a socket never
 * reveals or changes more than the REST API would for the same token. User limitations (workspace membership,
 * no console-admin bypass for `amr: pat`) apply unchanged on top. Unlisted events are denied (fail-closed).
 */
export const AGENSTRA_WEBSOCKETS = {
  clients: 'clients',
  status: 'status',
  tickets: 'tickets',
  pages: 'pages',
  initiatives: 'initiatives',
  vnc: 'vnc',
} as const;

const clientsRead = websocketScope(AGENSTRA_WEBSOCKETS.clients, 'read');
const clientsWrite = websocketScope(AGENSTRA_WEBSOCKETS.clients, 'write');
const statusWrite = websocketScope(AGENSTRA_WEBSOCKETS.status, 'write');
const ticketsRead = websocketScope(AGENSTRA_WEBSOCKETS.tickets, 'read');
const pagesRead = websocketScope(AGENSTRA_WEBSOCKETS.pages, 'read');
const initiativesRead = websocketScope(AGENSTRA_WEBSOCKETS.initiatives, 'read');

/** Scope needed to mint a VNC session ticket for the raw VNC websocket (on top of `agent_vnc:write`). */
export const AGENSTRA_VNC_WEBSOCKET_SCOPE = websocketScope(AGENSTRA_WEBSOCKETS.vnc, 'write');

/** `clients` namespace: client → server. */
export const CLIENTS_SOCKET_INBOUND_SCOPES: SocketEventScopes = {
  setClient: [clientsRead, 'clients:read'],
  // The forwarded event is checked against CLIENTS_SOCKET_FORWARD_SCOPES in the handler.
  forward: [clientsRead],
  [CLIENT_CHAT_PLAN_EVENTS.createChatPlan]: [clientsWrite, 'agent_chats:write'],
  [CLIENT_CHAT_PLAN_EVENTS.refineChatPlan]: [clientsWrite, 'agent_chats:write'],
  [CLIENT_CHAT_PLAN_EVENTS.executeChatPlan]: [clientsWrite, 'agent_chats:write'],
  [CLIENT_CHAT_PLAN_EVENTS.retryChatPlan]: [clientsWrite, 'agent_chats:write'],
  [CLIENT_CHAT_PLAN_EVENTS.cancelChatPlan]: [clientsWrite, 'agent_chats:write'],
};

/**
 * `clients` namespace: events relayed to the agent-manager via `forward`.
 * Terminal events (`createTerminal`, `terminalInput`, ...) are intentionally absent: shell access has no
 * REST equivalent and stays interactive-only.
 */
export const CLIENTS_SOCKET_FORWARD_SCOPES: SocketEventScopes = {
  login: [clientsRead, 'agents:read'],
  logout: [clientsRead, 'agents:read'],
  restoreChat: [clientsRead, 'agent_chats:read'],
  chat: [clientsWrite, 'agent_chats:write'],
  enhanceChat: [clientsWrite, 'agent_chats:write'],
  generateTicketBody: [clientsWrite, 'tickets:write'],
  fileUpdate: [clientsWrite, 'agent_files:write'],
};

/** `clients` namespace: server → client (agent-manager relays, workspace room broadcasts, per-socket hydrates). */
export const CLIENTS_SOCKET_OUTBOUND_SCOPES: SocketEventScopes = {
  // Replies of the gateway / manager to the socket's own (already authorized) requests and the state of the
  // socket's own agent-manager connection (no workspace data).
  error: [],
  forwardAck: [],
  setClientSuccess: [],
  remoteDisconnected: [],
  remoteReconnecting: [],
  remoteReconnected: [],
  remoteReconnectError: [],
  remoteReconnectFailed: [],
  // Agent-manager relays
  loginSuccess: ['agents:read'],
  loginError: ['agents:read'],
  logoutSuccess: ['agents:read'],
  containerStats: ['agents:read'],
  opencodeConfigSynced: ['agents:read'],
  environmentProgress: ['agents:read'],
  egressStatusChanged: ['clients:read'],
  chatMessage: ['agent_chats:read'],
  chatMessageBatch: ['agent_chats:read'],
  chatEvent: ['agent_chats:read'],
  restoreChatSuccess: ['agent_chats:read'],
  messageFilterResult: ['agent_chats:read'],
  chatEnhanceResult: ['agent_chats:write'],
  ticketBodyResult: ['tickets:write'],
  fileUpdateNotification: ['agent_files:read'],
  workspaceIndexChanged: ['agent_files:read'],
  workspaceIndexRebuildRequired: ['agent_files:read'],
  gitStateChanged: ['agent_vcs:read'],
  // Workspace room broadcasts and hydrates
  [CLIENT_CHAT_PLAN_EVENTS.chatPlanUpsert]: ['agent_chats:read'],
  [CLIENT_CHAT_AUTOMATION_EVENTS.ticketAutomationRunChatUpsert]: ['agent_chats:read', 'tickets:read'],
  [CLIENT_CHAT_AUTOMATION_EVENTS.ticketChatTicketUpsert]: ['tickets:read'],
  [AGENT_TASK_SOCKET_EVENTS.runChatUpsert]: ['agent_chats:read'],
  [AGENT_TASK_SOCKET_EVENTS.taskUpsert]: ['agent_chats:read'],
  [AGENT_TASK_SOCKET_EVENTS.taskRemoved]: ['agent_chats:read'],
  [DEPLOYMENT_SOCKET_EVENTS.workflowUpsert]: ['deployments:read'],
  [DEPLOYMENT_SOCKET_EVENTS.workflowRemoved]: ['deployments:read'],
  [DEPLOYMENT_SOCKET_EVENTS.runUpsert]: ['deployments:read'],
};

/** `status` namespace: client → server. */
export const STATUS_SOCKET_INBOUND_SCOPES: SocketEventScopes = {
  markEnvironmentRead: [statusWrite, 'agent_chats:read'],
  markChatSessionRead: [statusWrite, 'agent_chats:read'],
  // While an environment is active, incoming agent messages are marked read for the user (a write).
  setActiveEnvironment: [statusWrite, 'agent_chats:read'],
};

/** Status payloads carry agent, unread-chat and git state of every accessible environment. */
const STATUS_PAYLOAD_SCOPES = ['agents:read', 'agent_chats:read', 'agent_vcs:read'] as const;

/** `status` namespace: server → client. */
export const STATUS_SOCKET_OUTBOUND_SCOPES: SocketEventScopes = {
  error: [],
  statusSnapshot: STATUS_PAYLOAD_SCOPES,
  statusPatch: STATUS_PAYLOAD_SCOPES,
};

/** `tickets` namespace: client → server. */
export const TICKETS_SOCKET_INBOUND_SCOPES: SocketEventScopes = {
  setClient: [ticketsRead, 'tickets:read'],
};

/** `tickets` namespace: server → client. */
export const TICKETS_SOCKET_OUTBOUND_SCOPES: SocketEventScopes = {
  error: [],
  setClientSuccess: [],
  [TICKETS_BOARD_EVENTS.ticketUpsert]: ['tickets:read'],
  [TICKETS_BOARD_EVENTS.ticketRemoved]: ['tickets:read'],
  [TICKETS_BOARD_EVENTS.ticketCommentCreated]: ['tickets:read'],
  [TICKETS_BOARD_EVENTS.ticketActivityCreated]: ['tickets:read'],
  [TICKETS_BOARD_EVENTS.knowledgeRelationChanged]: ['tickets:read', 'knowledge:read'],
  [TICKETS_BOARD_EVENTS.ticketAutomationUpsert]: ['tickets:read'],
  [TICKETS_BOARD_EVENTS.ticketAutomationRunUpsert]: ['tickets:read'],
  [TICKETS_BOARD_EVENTS.ticketAutomationRunStepAppended]: ['tickets:read'],
};

/** `pages` (knowledge) namespace: client → server. */
export const PAGES_SOCKET_INBOUND_SCOPES: SocketEventScopes = {
  setClient: [pagesRead, 'knowledge:read'],
};

/** `pages` (knowledge) namespace: server → client. */
export const PAGES_SOCKET_OUTBOUND_SCOPES: SocketEventScopes = {
  error: [],
  setClientSuccess: [],
  [KNOWLEDGE_BOARD_EVENTS.knowledgeTreeChanged]: ['knowledge:read'],
  [KNOWLEDGE_BOARD_EVENTS.knowledgePageActivityCreated]: ['knowledge:read'],
  [KNOWLEDGE_BOARD_EVENTS.knowledgeRelationChanged]: ['knowledge:read', 'tickets:read'],
};

/** `initiatives` namespace: client → server (listen-only: every command is REST). */
export const INITIATIVES_SOCKET_INBOUND_SCOPES: SocketEventScopes = {
  setClient: [initiativesRead, 'initiatives:read'],
};

/** `initiatives` namespace: server → client (metadata; document content is fetched over REST). */
export const INITIATIVES_SOCKET_OUTBOUND_SCOPES: SocketEventScopes = {
  error: [],
  setClientSuccess: [],
  [INITIATIVES_BOARD_EVENTS.initiativeUpsert]: ['initiatives:read'],
  [INITIATIVES_BOARD_EVENTS.initiativeRemoved]: ['initiatives:read'],
  [INITIATIVES_BOARD_EVENTS.initiativeArtifactUpsert]: ['initiatives:read'],
  [INITIATIVES_BOARD_EVENTS.initiativeArtifactRemoved]: ['initiatives:read'],
  [INITIATIVES_BOARD_EVENTS.initiativeWorkItemsChanged]: ['initiatives:read'],
  [INITIATIVES_BOARD_EVENTS.initiativeRunUpsert]: ['initiatives:read'],
  [INITIATIVES_BOARD_EVENTS.initiativeRunTurnAppended]: ['initiatives:read'],
  [INITIATIVES_BOARD_EVENTS.initiativeProposalUpsert]: ['initiatives:read'],
  [INITIATIVES_BOARD_EVENTS.initiativeFindingUpsert]: ['initiatives:read'],
  [INITIATIVES_BOARD_EVENTS.initiativeDecisionUpsert]: ['initiatives:read'],
  [INITIATIVES_BOARD_EVENTS.initiativeActivityCreated]: ['initiatives:read'],
};
