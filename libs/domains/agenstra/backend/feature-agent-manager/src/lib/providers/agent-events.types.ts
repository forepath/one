export type AgentResponseMode = 'single' | 'stream' | 'sync';

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
  /** User-visible chat session id when the event belongs to a persisted chat. */
  chatId?: string;
  /**
   * Unique id for this event (uuid).
   */
  eventId: string;

  /**
   * Target agent UUID.
   */
  agentId: string;

  /**
   * Correlates all events that belong to a single user request.
   */
  correlationId: string;

  /**
   * Monotonically increasing sequence number scoped to correlationId.
   */
  sequence: number;

  /**
   * ISO timestamp for the event creation time.
   */
  timestamp: string;
}

export interface AgentUserMessagePayload {
  text: string;
}

/** Emitted after the user message is accepted so clients can show a thinking state before deltas/tools. */
export interface AgentThinkingPayload {
  /** Optional lifecycle hint for richer UIs (e.g. queued, running). */
  phase?: string;
}

/** Provider-native interaction / clarification request (e.g. `interaction_query` NDJSON lines). */
export type AgentInteractionQueryPayload = Record<string, unknown>;

export interface AgentAssistantDeltaPayload {
  delta: string;
}

export interface AgentAssistantMessagePayload {
  text: string;
}

export type AgentToolCallStatus = 'started' | 'inProgress' | 'succeeded' | 'failed';

export interface AgentToolCallPayload {
  toolCallId: string;
  name: string;
  args?: unknown;
  status: AgentToolCallStatus;
}

export interface AgentToolResultPayload {
  toolCallId: string;
  name: string;
  result?: unknown;
  isError?: boolean;
}

export interface AgentQuestionOption {
  id: string;
  label: string;
}

export interface AgentQuestionPayload {
  questionId: string;
  prompt: string;
  options: AgentQuestionOption[];
  allowMultiple?: boolean;
  /** Distinguishes OpenCode permissions (`permission` / `permission.v2`) from form questions. */
  subtype?: string;
  sessionId?: string;
}

export interface AgentStatusPayload {
  message: string;
  /** Optional short badge/title override for richer status rows. */
  title?: string;
  /** When set (e.g. permission.replied), UI can mark the matching question as answered. */
  questionId?: string;
}

export interface AgentErrorPayload {
  message: string;
  code?: string;
  details?: string;
}

export type AgentEventEnvelope =
  | (AgentEventEnvelopeBase & { kind: 'userMessage'; payload: AgentUserMessagePayload })
  | (AgentEventEnvelopeBase & { kind: 'thinking'; payload: AgentThinkingPayload })
  | (AgentEventEnvelopeBase & { kind: 'interactionQuery'; payload: AgentInteractionQueryPayload })
  | (AgentEventEnvelopeBase & { kind: 'assistantDelta'; payload: AgentAssistantDeltaPayload })
  | (AgentEventEnvelopeBase & { kind: 'assistantMessage'; payload: AgentAssistantMessagePayload })
  | (AgentEventEnvelopeBase & { kind: 'toolCall'; payload: AgentToolCallPayload })
  | (AgentEventEnvelopeBase & { kind: 'toolResult'; payload: AgentToolResultPayload })
  | (AgentEventEnvelopeBase & { kind: 'question'; payload: AgentQuestionPayload })
  | (AgentEventEnvelopeBase & { kind: 'status'; payload: AgentStatusPayload })
  | (AgentEventEnvelopeBase & { kind: 'error'; payload: AgentErrorPayload });
