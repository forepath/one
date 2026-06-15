import type { TicketResponseDto } from './tickets.types';

export interface TicketGlobalSearchHit {
  ticket: TicketResponseDto;
  /** Root → … → this ticket (titles), for subtask context in UI. */
  pathTitles: string[];
}

function normalizeNeedle(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Whether the ticket matches a non-empty search needle (title, content, or id substring).
 */
export function matchesTicketSearchQuery(ticket: TicketResponseDto, needleLower: string): boolean {
  if (!needleLower) {
    return false;
  }

  const title = ticket.title?.toLowerCase() ?? '';
  const content = ticket.content?.toLowerCase() ?? '';
  const id = ticket.id?.toLowerCase() ?? '';

  return title.includes(needleLower) || content.includes(needleLower) || id.includes(needleLower);
}

/**
 * Titles from workspace root ancestor → `ticketId` (inclusive), using flat `list`. Missing parents yield partial chain.
 */
export function buildTicketBreadcrumbTitles(list: TicketResponseDto[], ticketId: string): string[] {
  const byId = new Map(list.map((t) => [t.id, t]));
  const titles: string[] = [];
  const visited = new Set<string>();
  let cur: TicketResponseDto | undefined = byId.get(ticketId);

  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    titles.unshift(cur.title);
    const parentId = cur.parentId;

    cur = parentId != null && parentId !== '' ? byId.get(parentId) : undefined;
  }

  return titles;
}

/**
 * Whether the ticket matches a non-empty needle for context picker suggestions
 * (title substring, short SHA substring, long SHA substring). Case-insensitive.
 */
export function matchesTicketContextSuggestionQuery(ticket: TicketResponseDto, needleLower: string): boolean {
  if (!needleLower) {
    return false;
  }

  const title = ticket.title?.toLowerCase() ?? '';

  if (title.includes(needleLower)) {
    return true;
  }

  const shortSha = ticket.shas?.short?.toLowerCase() ?? '';
  const longSha = ticket.shas?.long?.toLowerCase() ?? '';

  return shortSha.includes(needleLower) || longSha.includes(needleLower);
}

/**
 * Suggestion list for ticket chat context: `permittedTickets` should already be
 * scoped to boards/workspaces the user may access (e.g. API-loaded list for active client).
 */
export function filterTicketsForTicketContextSuggestions(
  permittedTickets: TicketResponseDto[],
  query: string,
  options?: { limit?: number },
): TicketResponseDto[] {
  const needle = normalizeNeedle(query);

  if (!needle) {
    return [];
  }

  const limit = options?.limit ?? 20;
  const hits = permittedTickets.filter((ticket) => matchesTicketContextSuggestionQuery(ticket, needle));

  hits.sort((a, b) => {
    const ta = a.title.toLowerCase();
    const tb = b.title.toLowerCase();

    if (ta !== tb) {
      return ta.localeCompare(tb);
    }

    return (a.shas?.short ?? '').localeCompare(b.shas?.short ?? '');
  });

  return hits.slice(0, limit);
}

/**
 * Exact short- or long-SHA match within an allowlisted ticket set (permitted workspace tickets).
 */
export function findPermittedTicketByExactSha(
  permittedTickets: TicketResponseDto[],
  rawInput: string,
): TicketResponseDto | undefined {
  const input = rawInput.trim().toLowerCase();

  if (!input) {
    return undefined;
  }

  return permittedTickets.find((row) => {
    const shortSha = row.shas?.short?.toLowerCase() ?? '';
    const longSha = row.shas?.long?.toLowerCase() ?? '';

    return shortSha === input || longSha === input;
  });
}

/**
 * Tickets matching `query` in the given workspace list. Empty/whitespace `query` yields no hits.
 * When `clientId` is set, only tickets for that client are considered.
 */
export function filterTicketsForGlobalSearch(
  list: TicketResponseDto[],
  query: string,
  clientId?: string | null,
): TicketGlobalSearchHit[] {
  const needle = normalizeNeedle(query);

  if (!needle) {
    return [];
  }

  const scoped = clientId ? list.filter((t) => t.clientId === clientId) : list;
  const hits: TicketGlobalSearchHit[] = [];

  for (const ticket of scoped) {
    if (matchesTicketSearchQuery(ticket, needle)) {
      hits.push({
        ticket,
        pathTitles: buildTicketBreadcrumbTitles(list, ticket.id),
      });
    }
  }

  return hits.sort((a, b) => {
    const ta = a.ticket.title.toLowerCase();
    const tb = b.ticket.title.toLowerCase();

    if (ta !== tb) {
      return ta.localeCompare(tb);
    }

    return a.ticket.id.localeCompare(b.ticket.id);
  });
}
