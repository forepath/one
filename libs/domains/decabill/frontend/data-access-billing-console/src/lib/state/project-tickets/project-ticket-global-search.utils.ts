import type { ProjectTicketResponse } from '../../types/projects.types';

export interface ProjectTicketGlobalSearchHit {
  ticket: ProjectTicketResponse;
  pathTitles: string[];
}

function normalizeNeedle(query: string): string {
  return query.trim().toLowerCase();
}

export function matchesTicketSearchQuery(ticket: ProjectTicketResponse, needleLower: string): boolean {
  if (!needleLower) return false;

  const title = ticket.title?.toLowerCase() ?? '';
  const content = ticket.content?.toLowerCase() ?? '';
  const id = ticket.id?.toLowerCase() ?? '';

  return title.includes(needleLower) || content.includes(needleLower) || id.includes(needleLower);
}

export function buildTicketBreadcrumbTitles(list: ProjectTicketResponse[], ticketId: string): string[] {
  const byId = new Map(list.map((t) => [t.id, t]));
  const titles: string[] = [];
  const visited = new Set<string>();
  let cur: ProjectTicketResponse | undefined = byId.get(ticketId);

  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    titles.unshift(cur.title);
    const parentId = cur.parentId;

    cur = parentId != null && parentId !== '' ? byId.get(parentId) : undefined;
  }

  return titles;
}

export function filterTicketsForGlobalSearch(
  list: ProjectTicketResponse[],
  query: string,
  projectId?: string | null,
): ProjectTicketGlobalSearchHit[] {
  const needle = normalizeNeedle(query);

  if (!needle) return [];

  const scoped = projectId ? list.filter((t) => t.projectId === projectId) : list;
  const hits: ProjectTicketGlobalSearchHit[] = [];

  for (const ticket of scoped) {
    if (matchesTicketSearchQuery(ticket, needle)) {
      hits.push({
        ticket,
        pathTitles: buildTicketBreadcrumbTitles(list, ticket.id),
      });
    }
  }

  return hits.sort((a, b) => a.ticket.title.toLowerCase().localeCompare(b.ticket.title.toLowerCase()));
}
