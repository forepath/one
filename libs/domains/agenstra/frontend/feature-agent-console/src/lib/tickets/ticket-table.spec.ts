import type { TicketResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';

import {
  buildTicketTableRows,
  bulkDeleteTickets,
  bulkUpdateTickets,
  ticketStatusState,
  type TicketTableQuery,
} from './ticket-table';

function ticket(id: string, patch: Partial<TicketResponseDto> = {}): TicketResponseDto {
  return {
    id,
    shas: { short: `s-${id}`, long: `long-${id}` },
    clientId: 'c1',
    parentId: null,
    title: `Ticket ${id}`,
    priority: 'medium',
    status: 'todo',
    automationEligible: false,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    tasks: { open: 0, done: 0, children: { open: 0, done: 0 } },
    ...patch,
  };
}

const query = (patch: Partial<TicketTableQuery> = {}): TicketTableQuery => ({
  status: 'open',
  priority: '',
  search: '',
  sort: null,
  ...patch,
});

describe('ticket table', () => {
  const list = [
    ticket('a', { status: 'todo', updatedAt: '2026-10-02T00:00:00Z' }),
    ticket('b', { status: 'draft' }),
    ticket('c', { status: 'done' }),
    ticket('a1', { parentId: 'a', status: 'done', priority: 'critical' }),
    ticket('a1x', { parentId: 'a1' }),
  ];
  const ids = (rows: { ticket: TicketResponseDto; depth: number }[]) => rows.map((r) => `${r.ticket.id}:${r.depth}`);

  it('lists open roots in workflow order with their direct subtasks (like the former lanes)', () => {
    expect(ids(buildTicketTableRows(list, query()))).toEqual(['b:0', 'a:0', 'a1:1']);
  });

  it('filters by status, priority and search', () => {
    expect(ids(buildTicketTableRows(list, query({ status: 'all' })))).toEqual(['b:0', 'a:0', 'a1:1', 'c:0']);
    expect(ids(buildTicketTableRows(list, query({ status: 'done' })))).toEqual(['c:0']);
    expect(ids(buildTicketTableRows(list, query({ priority: 'critical' })))).toEqual(['a1:1']);
    expect(ids(buildTicketTableRows(list, query({ search: 's-b' })))).toEqual(['b:0']);
  });

  it('flattens and orders all rows by a column sort', () => {
    const rows = buildTicketTableRows(list, query({ sort: { column: 'priority', direction: 'asc' } }));

    expect(ids(rows)).toEqual(['a1:0', 'b:0', 'a:0']);
  });

  it('has a readable state per status', () => {
    expect(ticketStatusState('in_progress')).toEqual(expect.objectContaining({ label: 'In progress', tone: 'info' }));
  });

  it('bulk status: one update per ticket, per-item results incl. a denied one', async () => {
    const applied: string[] = [];
    const update = jest.fn(async (id: string) => {
      if (id === 'b') throw { status: 403, error: { message: 'Forbidden' } };
      if (id === 'c') throw { status: 500, error: { message: 'Boom' } };

      return ticket(id, { status: 'prototype' });
    });
    const result = await bulkUpdateTickets(
      [ticket('a'), ticket('b'), ticket('c'), ticket('d', { status: 'prototype' })],
      { status: 'prototype' },
      update,
      (t) => applied.push(t.id),
    );

    expect(update).toHaveBeenCalledTimes(3);
    expect(result.succeeded.map((t) => t.id)).toEqual(['a']);
    expect(result.denied.map((t) => t.id)).toEqual(['b']);
    expect(result.failed.map((t) => t.id)).toEqual(['c']);
    expect(applied).toEqual(['a']);
  });

  it('bulk delete: subtasks first, one at a time, denied ones stay', async () => {
    const calls: string[] = [];
    const removed: string[] = [];
    const result = await bulkDeleteTickets(
      [ticket('p'), ticket('k', { parentId: 'p' }), ticket('x')],
      async (id) => {
        calls.push(id);
        if (id === 'x') throw { status: 401 };
      },
      (t) => removed.push(t.id),
    );

    expect(calls).toEqual(['k', 'p', 'x']);
    expect(removed).toEqual(['k', 'p']);
    expect(result.denied.map((t) => t.id)).toEqual(['x']);
  });
});
