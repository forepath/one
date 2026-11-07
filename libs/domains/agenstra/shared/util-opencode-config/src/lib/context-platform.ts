import type { JsonObject } from './types';

/**
 * Platform-managed MCP server inside every worker that serves prompt context on demand
 * (tickets, knowledge, chat plans of the agent's environment, attachments) instead of inlining it into the prompt.
 *
 * OpenCode names MCP tools `<server>_<tool>`, so the agent sees `agenstra_context_*`.
 */
export const AGENSTRA_CONTEXT_MCP_SERVER_KEY = 'agenstra';

/** Bundled MCP server shipped in the worker image (`apps/agenstra/agent-context-mcp`). */
export const AGENSTRA_CONTEXT_MCP_BIN_PATH = '/opt/agenstra/mcp/agenstra-context-mcp.cjs';

/** OpenCode permission key covering every context tool (wildcard on the tool id). */
export const AGENSTRA_CONTEXT_MCP_TOOL_PERMISSION = 'agenstra_context_*';

export const AGENSTRA_CONTEXT_MCP_TOOL_NAMES = {
  list: 'context_list',
  search: 'context_search',
  get: 'context_get',
  requestAccess: 'context_request_access',
  mounts: 'context_mounts',
} as const;

/**
 * Read-only mount of the manager host's agent directories inside every worker. Each environment's working directory
 * (host `/opt/agents/<mount id>`) appears as `/opt/workspace/<mount id>`; mount ids are not environment ids.
 */
export const AGENSTRA_WORKSPACE_MOUNT_ROOT = '/opt/workspace';

/** Environment passed to the MCP process through the OpenCode `mcp.<key>.environment` block. */
export const AGENSTRA_CONTEXT_MCP_ENV = {
  apiUrl: 'AGENSTRA_CONTEXT_API_URL',
  agentId: 'AGENSTRA_CONTEXT_AGENT_ID',
  agentToken: 'AGENSTRA_CONTEXT_AGENT_TOKEN',
} as const;

/** HTTP headers the MCP server uses to authenticate against the agent-manager context API. */
export const AGENSTRA_CONTEXT_API_HEADERS = {
  agentId: 'x-agenstra-agent-id',
  ticket: 'x-agenstra-context-ticket',
} as const;

/** Manager route prefix (below the global `/api` prefix) for the agent-facing context API. */
export const AGENSTRA_CONTEXT_API_ROUTE = 'agent-context';

/** Tool calls may long-poll while a user decides on an access request. */
export const AGENSTRA_CONTEXT_MCP_TIMEOUT_MS = 180_000;

export type AgentContextItemKind = 'ticket' | 'knowledge' | 'plan' | 'context';

/** Element kinds addressable by SHA (`<kind>:<sha>` refs, grants, search). Plans are scoped to the agent's environment. */
export const AGENT_CONTEXT_ELEMENT_KINDS = ['ticket', 'knowledge', 'plan'] as const;

export type AgentContextElementKind = (typeof AGENT_CONTEXT_ELEMENT_KINDS)[number];

export function isAgentContextElementKind(value: unknown): value is AgentContextElementKind {
  return typeof value === 'string' && (AGENT_CONTEXT_ELEMENT_KINDS as readonly string[]).includes(value);
}

/** Metadata about one context element. Content is only served for granted refs. */
export interface AgentContextItemSummary {
  /** Stable ref usable with `context_get`: `ticket:<sha>`, `knowledge:<sha>`, `plan:<sha>` or `item:<n>`. */
  ref: string;
  kind: AgentContextItemKind;
  title: string;
  sha?: string;
  status?: string;
  priority?: string;
  nodeType?: string;
  parentSha?: string | null;
  /** Content length in characters when known. */
  size?: number;
  granted: boolean;
}

export interface AgentContextAttachmentSummary {
  fileName: string;
  contentType: string;
  byteSize: number;
  agentPath: string;
}

export interface AgentContextListResponse {
  ticket: string;
  items: AgentContextItemSummary[];
  attachments: AgentContextAttachmentSummary[];
  workspace?: { mountPath: string };
  /** Environments selected as context; name / mount path are added when they belong to the agent's workspace. */
  environments: AgentContextEnvironmentSummary[];
  /** True when the agent may ask the user (or the platform) for additional refs. */
  canRequestAccess: boolean;
}

export interface AgentContextEnvironmentSummary {
  id: string;
  name?: string;
  /** Read-only path of the environment's working directory (below {@link AGENSTRA_WORKSPACE_MOUNT_ROOT}). */
  mountPath?: string;
}

/** One environment of the agent's workspace and where its working directory is mounted. */
export interface AgentContextMountSummary {
  /** Environment (agent) id. */
  environmentId: string;
  name: string;
  description?: string;
  repositoryUrl?: string;
  /** Directory name below {@link AGENSTRA_WORKSPACE_MOUNT_ROOT} (differs from the environment id). */
  mountId?: string;
  /** Read-only path of the environment's working directory; absent when it has none on this host. */
  mountPath?: string;
  /** The calling environment itself. */
  self?: boolean;
  /** Writable working directory of the calling environment (its own repository). */
  workingDirectory?: string;
  /** Selected as context for this request. */
  selected?: boolean;
}

/** Result of resolving an environment id, mount id or path (`context_mounts` with `resolve`). */
export interface AgentContextMountResolution {
  input: string;
  environmentId: string;
  /** Path of the input below the environment's directory (`""` for the directory itself), when a path was given. */
  relativePath?: string;
  /** Absolute read-only path of the input (mount path + relative path). */
  mountedPath?: string;
}

export interface AgentContextMountsResponse {
  root: string;
  readOnly: true;
  /** Environments of the workspace (only the resolved one when `resolve` matched). */
  mounts: AgentContextMountSummary[];
  resolved?: AgentContextMountResolution;
  /** Why the list is incomplete or a lookup failed. */
  note?: string;
}

export interface AgentContextSearchResponse {
  items: AgentContextItemSummary[];
}

export interface AgentContextGetResponse {
  ref: string;
  kind: AgentContextItemKind;
  title: string;
  /** Full SHA of tickets / knowledge elements / plans (target of `agenstra_content_*` changes). */
  sha?: string;
  /** Version of a ticket / knowledge element / plan; content changes pass it back (`revision`). */
  revision?: string;
  content: string;
}

export type AgentContextAccessDecision = 'granted' | 'denied' | 'pending';

export interface AgentContextAccessResponse {
  requestId: string;
  decision: AgentContextAccessDecision;
  refs: string[];
  message?: string;
}

const REF_PATTERN = /^(ticket|knowledge|plan):([0-9a-f]{4,40})$|^item:(\d{1,4})$/i;

/** Parse a context ref. SHAs are normalized to lower case; unknown shapes return null. */
export function parseAgentContextRef(
  raw: string,
): { kind: AgentContextElementKind; sha: string } | { kind: 'item'; index: number } | null {
  const match = REF_PATTERN.exec(raw.trim());

  if (!match) {
    return null;
  }

  if (match[3] !== undefined) {
    return { kind: 'item', index: Number.parseInt(match[3], 10) };
  }

  return { kind: match[1].toLowerCase() as AgentContextElementKind, sha: match[2].toLowerCase() };
}

/** True when two SHAs refer to the same element (full SHA vs. short prefix, min 4 chars). */
export function agentContextShaMatches(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();

  if (left.length < 4 || right.length < 4) {
    return false;
  }

  return left.startsWith(right) || right.startsWith(left);
}

export interface PlatformContextMcpWireOptions {
  apiUrl: string;
  agentId: string;
  agentToken: string;
}

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Inject the platform context MCP server into an OpenCode wire config. Runs after allow/deny filtering
 * so user overlays cannot remove or replace it. The root `permission` block is left untouched: session
 * rulesets (automation / plan) allow {@link AGENSTRA_CONTEXT_MCP_TOOL_PERMISSION} explicitly.
 */
export function injectPlatformContextMcpWire(wire: JsonObject, options: PlatformContextMcpWireOptions): JsonObject {
  const next: JsonObject = { ...wire };
  const mcp = isPlainObject(next['mcp']) ? { ...(next['mcp'] as JsonObject) } : {};

  mcp[AGENSTRA_CONTEXT_MCP_SERVER_KEY] = {
    type: 'local',
    command: ['node', AGENSTRA_CONTEXT_MCP_BIN_PATH],
    environment: {
      [AGENSTRA_CONTEXT_MCP_ENV.apiUrl]: options.apiUrl,
      [AGENSTRA_CONTEXT_MCP_ENV.agentId]: options.agentId,
      [AGENSTRA_CONTEXT_MCP_ENV.agentToken]: options.agentToken,
    },
    enabled: true,
    timeout: AGENSTRA_CONTEXT_MCP_TIMEOUT_MS,
  };
  next['mcp'] = mcp;

  return next;
}

/** Drop the platform context MCP server from a live MCP status map (it is not user-managed). */
export function isPlatformContextMcpServerKey(key: string): boolean {
  return key.trim() === AGENSTRA_CONTEXT_MCP_SERVER_KEY;
}

/** True for OpenCode permission names / tool ids belonging to the platform context MCP server. */
export function isAgenstraContextToolPermission(permissionType: string | undefined): boolean {
  return (
    typeof permissionType === 'string' &&
    permissionType.trim().toLowerCase().startsWith(`${AGENSTRA_CONTEXT_MCP_SERVER_KEY}_context_`)
  );
}
