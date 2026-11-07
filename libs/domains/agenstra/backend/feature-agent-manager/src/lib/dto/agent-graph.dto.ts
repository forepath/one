import {
  AGENT_GRAPH_LIMITS,
  isAgentGraphEdgeType,
  isAgentGraphQueryLayer,
  isAgentGraphNodeType,
  isValidAgentGraphNodeId,
  type AgentGraphComposeRequest,
  type AgentGraphEdgeType,
  type AgentGraphQueryLayer,
  type AgentGraphNodeType,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException } from '@nestjs/common';

/**
 * The agent-manager has no global ValidationPipe, so graph query input (user API and agent API) is normalized here.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_COMPOSE_ENVIRONMENTS = 200;

export function parseAgentGraphLayer(value: unknown, fallback: AgentGraphQueryLayer = 'code'): AgentGraphQueryLayer {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (!isAgentGraphQueryLayer(value)) {
    throw new BadRequestException('layer must be one of all, code, paths, references');
  }

  return value;
}

/** Page start of a paginated graph document. */
export function parseAgentGraphOffset(value: unknown): number {
  return parseAgentGraphInt(value, 0, 0, Number.MAX_SAFE_INTEGER, 'offset');
}

export function parseAgentGraphInt(value: unknown, fallback: number, min: number, max: number, name = 'limit'): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = typeof value === 'number' ? value : Number(String(value));

  if (!Number.isFinite(parsed)) {
    throw new BadRequestException(`${name} must be a number`);
  }

  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function parseAgentGraphNodeTypes(value: unknown): Set<AgentGraphNodeType> | undefined {
  const list = splitList(value);

  if (!list) {
    return undefined;
  }

  const invalid = list.filter((entry) => !isAgentGraphNodeType(entry));

  if (invalid.length > 0) {
    throw new BadRequestException(`Unknown node types: ${invalid.slice(0, 5).join(', ')}`);
  }

  return new Set(list as AgentGraphNodeType[]);
}

export function parseAgentGraphEdgeTypes(value: unknown): Set<AgentGraphEdgeType> | undefined {
  const list = splitList(value);

  if (!list) {
    return undefined;
  }

  const invalid = list.filter((entry) => !isAgentGraphEdgeType(entry));

  if (invalid.length > 0) {
    throw new BadRequestException(`Unknown edge types: ${invalid.slice(0, 5).join(', ')}`);
  }

  return new Set(list as AgentGraphEdgeType[]);
}

export function parseAgentGraphNodeId(value: unknown, name = 'id'): string {
  if (!isValidAgentGraphNodeId(value)) {
    throw new BadRequestException(`${name} must be a node id of at most ${AGENT_GRAPH_LIMITS.idMaxLength} characters`);
  }

  return value;
}

export function parseAgentGraphQuery(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException('query must be a non-empty string');
  }

  if (value.length > AGENT_GRAPH_LIMITS.queryMaxLength) {
    throw new BadRequestException(`query must be at most ${AGENT_GRAPH_LIMITS.queryMaxLength} characters`);
  }

  return value.trim();
}

/** Optional short string (environment lookup, prompt id). */
export function parseAgentGraphOptionalString(
  value: unknown,
  name: string,
  maxLength: number = AGENT_GRAPH_LIMITS.idMaxLength,
): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) {
    throw new BadRequestException(`${name} must be a string of at most ${maxLength} characters`);
  }

  return value.trim() || undefined;
}

/** Relative path inside the working directory (`..` segments are rejected). */
export function parseAgentGraphRelativePath(value: unknown, workingDirectory: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > AGENT_GRAPH_LIMITS.idMaxLength ||
    value.includes('\0')
  ) {
    throw new BadRequestException('path must be a non-empty path');
  }

  let path = value.trim();

  if (path.startsWith(`${workingDirectory}/`)) {
    path = path.slice(workingDirectory.length + 1);
  } else if (path.startsWith('/')) {
    throw new BadRequestException(`path must be relative to ${workingDirectory}`);
  }

  path = path.replace(/^(\.\/)+/, '').replace(/\/+$/, '');

  if (!path || path.split('/').some((segment) => segment === '..')) {
    throw new BadRequestException('path must stay inside the working directory');
  }

  return path;
}

export function parseAgentGraphComposeRequest(raw: unknown): AgentGraphComposeRequest {
  const body = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const ids = body['environmentIds'];

  if (
    !Array.isArray(ids) ||
    ids.length > MAX_COMPOSE_ENVIRONMENTS ||
    ids.some((id) => typeof id !== 'string' || !UUID_V4.test(id))
  ) {
    throw new BadRequestException(`environmentIds must be an array of at most ${MAX_COMPOSE_ENVIRONMENTS} UUIDs`);
  }

  const names: Record<string, string> = {};
  const rawNames = body['names'];

  if (rawNames && typeof rawNames === 'object' && !Array.isArray(rawNames)) {
    for (const [id, name] of Object.entries(rawNames as Record<string, unknown>)) {
      if (UUID_V4.test(id) && typeof name === 'string' && name.trim()) {
        names[id] = name.trim().slice(0, 200);
      }
    }
  }

  return {
    environmentIds: [...new Set(ids as string[])],
    layer: parseAgentGraphLayer(body['layer']),
    limit: parseAgentGraphInt(
      body['limit'],
      AGENT_GRAPH_LIMITS.defaultDocumentNodes,
      1,
      AGENT_GRAPH_LIMITS.maxDocumentNodes,
    ),
    names,
  };
}

function splitList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const raw = Array.isArray(value) ? value.join(',') : String(value);
  const list = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return list.length > 0 ? list.slice(0, 50) : undefined;
}
