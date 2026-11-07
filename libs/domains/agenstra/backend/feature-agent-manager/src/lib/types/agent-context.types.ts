import type {
  AgentContentChangeResult,
  AgentContentChangeSource,
  AgentContentControllerChange,
  AgentContextItemKind,
  AgentContextElementKind,
} from '@forepath/agenstra/shared/util-opencode-config';

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
  /** Element version when the content was fetched on demand (pre-granted prompt content has none). */
  revision?: string;
  /** Fetched on demand and not changed since (pre-granted prompt content is read again by SHA for its revision). */
  fresh?: boolean;
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
}

export interface AgentContextGrants {
  ticket: string[];
  knowledge: string[];
  /** Plans of the agent's own environment (the controller never serves other environments' plans). */
  plan: string[];
  /** Initiatives of the workspace (overview incl. work items). */
  initiative: string[];
  /** Initiative documents. */
  artifact: string[];
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
  /**
   * Ticket SHAs the platform granted at mint time (never agent input): anchors of the scope automatic grants of
   * unattended ticket automation may cover (same ticket tree).
   */
  scopeAnchors: string[];
  attachments: AgentContextAttachmentRef[];
  workspace?: { mountPath: string };
  environments: AgentContextEnvironmentRef[];
  /** "Allow once" decisions are per change; approved "allow for this chat" write grants live in the session. */
  writeGrants: string[];
  /** Elements created through content changes of this ticket (readable and changeable by the same turn). */
  createdRefs: string[];
  /** Content changes requested with this ticket (bounded per turn). */
  changeCount: number;
  createdAt: number;
  lastUsedAt: number;
}

/** Manager → controller on-demand request (Socket.IO ack). */
export type AgentContextControllerRequest =
  | {
      op: 'search';
      agentId: string;
      query?: string;
      kinds?: Array<AgentContextElementKind>;
      limit?: number;
    }
  | {
      op: 'describe';
      agentId: string;
      refs: Array<{ kind: AgentContextElementKind; sha: string }>;
    }
  | {
      op: 'content';
      agentId: string;
      refs: Array<{ kind: AgentContextElementKind; sha: string }>;
    }
  /** Of `refs`, the tickets in the same ticket tree as one of the `anchors` (scoped automatic grants). */
  | {
      op: 'scope';
      agentId: string;
      refs: Array<{ kind: AgentContextElementKind; sha: string }>;
      anchors: string[];
    }
  /** Apply one content change (refs resolved to full SHAs); the controller checks the source's opt-in. */
  | {
      op: 'change';
      agentId: string;
      change: AgentContentControllerChange;
      source: AgentContentChangeSource;
    };

export interface AgentContextControllerMetadata {
  kind: AgentContextElementKind;
  sha: string;
  title: string;
  status?: string;
  priority?: string;
  nodeType?: string;
  parentSha?: string | null;
  size?: number;
}

export interface AgentContextControllerContent {
  kind: AgentContextElementKind;
  sha: string;
  title: string;
  /** Element version (`updatedAt`), passed back with content changes. */
  revision?: string;
  content: string;
}

export type AgentContextControllerResponse =
  | {
      ok: true;
      items?: AgentContextControllerMetadata[];
      contents?: AgentContextControllerContent[];
      changed?: AgentContentChangeResult;
    }
  /** `status` mirrors the HTTP status the controller would have answered with (change requests). */
  | { ok: false; error: string; status?: number };
