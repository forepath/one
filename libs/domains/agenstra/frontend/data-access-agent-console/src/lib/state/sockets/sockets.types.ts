/**
 * Payload for setting client context
 */
export interface SetClientPayload {
  clientId: string;
}

/**
 * Response for successful client context setting
 */
export interface SetClientSuccessPayload {
  message: string;
  clientId: string;
}

/**
 * Available events that can be forwarded to the agents namespace
 * Based on agents.gateway.ts @SubscribeMessage handlers
 */
export enum ForwardableEvent {
  LOGIN = 'login',
  CHAT = 'chat',
  ENHANCE_CHAT = 'enhanceChat',
  GENERATE_TICKET_BODY = 'generateTicketBody',
  LOGOUT = 'logout',
  FILE_UPDATE = 'fileUpdate',
  CREATE_TERMINAL = 'createTerminal',
  TERMINAL_INPUT = 'terminalInput',
  CLOSE_TERMINAL = 'closeTerminal',
}

/**
 * Payload for forwarding events to agents namespace
 */
export interface ForwardPayload {
  event: ForwardableEvent;
  payload?: ForwardableEventPayload;
  agentId?: string;
}

/**
 * Union type for all forwardable event payloads
 * Based on agents.gateway.ts event definitions
 */
export type ForwardableEventPayload =
  | ChatPayload
  | EnhanceChatPayload
  | GenerateTicketBodyPayload
  | LoginPayload
  | LogoutPayload
  | FileUpdatePayload
  | CreateTerminalPayload
  | TerminalInputPayload
  | CloseTerminalPayload;

/**
 * Chat event payload (from agents.gateway.ts ChatPayload)
 */
export interface ChatPayload {
  message: string;
  model?: string;
  correlationId?: string;
  responseMode?: AgentResponseMode;
  contextInjection?: ContextInjectionPayload;
}

export type AgentResponseMode = 'single' | 'stream';

export type AgentEventKind =
  | 'userMessage'
  | 'thinking'
  | 'interactionQuery'
  | 'assistantDelta'
  | 'assistantMessage'
  | 'toolCall'
  | 'toolResult'
  | 'question'
  | 'status'
  | 'error';

export interface AgentEventEnvelopeBase {
  eventId: string;
  agentId: string;
  correlationId: string;
  sequence: number;
  timestamp: string;
  kind: AgentEventKind;
  payload: unknown;
}

export type AgentEventEnvelope = AgentEventEnvelopeBase;

/**
 * Prompt enhancement request (agents.gateway.ts enhanceChat). Unicast chatEnhanceResult; not shown in main chat.
 */
export interface EnhanceChatPayload {
  message: string;
  model?: string;
  correlationId: string;
  contextInjection?: ContextInjectionPayload;
}

/**
 * Ticket body generation (agents.gateway.ts generateTicketBody). Unicast ticketBodyResult; same shape as enhance.
 */
export interface GenerateTicketBodyPayload {
  title: string;
  model?: string;
  correlationId: string;
  /** Parent chain + subtasks for richer body generation (optional). */
  hierarchyContext?: string;
  contextInjection?: ContextInjectionPayload;
}

export interface ContextInjectionPayload {
  includeWorkspace?: boolean;
  environmentIds?: string[];
  ticketShas?: string[];
  knowledgeShas?: string[];
  autoEnrichmentEnabled?: boolean;
}

/**
 * Result of prompt enhancement (unicast from agents gateway).
 */
export interface ChatEnhanceResultData {
  correlationId: string;
  success: true;
  enhancedText: string;
}

export interface ChatEnhanceFailureData {
  correlationId: string;
  success: false;
  error: {
    message: string;
    code?: string;
    details?: string;
  };
}

export type ChatEnhanceResultPayload = ChatEnhanceResultData | ChatEnhanceFailureData;

/** Same payload shape as chat enhancement; event name is ticketBodyResult. */
export type TicketBodyResultPayload = ChatEnhanceResultPayload;

/**
 * Login event payload (from agents.gateway.ts LoginPayload)
 * Note: When forwarding with agentId, the payload is overridden with credentials from database
 */
export interface LoginPayload {
  agentId: string;
  password: string;
}

/**
 * Logout event payload (no payload required)
 * Using empty object type since logout requires no payload
 */
export type LogoutPayload = Record<string, never>;

/**
 * File update event payload (from agents.gateway.ts FileUpdatePayload)
 */
export interface FileUpdatePayload {
  filePath: string;
}

/**
 * Create terminal event payload (from agents.gateway.ts CreateTerminalPayload)
 */
export interface CreateTerminalPayload {
  sessionId?: string;
  shell?: string;
}

/**
 * Terminal input event payload (from agents.gateway.ts TerminalInputPayload)
 */
export interface TerminalInputPayload {
  sessionId: string;
  data: string;
}

/**
 * Close terminal event payload (from agents.gateway.ts CloseTerminalPayload)
 */
export interface CloseTerminalPayload {
  sessionId: string;
}

/**
 * Acknowledgement for forwarded events
 */
export interface ForwardAckPayload {
  received: boolean;
  event: string;
}

/**
 * Error payload from socket
 */
export interface SocketErrorPayload {
  message: string;
}

/**
 * Standardized response interfaces (from agents.gateway.ts)
 */
export interface BaseResponse {
  timestamp: string;
}

export interface SuccessResponse<T = unknown> extends BaseResponse {
  success: true;
  data: T;
}

export interface ErrorResponse extends BaseResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: string;
  };
}

/**
 * Chat actor types (from agents.gateway.ts ChatActor enum)
 */
export enum ChatActor {
  AGENT = 'agent',
  USER = 'user',
}

/**
 * Agent response object structure (from agents.gateway.ts AgentResponseObject)
 */
export interface AgentResponseObject {
  type: string;
  subtype?: string;
  is_error?: boolean;
  duration_ms?: number;
  duration_api_ms?: number;
  result?: string;
  session_id?: string;
  request_id?: string;
  [key: string]: unknown; // Allow additional properties
}

/**
 * User chat message data (from agents.gateway.ts UserChatMessageData)
 */
export interface UserChatMessageData {
  from: ChatActor.USER;
  text: string;
  timestamp: string;
}

/**
 * Agent chat message data (from agents.gateway.ts AgentChatMessageData)
 */
export interface AgentChatMessageData {
  from: ChatActor.AGENT;
  response: AgentResponseObject | string; // Parsed JSON object or raw string if parsing fails
  timestamp: string;
}

/**
 * Chat message data union (from agents.gateway.ts ChatMessageData)
 */
export type ChatMessageData = UserChatMessageData | AgentChatMessageData;

/**
 * Login success data (from agents.gateway.ts LoginSuccessData)
 */
export interface LoginSuccessData {
  message: string;
  agentId: string;
  agentName: string;
}

/**
 * Logout success data (from agents.gateway.ts LogoutSuccessData)
 */
export interface LogoutSuccessData {
  message: string;
  agentId: string | null;
  agentName: string | null;
}

/**
 * File update notification data (from agents.gateway.ts FileUpdateNotificationData)
 */
export interface FileUpdateNotificationData {
  socketId: string;
  filePath: string;
  timestamp: string;
}

/**
 * Terminal created data (from agents.gateway.ts)
 */
export interface TerminalCreatedData {
  sessionId: string;
}

/**
 * Terminal output data (from agents.gateway.ts)
 */
export interface TerminalOutputData {
  sessionId: string;
  data: string;
}

/**
 * Terminal closed data (from agents.gateway.ts)
 */
export interface TerminalClosedData {
  sessionId: string;
}

/**
 * Message filter result data (from agents.gateway.ts MessageFilterResultData)
 */
export interface MessageFilterResultData {
  direction: 'incoming' | 'outgoing';
  status: 'allowed' | 'filtered' | 'dropped';
  message: string;
  modifiedMessage?: string;
  appliedFilters: Array<{
    type: string;
    displayName: string;
    matched: boolean;
    reason?: string;
  }>;
  matchedFilter?: {
    type: string;
    displayName: string;
    matched: boolean;
    reason?: string;
  };
  action?: 'drop' | 'flag';
  timestamp: string;
}

/**
 * Container stats payload (from agents.gateway.ts ContainerStatsPayload).
 * When container is stopped, stats is null but status is always present.
 */
export interface ContainerStatsPayload {
  status: {
    running: boolean;
  };
  stats: {
    read: string;
    preread: string;
    pids_stats?: {
      current?: number;
    };
    blkio_stats?: Record<string, unknown>;
    num_procs?: number;
    storage_stats?: Record<string, unknown>;
    cpu_stats?: {
      cpu_usage?: {
        total_usage?: number;
        percpu_usage?: number[];
        usage_in_kernelmode?: number;
        usage_in_usermode?: number;
      };
      system_cpu_usage?: number;
      online_cpus?: number;
      throttled_data?: Record<string, unknown>;
    };
    precpu_stats?: {
      cpu_usage?: {
        total_usage?: number;
        percpu_usage?: number[];
        usage_in_kernelmode?: number;
        usage_in_usermode?: number;
      };
      system_cpu_usage?: number;
      online_cpus?: number;
      throttled_data?: Record<string, unknown>;
    };
    memory_stats?: {
      usage?: number;
      max_usage?: number;
      stats?: Record<string, unknown>;
    };
    networks?: Record<string, unknown>;
  };
  timestamp: string;
}

/** Controller-originated `ticketAutomationRunChatUpsert` payload (clients namespace). */
export interface TicketAutomationRunChatTicketSummary {
  id: string;
  clientId: string;
  title: string;
  priority: string;
  status: string;
  automationEligible: boolean;
  preferredChatAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketAutomationRunChatRunSummary {
  id: string;
  ticketId: string;
  clientId: string;
  agentId: string;
  status: string;
  phase: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  iterationCount?: number;
}

export interface TicketAutomationRunChatOpenAction {
  type: 'openTicketAutomationRun';
  ticketId: string;
  runId: string;
  label: string;
}

export interface TicketAutomationRunChatEventPayload {
  timelineAt: string;
  hydrate: boolean;
  ticket: TicketAutomationRunChatTicketSummary;
  run: TicketAutomationRunChatRunSummary;
  actions: TicketAutomationRunChatOpenAction[];
  contextInjection?: ContextInjectionPayload;
}

/**
 * Typed forwarded event payloads based on event name
 */
export type ForwardedEventPayload =
  | SuccessResponse<LoginSuccessData> // loginSuccess
  | ErrorResponse // loginError
  | SuccessResponse<ChatMessageData> // chatMessage
  | SuccessResponse<ChatEnhanceResultPayload> // chatEnhanceResult
  | SuccessResponse<TicketBodyResultPayload> // ticketBodyResult
  | SuccessResponse<MessageFilterResultData> // messageFilterResult
  | SuccessResponse<LogoutSuccessData> // logoutSuccess
  | SuccessResponse<FileUpdateNotificationData> // fileUpdateNotification
  | SuccessResponse<TerminalCreatedData> // terminalCreated
  | SuccessResponse<TerminalOutputData> // terminalOutput
  | SuccessResponse<TerminalClosedData> // terminalClosed
  | SuccessResponse<ContainerStatsPayload> // containerStats
  | SuccessResponse<AgentEventEnvelope> // chatEvent
  | TicketAutomationRunChatEventPayload // ticketAutomationRunChatUpsert
  | ErrorResponse; // error
