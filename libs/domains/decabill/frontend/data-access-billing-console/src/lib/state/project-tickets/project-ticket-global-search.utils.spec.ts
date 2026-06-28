import { filterTicketsForGlobalSearch } from './project-ticket-global-search.utils';

describe('project-ticket-global-search.utils', () => {
  const ticket = {
    id: 't-1',
    projectId: 'p-1',
    title: 'Fix billing',
    content: 'details',
    status: 'todo' as const,
    priority: 'medium' as const,
    shas: { short: 'abc', long: 'abc123' },
    tasks: { open: 0, done: 0, children: { open: 0, done: 0 } },
    locked: false,
    createdAt: '',
    updatedAt: '',
  };

  it('returns empty for blank query', () => {
    expect(filterTicketsForGlobalSearch([ticket], '  ')).toEqual([]);
  });

  it('matches title', () => {
    const hits = filterTicketsForGlobalSearch([ticket], 'billing');

    expect(hits).toHaveLength(1);
    expect(hits[0].pathTitles).toEqual(['Fix billing']);
  });

  it('scopes hits to the current project', () => {
    const otherProject = { ...ticket, id: 't-2', projectId: 'p-2', title: 'Other billing' };
    const hits = filterTicketsForGlobalSearch([ticket, otherProject], 'billing', 'p-1');

    expect(hits).toHaveLength(1);
    expect(hits[0].ticket.id).toBe('t-1');
  });
});
