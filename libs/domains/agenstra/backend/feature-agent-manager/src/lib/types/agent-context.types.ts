import type { AgentContextItemKind } from '@forepath/agenstra/shared/util-opencode-config';

/**
 * How additional (not pre-granted) context is handled for a ticket:
 * - `ask`: interactive chat — the user decides via a permission-style prompt
 * - `auto`: auto-approval sessions (ticket automation, read-only plan sessions) — granted without asking
 * - `deny`: hidden helper sessions nobody can answer (prompt enhancement, ticket body) — always denied
 */
export type AgentContextAccessMode = 'ask' | 'auto' | 'deny';

/** Content resolved at prompt time (pre-granted) or fetched after an approved access request. */
export interface AgentContextStoredItem {
  /** 1-based index for `item:<n>` refs. */
  index: number;
  kind: AgentContextItemKind;
  title: string;
  sha?: string;
  content: string;
}

export interface AgentContextAttachmentRef {
  fileName: string;
  contentType: string;
  byteSize: number;
  agentPath: string;
}

export interface AgentContextEnvironmentRef {
  id: string;
  containerType?: string;
}

export interface AgentContextGrants {
  ticket: string[];
  knowledge: string[];
}

export interface AgentContextTicketBinding {
  agentId: string;
  /** Chat session id, reserved session suffix, or `ephemeral:<correlationId>`. */
  sessionKey: string;
  /** Originating socket (controller connection) — preferred for on-demand context requests. */
  socketId?: string;
  chatSessionId?: string;
  chatId?: string;
  ephemeral: boolean;
  correlationId: string;
  accessMode: AgentContextAccessMode;
}

export interface AgentContextTicketRecord extends AgentContextTicketBinding {
  ticket: string;
  items: AgentContextStoredItem[];
  grants: AgentContextGrants;
  attachments: AgentContextAttachmentRef[];
  workspace?: { mountPath: string; containerType?: string };
  environments: AgentContextEnvironmentRef[];
  createdAt: number;
  lastUsedAt: number;
}

/** Manager → controller on-demand request (Socket.IO ack). */
export type AgentContextControllerRequest =
  | {
      op: 'search';
      agentId: string;
      query?: string;
      kinds?: Array<'ticket' | 'knowledge'>;
      limit?: number;
    }
  | {
      op: 'describe';
      agentId: string;
      refs: Array<{ kind: 'ticket' | 'knowledge'; sha: string }>;
    }
  | {
      op: 'content';
      agentId: string;
      refs: Array<{ kind: 'ticket' | 'knowledge'; sha: string }>;
    };

export interface AgentContextControllerMetadata {
  kind: 'ticket' | 'knowledge';
  sha: string;
  title: string;
  status?: string;
  priority?: string;
  nodeType?: string;
  parentSha?: string | null;
  size?: number;
}

export interface AgentContextControllerContent {
  kind: 'ticket' | 'knowledge';
  sha: string;
  title: string;
  content: string;
}

export type AgentContextControllerResponse =
  | { ok: true; items?: AgentContextControllerMetadata[]; contents?: AgentContextControllerContent[] }
  | { ok: false; error: string };
