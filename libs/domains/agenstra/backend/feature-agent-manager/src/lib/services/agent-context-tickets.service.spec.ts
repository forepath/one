import { NotFoundException } from '@nestjs/common';

import { AGENT_CONTEXT_TICKET_IDLE_TTL_MS } from '../constants/agent-context.constants';

import { AgentContextTicketsService, type MintAgentContextTicketInput } from './agent-context-tickets.service';

describe('AgentContextTicketsService', () => {
  let service: AgentContextTicketsService;

  const binding = (overrides: Partial<MintAgentContextTicketInput> = {}): MintAgentContextTicketInput => ({
    agentId: 'agent-1',
    sessionKey: 'chat-1',
    ephemeral: false,
    correlationId: 'corr-1',
    accessMode: 'ask',
    items: [],
    ...overrides,
  });

  beforeEach(() => {
    service = new AgentContextTicketsService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('mints opaque tickets with indexed items and implicit grants for sha-bearing items', () => {
    const record = service.mint(
      binding({
        items: [
          { kind: 'ticket', title: 'Fix login', sha: 'ABCDEF1234', content: 'ticket body' },
          { kind: 'knowledge', title: 'Auth', content: 'page body' },
        ],
        grants: { knowledge: ['9999aaaa'] },
      }),
    );

    expect(record.ticket).toMatch(/^ctx-[A-Za-z0-9_-]{20,}$/);
    expect(record.items.map((item) => item.index)).toEqual([1, 2]);
    expect(record.grants).toEqual({ ticket: ['abcdef1234'], knowledge: ['9999aaaa'] });
  });

  it('resolves tickets only for the owning agent', () => {
    const record = service.mint(binding());

    expect(service.resolve('agent-1', record.ticket)).toBe(record);
    expect(() => service.resolve('agent-2', record.ticket)).toThrow(NotFoundException);
    expect(() => service.resolve('agent-1', 'ctx-unknown')).toThrow(NotFoundException);
  });

  it('matches grants by sha prefix in both directions', () => {
    const record = service.mint(binding({ grants: { ticket: ['abcdef1234567890'] } }));

    expect(service.isGranted(record, 'ticket', 'abcdef12')).toBe(true);
    expect(service.isGranted(record, 'ticket', 'abcdef1234567890ffff')).toBe(true);
    expect(service.isGranted(record, 'ticket', 'abcdee')).toBe(false);
    expect(service.isGranted(record, 'knowledge', 'abcdef12')).toBe(false);
  });

  it('keeps one-off grants on the ticket and session grants across tickets of the same chat', () => {
    const first = service.mint(binding());
    const second = service.mint(binding());
    const otherChat = service.mint(binding({ sessionKey: 'chat-2' }));

    service.grant(first, [{ kind: 'ticket', sha: 'aaaa1111' }], 'once');
    service.grant(first, [{ kind: 'knowledge', sha: 'bbbb2222' }], 'session');

    expect(service.isGranted(first, 'ticket', 'aaaa1111')).toBe(true);
    expect(service.isGranted(second, 'ticket', 'aaaa1111')).toBe(false);
    expect(service.isGranted(second, 'knowledge', 'bbbb2222')).toBe(true);
    expect(service.isGranted(otherChat, 'knowledge', 'bbbb2222')).toBe(false);
  });

  it('remembers fetched items once and finds them by index or sha', () => {
    const record = service.mint(binding({ items: [{ kind: 'knowledge', title: 'A', content: 'a' }] }));
    const stored = service.rememberItem(record, { kind: 'ticket', title: 'T', sha: 'cccc3333', content: 't' });
    const again = service.rememberItem(record, { kind: 'ticket', title: 'T', sha: 'cccc3333', content: 'other' });

    expect(stored.index).toBe(2);
    expect(again).toBe(stored);
    expect(service.findItemByIndex(record, 2)).toBe(stored);
    expect(service.findItemBySha(record, 'ticket', 'cccc')).toBe(stored);
  });

  it('expires idle tickets', () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const record = service.mint(binding());

    jest.setSystemTime(1_000_000 + AGENT_CONTEXT_TICKET_IDLE_TTL_MS + 1);

    expect(() => service.resolve('agent-1', record.ticket)).toThrow(NotFoundException);
  });

  it('revokes every ticket and session grant of an agent', () => {
    const record = service.mint(binding());
    const other = service.mint(binding({ agentId: 'agent-2' }));

    service.grant(record, [{ kind: 'ticket', sha: 'dddd4444' }], 'session');
    service.revokeAgent('agent-1');

    expect(() => service.resolve('agent-1', record.ticket)).toThrow(NotFoundException);
    expect(service.resolve('agent-2', other.ticket)).toBe(other);
    expect(service.isGranted(service.mint(binding()), 'ticket', 'dddd4444')).toBe(false);
  });
});
