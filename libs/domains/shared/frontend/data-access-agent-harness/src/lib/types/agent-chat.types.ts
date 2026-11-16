import type {
  AgentActivity,
  AgentToolExecutionStatus,
  AgentTurnUsage,
} from '@forepath/shared/shared/util-agent-harness';

export type AgentChatMessageStatus = 'pending' | 'streaming' | 'completed' | 'incomplete' | 'failed';

export interface AgentChatMessage {
  /** Item id (`msg_…`) for loaded history, a local id for messages of this page session. */
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: AgentChatMessageStatus;
  /** Unix seconds. */
  createdAt: number;
}

export interface AgentChatToolCall {
  callId: string;
  name: string;
  status: 'running' | AgentToolExecutionStatus;
  error?: string;
}

export interface AgentChatTurnSummary {
  rounds: number;
  usage: AgentTurnUsage;
  toolCalls: number;
}

export type { AgentActivity };
