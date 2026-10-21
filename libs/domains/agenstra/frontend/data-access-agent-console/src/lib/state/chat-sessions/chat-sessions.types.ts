/**
 * User-visible chat session kinds (hidden/background chats are never listed). `handoff` chats were opened by the
 * platform for a task another agent of the workspace handed over.
 */
export type ChatSessionKind = 'primary' | 'user' | 'handoff';

/** Compact chat summary embedded on AgentResponseDto. */
export interface AgentChatSessionSummaryDto {
  id: string;
  title?: string;
  kind: ChatSessionKind;
  lastMessageAt?: string;
  createdAt: string;
}

/** Full chat session API response. */
export interface ChatSessionResponseDto {
  id: string;
  agentId: string;
  title?: string;
  kind: ChatSessionKind;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChatSessionDto {
  title?: string;
}

export interface UpdateChatSessionDto {
  title: string;
}

export interface ListChatSessionsParams {
  limit?: number;
  offset?: number;
}

export interface ChatSessionMessageResponseDto {
  id: string;
  actor: string;
  message: string;
  filtered: boolean;
  createdAt: string;
  updatedAt: string;
}
