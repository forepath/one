import type { TicketResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';

function formatPromptLinesForTicket(ticket: TicketResponseDto, depth: number): string[] {
  const indent = '  '.repeat(depth);
  const lines: string[] = [`${indent}- [${ticket.id}] ${ticket.title} (${ticket.status}, ${ticket.priority})`];

  if (ticket.content?.trim()) {
    lines.push(`${indent}  Content:\n${indent}  ${ticket.content.trim().split('\n').join(`\n${indent}  `)}`);
  }

  return lines;
}

function formatSubtree(root: TicketResponseDto, depth: number): string {
  const parts: string[] = [...formatPromptLinesForTicket(root, depth)];

  for (const child of root.children ?? []) {
    parts.push(formatSubtree(child, depth + 1));
  }

  return parts.join('\n');
}

/**
 * Plain-text ticket hierarchy for AI body generation, aligned with prototype prompt formatting.
 * Uses board breadcrumb for parents and `detail.children` for the full nested subtask tree.
 */
export function buildTicketBodyHierarchyContext(
  detail: TicketResponseDto,
  breadcrumbRootToCurrent: TicketResponseDto[],
): string {
  const parents = breadcrumbRootToCurrent.length > 1 ? breadcrumbRootToCurrent.slice(0, -1) : [];
  const blocks: string[] = [];

  if (parents.length > 0) {
    const parentLines: string[] = [];

    parents.forEach((p, index) => {
      parentLines.push(...formatPromptLinesForTicket(p, index));
    });
    blocks.push(`Parent tickets (root → immediate parent):\n${parentLines.join('\n')}`);
  }

  const children = detail.children ?? [];

  if (children.length > 0) {
    const subParts = children.map((c) => formatSubtree(c, 0));

    blocks.push(`Subtasks under this ticket:\n${subParts.join('\n')}`);
  }

  if (blocks.length === 0) {
    return '';
  }

  return blocks.join('\n\n');
}
