import type { AgentResponseDto, EnvironmentProgress } from '@forepath/agenstra/frontend/data-access-agent-console';

/** Row of the environments rail table: a listed environment or a create still provisioning. */
export interface ChatEnvironmentRailRow {
  id: string;
  name: string;
  agent: AgentResponseDto | null;
  pending: EnvironmentProgress | null;
}

/** Server request of one rail page (replace-page paging: exactly this page is loaded and shown). */
export interface ChatRailPageQuery {
  limit: number;
  offset: number;
  search?: string;
}

/** Limit / offset / search of a 1-based rail page. */
export function chatRailPageQuery(
  page: number,
  pageSize: number,
  search: string | null | undefined,
): ChatRailPageQuery {
  const limit = Math.max(1, Math.floor(pageSize));
  const offset = (Math.max(1, Math.floor(page)) - 1) * limit;
  const trimmed = search?.trim();

  return trimmed ? { limit, offset, search: trimmed } : { limit, offset };
}

/**
 * Rows of the environments rail: the loaded server page, preceded on the first page by environments that are still
 * being created (they are not listed by the server yet).
 */
export function chatEnvironmentRailRows(
  page: number,
  pending: EnvironmentProgress[],
  agents: AgentResponseDto[],
): ChatEnvironmentRailRow[] {
  const pendingRows: ChatEnvironmentRailRow[] =
    page === 1
      ? pending.map((progress) => ({
          id: `pending:${progress.operationId}`,
          name: progress.agentName,
          agent: null,
          pending: progress,
        }))
      : [];

  return [...pendingRows, ...agents.map((agent) => ({ id: agent.id, name: agent.name, agent, pending: null }))];
}
