import {
  matchesTicketSearchQuery,
  type KnowledgeNodeDto,
  type TicketResponseDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';

export function flattenKnowledgeFolders(nodes: readonly KnowledgeNodeDto[]): KnowledgeNodeDto[] {
  const out: KnowledgeNodeDto[] = [];
  const walk = (items: readonly KnowledgeNodeDto[]) => {
    for (const n of items) {
      if (n.nodeType === 'folder') {
        out.push(n);
      }

      if (n.children?.length) {
        walk(n.children);
      }
    }
  };

  walk(nodes);

  return out;
}

export function filterKnowledgeFoldersForImportSuggest(
  folders: readonly KnowledgeNodeDto[],
  query: string,
  limit = 20,
): KnowledgeNodeDto[] {
  const q = query.trim().toLowerCase();

  if (!q) {
    return folders.slice(0, limit);
  }

  return folders
    .filter((n) => {
      const title = n.title?.toLowerCase() ?? '';
      const id = n.id.toLowerCase();
      const shortSha = n.shas?.short?.toLowerCase() ?? '';
      const longSha = n.shas?.long?.toLowerCase() ?? '';

      return (
        title.includes(q) || id.includes(q) || shortSha.startsWith(q) || longSha.startsWith(q) || longSha.includes(q)
      );
    })
    .slice(0, limit);
}

export function filterTicketsForImportParentSuggest(
  tickets: readonly TicketResponseDto[],
  clientId: string,
  query: string,
  limit = 20,
): TicketResponseDto[] {
  const rows = tickets.filter((t) => t.clientId === clientId);
  const q = query.trim().toLowerCase();

  if (!q) {
    return rows.slice(0, limit);
  }

  return rows.filter((t) => matchesTicketSearchQuery(t, q)).slice(0, limit);
}
