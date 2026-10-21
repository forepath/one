import { AGENSTRA_CONTEXT_MCP_SERVER_KEY } from '@forepath/agenstra/shared/util-opencode-config';

import type { AgentContextStoredItem, AgentContextTicketRecord } from '../types/agent-context.types';
import type { ContextInjectionPayload } from '../types/context-injection.types';

const MAX_TITLE_LENGTH = 120;
const TICKET_LINE = /^\s*-\s*\[[^\]]+\]\s*(.+?)\s*\(([^,()]+),\s*([^()]+)\)\s*$/;
const KNOWLEDGE_PAGE_PREFIX = 'Knowledge Page:';
const KNOWLEDGE_EXCERPT_PREFIX = 'Knowledge Page Context:';

function clip(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();

  return collapsed.length <= MAX_TITLE_LENGTH ? collapsed : `${collapsed.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

/** First ticket line of a prototype prompt (`- [id] Title (status, priority)`). */
export function titleFromTicketPrompt(prompt: string): string | undefined {
  for (const line of prompt.split('\n')) {
    const match = TICKET_LINE.exec(line);

    if (match) {
      return clip(match[1]);
    }
  }

  return undefined;
}

/** Classify a knowledge / relation section and derive a display title. */
export function describeKnowledgeSection(
  section: string,
  ordinal: number,
): Pick<AgentContextStoredItem, 'kind' | 'title'> {
  const firstLine = section.trimStart().split('\n', 1)[0] ?? '';

  if (firstLine.startsWith(KNOWLEDGE_PAGE_PREFIX)) {
    return {
      kind: 'knowledge',
      title: clip(firstLine.slice(KNOWLEDGE_PAGE_PREFIX.length)) || `Knowledge page ${ordinal}`,
    };
  }

  if (firstLine.startsWith(KNOWLEDGE_EXCERPT_PREFIX)) {
    const body = section.trimStart().slice(KNOWLEDGE_EXCERPT_PREFIX.length);

    return { kind: 'knowledge', title: `Knowledge excerpt: ${clip(body.trim().split('\n', 1)[0] ?? '')}` };
  }

  const ticketTitle = titleFromTicketPrompt(section);

  if (ticketTitle) {
    return { kind: 'ticket', title: ticketTitle };
  }

  return { kind: 'context', title: clip(firstLine) || `Context section ${ordinal}` };
}

/**
 * Turn the (controller-resolved) inline context of a prompt into ticket items.
 * Content is kept verbatim so MCP reads return exactly what used to be inlined.
 */
export function deriveAgentContextItems(
  contextInjection: ContextInjectionPayload | undefined,
): Array<Omit<AgentContextStoredItem, 'index'>> {
  if (!contextInjection) {
    return [];
  }

  const items: Array<Omit<AgentContextStoredItem, 'index'>> = [];
  const ticketRefs = contextInjection.ticketContextRefs ?? [];

  (contextInjection.ticketContexts ?? []).forEach((content, i) => {
    const trimmed = content.trim();

    if (!trimmed) {
      return;
    }

    const ref = ticketRefs[i];
    const sha = ref?.sha?.trim().toLowerCase();

    items.push({
      kind: 'ticket',
      title: clip(ref?.title ?? '') || titleFromTicketPrompt(trimmed) || `Ticket ${sha?.slice(0, 8) ?? i + 1}`,
      ...(sha ? { sha } : {}),
      content: trimmed,
    });
  });

  (contextInjection.knowledgeContexts ?? []).forEach((content, i) => {
    const trimmed = content.trim();

    if (!trimmed) {
      return;
    }

    items.push({ ...describeKnowledgeSection(trimmed, i + 1), content: trimmed });
  });

  return items;
}

function formatItemLine(item: AgentContextStoredItem): string {
  const label = item.sha ? `${item.kind} ${item.sha.slice(0, 8)}` : item.kind;

  return `  - item:${item.index} [${label}] "${item.title}" (${item.content.length} chars)`;
}

/**
 * Hint lines replacing inlined ticket / knowledge bodies. The agent reads content through the
 * platform MCP server; only titles and sizes are part of the prompt.
 */
export function buildAgentContextHintLines(record: AgentContextTicketRecord): string[] {
  const tool = (name: string) => `${AGENSTRA_CONTEXT_MCP_SERVER_KEY}_context_${name}`;
  const lines: string[] = [];

  if (record.items.length > 0) {
    lines.push(
      `- Context items for this request (read them with ${tool('get')} before relying on them; ${tool('list')} repeats this list):`,
      ...record.items.map(formatItemLine),
    );
  }

  const access =
    record.accessMode === 'deny'
      ? 'Only the items listed above are available in this session.'
      : `Other tickets / knowledge pages: find metadata with ${tool('search')}; ask for their content with ${tool('request_access')}.`;

  lines.push(`- ${access}`);

  return [
    `Context ticket: ${record.ticket} (pass it as \`ticket\` to every ${AGENSTRA_CONTEXT_MCP_SERVER_KEY}_context_* tool).`,
    ...lines,
  ];
}
