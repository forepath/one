import type { AgentContextTicketRecord } from '../types/agent-context.types';

import {
  buildAgentContextHintLines,
  deriveAgentContextItems,
  describeKnowledgeSection,
  titleFromTicketPrompt,
} from './agent-context-items.utils';

const TICKET_PROMPT = [
  'You are helping implement a scoped piece of work.',
  '',
  '- [5c1b0d6e-0000-4000-8000-000000000001] Fix login redirect (todo, high)',
  '  Content:',
  '  Users land on a blank page.',
].join('\n');

function record(overrides: Partial<AgentContextTicketRecord> = {}): AgentContextTicketRecord {
  return {
    ticket: 'ctx-abc',
    agentId: 'agent-1',
    sessionKey: 'chat-1',
    ephemeral: false,
    correlationId: 'corr',
    accessMode: 'ask',
    items: [],
    grants: { ticket: [], knowledge: [] },
    attachments: [],
    environments: [],
    createdAt: 0,
    lastUsedAt: 0,
    ...overrides,
  };
}

describe('agent-context-items.utils', () => {
  it('extracts the first ticket title from a prototype prompt', () => {
    expect(titleFromTicketPrompt(TICKET_PROMPT)).toBe('Fix login redirect');
    expect(titleFromTicketPrompt('no ticket lines')).toBeUndefined();
  });

  it('classifies knowledge pages, vector excerpts, related tickets and free sections', () => {
    expect(describeKnowledgeSection('Knowledge Page: Auth design\nBody', 1)).toEqual({
      kind: 'knowledge',
      title: 'Auth design',
    });
    expect(describeKnowledgeSection('Knowledge Page Context:\nTokens rotate daily', 2)).toEqual({
      kind: 'knowledge',
      title: 'Knowledge excerpt: Tokens rotate daily',
    });
    expect(describeKnowledgeSection(TICKET_PROMPT, 3)).toEqual({ kind: 'ticket', title: 'Fix login redirect' });
    expect(describeKnowledgeSection('Something else', 4)).toEqual({ kind: 'context', title: 'Something else' });
  });

  it('derives items verbatim, preferring controller-provided ticket refs', () => {
    const items = deriveAgentContextItems({
      ticketContexts: [TICKET_PROMPT, '  '],
      ticketContextRefs: [{ sha: 'ABCDEF1234', title: 'Selected ticket' }],
      knowledgeContexts: ['Knowledge Page: Auth design\nBody'],
    });

    expect(items).toEqual([
      { kind: 'ticket', title: 'Selected ticket', sha: 'abcdef1234', content: TICKET_PROMPT },
      { kind: 'knowledge', title: 'Auth design', content: 'Knowledge Page: Auth design\nBody' },
    ]);
    expect(deriveAgentContextItems(undefined)).toEqual([]);
  });

  it('falls back to the parsed ticket title without refs', () => {
    expect(deriveAgentContextItems({ ticketContexts: [TICKET_PROMPT] })[0]).toMatchObject({
      kind: 'ticket',
      title: 'Fix login redirect',
    });
  });

  it('builds hint lines with the ticket, item refs and sizes but no content', () => {
    const lines = buildAgentContextHintLines(
      record({
        items: [{ index: 1, kind: 'ticket', title: 'Fix login', sha: 'abcdef1234', content: 'x'.repeat(42) }],
      }),
    );
    const text = lines.join('\n');

    expect(text).toContain('Context ticket: ctx-abc');
    expect(text).toContain('item:1 [ticket abcdef12] "Fix login" (42 chars)');
    expect(text).toContain('agenstra_context_get');
    expect(text).toContain('agenstra_context_request_access');
    expect(text).not.toContain('x'.repeat(42));
  });

  it('tells deny-mode sessions that only listed items are available', () => {
    const text = buildAgentContextHintLines(record({ accessMode: 'deny' })).join('\n');

    expect(text).toContain('Only the items listed above are available');
    expect(text).not.toContain('request_access');
  });
});
