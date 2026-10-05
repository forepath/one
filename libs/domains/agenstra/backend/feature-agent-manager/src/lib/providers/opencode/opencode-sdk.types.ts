/**
 * Local OpenCode HTTP client typings used by the Nest CJS runtime.
 * Runtime loads `@opencode-ai/sdk` via dynamic `import()` (ESM-only package).
 */

export type TextPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'text';
  text: string;
  synthetic?: boolean;
};

export type ReasoningPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'reasoning';
  text: string;
};

export type ToolState =
  | {
      status: 'pending';
      input: Record<string, unknown>;
      raw: string;
    }
  | {
      status: 'running';
      input: Record<string, unknown>;
      title?: string;
      time: { start: number };
    }
  | {
      status: 'completed';
      input: Record<string, unknown>;
      output: string;
      title: string;
      metadata: Record<string, unknown>;
      time: { start: number; end: number };
    }
  | {
      status: 'error';
      input: Record<string, unknown>;
      error: string;
      time: { start: number; end: number };
    };

export type ToolPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'tool';
  callID: string;
  tool: string;
  state: ToolState;
};

export type SubtaskPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'subtask';
  prompt: string;
  description: string;
  agent: string;
};

export type AgentPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'agent';
  name: string;
  source?: {
    value: string;
    start: number;
    end: number;
  };
};

export type FilePart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'file';
  mime: string;
  filename?: string;
  url: string;
};

export type StepStartPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'step-start';
  snapshot?: string;
};

export type StepFinishPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'step-finish';
  reason: string;
  snapshot?: string;
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
};

export type PatchPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'patch';
  hash: string;
  files: string[];
};

export type RetryPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'retry';
  attempt: number;
  error?: { data?: { message?: string }; message?: string };
};

export type CompactionPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'compaction';
  auto: boolean;
};

export type Part =
  | TextPart
  | ReasoningPart
  | ToolPart
  | SubtaskPart
  | AgentPart
  | FilePart
  | StepStartPart
  | StepFinishPart
  | PatchPart
  | RetryPart
  | CompactionPart;

export type Session = {
  id: string;
  projectID: string;
  directory: string;
  title: string;
  version: string;
  parentID?: string;
  time: { created: number; updated: number };
};

export type FileDiff = {
  file: string;
  before?: string;
  after?: string;
  additions: number;
  deletions: number;
};

export type TodoItem = {
  id: string;
  content: string;
  status: string;
  priority: string;
};

export type SessionStatus =
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'retry'; attempt: number; message: string; next: number };

export type OpenCodeAgentInfo = {
  name: string;
  description?: string;
  mode: 'subagent' | 'primary' | 'all';
  builtIn: boolean;
  prompt?: string;
  model?: {
    modelID: string;
    providerID: string;
  };
  temperature?: number;
  color?: string;
  tools?: Record<string, boolean>;
  options?: Record<string, unknown>;
  maxSteps?: number;
};

export type AssistantMessageInfo = {
  id: string;
  sessionID: string;
  role: 'assistant';
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: {
      read: number;
      write: number;
    };
  };
  time?: {
    created: number;
    completed?: number;
  };
};

export type PermissionReply = 'once' | 'always' | 'reject';

export type QuestionOption = {
  id?: string;
  label?: string;
  description?: string;
};

export type QuestionInfo = {
  question?: string;
  header?: string;
  options?: QuestionOption[];
  multiple?: boolean;
};

/** SSE / bus events consumed by the OpenCode HTTP runtime (v1 + forward-compatible v2 shapes). */
export type Event =
  | { type: 'server.connected'; properties?: Record<string, never> }
  | {
      type: 'message.part.updated';
      properties: { part: Part; delta?: string };
    }
  | {
      type: 'message.updated';
      properties: { info: AssistantMessageInfo | { role?: string; sessionID?: string; [key: string]: unknown } };
    }
  | { type: 'session.idle'; properties: { sessionID: string } }
  | {
      type: 'session.created';
      properties: { info: Session };
    }
  | {
      type: 'session.updated';
      properties: { info: Session };
    }
  | {
      type: 'session.deleted';
      properties: { info: Session };
    }
  | {
      type: 'session.status';
      properties: { sessionID: string; status: SessionStatus };
    }
  | {
      type: 'session.compacted';
      properties: { sessionID: string };
    }
  | {
      type: 'session.diff';
      properties: { sessionID: string; diff: FileDiff[] };
    }
  | {
      type: 'session.error';
      properties: { sessionID?: string; error?: { data?: { message?: string }; message?: string } };
    }
  | {
      type: 'todo.updated';
      properties: { sessionID: string; todos: TodoItem[] };
    }
  | {
      type: 'command.executed';
      properties: { name: string; sessionID: string; arguments: string; messageID: string };
    }
  | {
      type: 'file.edited';
      properties: { file: string };
    }
  | {
      type: 'vcs.branch.updated';
      properties: { branch?: string };
    }
  | {
      type: 'permission.replied';
      properties: { sessionID: string; permissionID: string; response: string };
    }
  | {
      type: 'tui.toast.show';
      properties: {
        title?: string;
        message: string;
        variant: 'info' | 'success' | 'warning' | 'error';
        duration?: number;
      };
    }
  | {
      type: 'permission.updated';
      properties: {
        id: string;
        type: string;
        pattern?: string | string[];
        sessionID: string;
        title: string;
        metadata: Record<string, unknown>;
      };
    }
  | {
      type: 'permission.asked';
      properties?: {
        id: string;
        sessionID: string;
        permission: string;
        patterns?: string[];
        metadata?: Record<string, unknown>;
        always?: string[];
      };
      data?: {
        id: string;
        sessionID: string;
        permission: string;
        patterns?: string[];
        metadata?: Record<string, unknown>;
        always?: string[];
      };
    }
  | {
      type: 'permission.v2.asked';
      properties?: {
        id: string;
        sessionID: string;
        action: string;
        resources?: string[];
        metadata?: Record<string, unknown>;
      };
      data?: {
        id: string;
        sessionID: string;
        action: string;
        resources?: string[];
        metadata?: Record<string, unknown>;
      };
    }
  | {
      type: 'question.asked';
      properties?: {
        id?: string;
        requestID?: string;
        sessionID: string;
        questions: QuestionInfo[];
      };
      data?: {
        id?: string;
        requestID?: string;
        sessionID: string;
        questions: QuestionInfo[];
      };
    }
  | {
      type: 'question.v2.asked';
      properties?: {
        id?: string;
        requestID?: string;
        sessionID: string;
        questions: QuestionInfo[];
      };
      data?: {
        id?: string;
        requestID?: string;
        sessionID: string;
        questions: QuestionInfo[];
      };
    };

export type RequestResult<T> = {
  data?: T;
  error?: unknown;
  request?: Request;
  response?: Response;
};

export type OpencodeClient = {
  session: {
    create(options?: {
      body?: {
        parentID?: string;
        title?: string;
        agent?: string;
        permission?: Array<{ permission: string; pattern: string; action: 'allow' | 'deny' | 'ask' }>;
      };
    }): Promise<RequestResult<Session>>;
    get(options: { path: { id: string } }): Promise<RequestResult<Session>>;
    promptAsync(options: {
      path: { id: string };
      body?: {
        parts: Array<{ type: 'text'; text: string }>;
        model?: { providerID: string; modelID: string };
        agent?: string;
        format?: { type: 'text' } | { type: 'json_schema'; schema: Record<string, unknown>; retryCount?: number };
      };
    }): Promise<RequestResult<void>>;
    prompt(options: {
      path: { id: string };
      body?: {
        parts: Array<{ type: 'text'; text: string }>;
        model?: { providerID: string; modelID: string };
        agent?: string;
        format?: { type: 'text' } | { type: 'json_schema'; schema: Record<string, unknown>; retryCount?: number };
      };
    }): Promise<RequestResult<{ info: unknown; parts: Part[] }>>;
  };
  event: {
    subscribe(options?: { signal?: AbortSignal }): Promise<{
      stream: AsyncGenerator<Event>;
    }>;
  };
  /** v1 top-level permission reply (session-scoped). */
  postSessionIdPermissionsPermissionId?(options: {
    path: { id: string; permissionID: string };
    body?: { response: PermissionReply };
  }): Promise<RequestResult<boolean>>;
  /** Optional nested permission API (newer SDK shapes). */
  permission?: {
    reply(options: { requestID: string; reply?: PermissionReply; message?: string }): Promise<RequestResult<boolean>>;
  };
  /** Question / form reply APIs. */
  question?: {
    reply(options: { requestID: string; answers?: string[][] }): Promise<RequestResult<boolean>>;
    reject(options: { requestID: string }): Promise<RequestResult<boolean>>;
  };
  config?: {
    get(options?: Record<string, unknown>): Promise<RequestResult<Record<string, unknown>>>;
    update(options?: { body?: Record<string, unknown> }): Promise<RequestResult<Record<string, unknown>>>;
    providers?(options?: Record<string, unknown>): Promise<
      RequestResult<{
        providers: Array<{
          id: string;
          name: string;
          models: Record<string, { id: string; name?: string; providerID?: string }>;
        }>;
        default?: Record<string, string>;
      }>
    >;
  };
  /** Provider list / auth APIs. */
  provider?: {
    list(options?: Record<string, unknown>): Promise<
      RequestResult<{
        all?: Array<{
          id: string;
          name?: string;
          models?: Record<string, { id: string; name?: string }>;
        }>;
        connected?: Array<{
          id: string;
          name?: string;
          models?: Record<string, { id: string; name?: string }>;
        }>;
      }>
    >;
    auth?(options?: Record<string, unknown>): Promise<RequestResult<Record<string, unknown>>>;
  };
  /** Provider API-key auth (optional; present when server supports it). */
  auth?: {
    set(options: {
      path: { id: string };
      body?: { type: 'api'; key: string } | Record<string, unknown>;
    }): Promise<RequestResult<boolean>>;
  };
  /** App APIs (agents list, logging). */
  app?: {
    agents(options?: Record<string, unknown>): Promise<RequestResult<OpenCodeAgentInfo[]>>;
  };
};

export type CreateOpencodeClient = (config?: {
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: (request: Request) => ReturnType<typeof fetch>;
  directory?: string;
}) => OpencodeClient;
