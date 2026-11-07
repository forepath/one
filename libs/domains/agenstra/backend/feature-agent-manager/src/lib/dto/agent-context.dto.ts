import {
  isAgentContextElementKind,
  type AgentContextElementKind,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException } from '@nestjs/common';

import { AGENT_CONTEXT_MAX_MOUNT_LOOKUP_LENGTH } from '../constants/agent-context.constants';

/** Query of GET /agent-context/tickets/:ticket/search (raw strings; normalized by {@link parseAgentContextSearchQuery}). */
export interface AgentContextSearchQueryDto {
  query?: string;
  /** Comma-separated: `ticket`, `knowledge`, `plan`. */
  kinds?: string | string[];
  limit?: string;
}

/** Body of POST /agent-context/tickets/:ticket/access-requests. */
export interface AgentContextAccessRequestDto {
  refs: string[];
  reason?: string;
}

const MAX_QUERY_LENGTH = 200;
const MAX_REASON_LENGTH = 1000;

/**
 * The agent-manager has no global ValidationPipe, so agent-facing input is normalized here.
 */
export function parseAgentContextSearchQuery(raw: AgentContextSearchQueryDto | undefined): {
  query?: string;
  kinds?: Array<AgentContextElementKind>;
  limit?: number;
} {
  const query = typeof raw?.query === 'string' ? raw.query.trim().slice(0, MAX_QUERY_LENGTH) : undefined;
  const kindValues = (Array.isArray(raw?.kinds) ? raw.kinds : typeof raw?.kinds === 'string' ? [raw.kinds] : [])
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  const kinds: Array<AgentContextElementKind> = [];

  for (const value of kindValues) {
    if (!isAgentContextElementKind(value)) {
      throw new BadRequestException(`Unknown kind '${value}' (expected ticket, knowledge or plan)`);
    }

    if (!kinds.includes(value)) {
      kinds.push(value);
    }
  }

  const parsedLimit = raw?.limit !== undefined ? Number.parseInt(String(raw.limit), 10) : undefined;

  return {
    ...(query ? { query } : {}),
    ...(kinds.length ? { kinds } : {}),
    ...(parsedLimit !== undefined && Number.isFinite(parsedLimit) ? { limit: parsedLimit } : {}),
  };
}

export function parseAgentContextAccessRequest(raw: unknown): AgentContextAccessRequestDto {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const refs = body['refs'];

  if (!Array.isArray(refs) || refs.some((ref) => typeof ref !== 'string')) {
    throw new BadRequestException('refs must be an array of strings');
  }

  const reason = typeof body['reason'] === 'string' ? body['reason'].slice(0, MAX_REASON_LENGTH) : undefined;

  return { refs: refs as string[], ...(reason ? { reason } : {}) };
}

/** Query of GET /agent-context/tickets/:ticket/mounts. */
export interface AgentContextMountsQueryDto {
  resolve?: string | string[];
}

export function parseAgentContextMountsQuery(raw: AgentContextMountsQueryDto | undefined): { resolve?: string } {
  const value = raw?.resolve;

  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'string') {
    throw new BadRequestException('resolve must be a single string');
  }

  const resolve = value.trim();

  if (resolve.length > AGENT_CONTEXT_MAX_MOUNT_LOOKUP_LENGTH) {
    throw new BadRequestException(`resolve must be at most ${AGENT_CONTEXT_MAX_MOUNT_LOOKUP_LENGTH} characters`);
  }

  return resolve ? { resolve } : {};
}
