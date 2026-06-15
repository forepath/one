import {
  buildTicketBreadcrumbTitles,
  filterTicketsForGlobalSearch,
  filterTicketsForTicketContextSuggestions,
  findPermittedTicketByExactSha,
  matchesTicketContextSuggestionQuery,
  matchesTicketSearchQuery,
} from './ticket-global-search.utils';
import { EMPTY_TICKET_TASKS, type TicketResponseDto } from './tickets.types';

describe('ticket-global-search.utils', () => {
  const t = (overrides: Partial<TicketResponseDto>): TicketResponseDto => ({
    id: 'id-1',
    clientId: 'c1',
    shas: { short: 'a1b2c3d', long: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b' },
    title: 'Alpha',
    content: null,
    priority: 'medium',
    status: 'draft',
    automationEligible: false,
    createdAt: '',
    updatedAt: '',
    tasks: EMPTY_TICKET_TASKS,
    ...overrides,
  });

  describe('matchesTicketSearchQuery', () => {
    it('returns false for empty needle', () => {
      expect(matchesTicketSearchQuery(t({}), '')).toBe(false);
    });

    it('matches title case-insensitively', () => {
      expect(matchesTicketSearchQuery(t({ title: 'Hello World' }), 'hello')).toBe(true);
    });

    it('matches content', () => {
      expect(matchesTicketSearchQuery(t({ content: 'acceptance: foo' }), 'foo')).toBe(true);
    });

    it('matches id substring', () => {
      expect(matchesTicketSearchQuery(t({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }), 'bbbb')).toBe(true);
    });
  });

  describe('buildTicketBreadcrumbTitles', () => {
    it('returns single title for root', () => {
      const root = t({ id: 'r', title: 'Root', parentId: null });

      expect(buildTicketBreadcrumbTitles([root], 'r')).toEqual(['Root']);
    });

    it('builds chain for nested ticket', () => {
      const root = t({ id: 'r', title: 'Root', parentId: null });
      const child = t({ id: 'c', title: 'Child', parentId: 'r' });

      expect(buildTicketBreadcrumbTitles([root, child], 'c')).toEqual(['Root', 'Child']);
    });
  });

  describe('filterTicketsForGlobalSearch', () => {
    it('returns empty when query is blank', () => {
      expect(filterTicketsForGlobalSearch([t({})], '   ', 'c1')).toEqual([]);
    });

    it('includes done and closed tickets', () => {
      const list = [
        t({ id: 'a', title: 'Open', status: 'todo' }),
        t({ id: 'b', title: 'Shipped', status: 'done' }),
        t({ id: 'c', title: 'Wontfix', status: 'closed' }),
      ];
      const ship = filterTicketsForGlobalSearch(list, 'ship', 'c1');

      expect(ship.map((h) => h.ticket.id)).toContain('b');
      const wont = filterTicketsForGlobalSearch(list, 'wont', 'c1');

      expect(wont.map((h) => h.ticket.id)).toContain('c');
    });

    it('filters by clientId when provided', () => {
      const list = [t({ id: 'x', clientId: 'c1', title: 'Same' }), t({ id: 'y', clientId: 'c2', title: 'Same' })];

      expect(filterTicketsForGlobalSearch(list, 'same', 'c1').map((h) => h.ticket.id)).toEqual(['x']);
    });

    it('returns pathTitles for subtask hits', () => {
      const root = t({ id: 'r', title: 'Epic', parentId: null });
      const sub = t({ id: 's', title: 'Task', parentId: 'r' });
      const hits = filterTicketsForGlobalSearch([root, sub], 'task', 'c1');

      expect(hits).toHaveLength(1);
      expect(hits[0].pathTitles).toEqual(['Epic', 'Task']);
    });
  });

  describe('matchesTicketContextSuggestionQuery', () => {
    it('matches title substring', () => {
      expect(matchesTicketContextSuggestionQuery(t({ title: 'Fix login' }), 'login')).toBe(true);
    });

    it('matches short sha substring', () => {
      expect(matchesTicketContextSuggestionQuery(t({ shas: { short: 'deadbeef', long: 'ab' } }), 'dead')).toBe(true);
    });

    it('matches long sha substring', () => {
      expect(
        matchesTicketContextSuggestionQuery(
          t({ shas: { short: 'x', long: '0123456789abcdef0123456789abcdef01234567' } }),
          'abcdef01',
        ),
      ).toBe(true);
    });
  });

  describe('filterTicketsForTicketContextSuggestions', () => {
    it('returns empty for blank query', () => {
      expect(filterTicketsForTicketContextSuggestions([t({})], '  ')).toEqual([]);
    });

    it('respects limit', () => {
      const list = [
        t({ id: '1', title: 'A', shas: { short: 's1', long: 'l1'.repeat(20) } }),
        t({ id: '2', title: 'B', shas: { short: 's2', long: 'l2'.repeat(20) } }),
      ];
      const hits = filterTicketsForTicketContextSuggestions(list, 's', { limit: 1 });

      expect(hits).toHaveLength(1);
    });
  });

  describe('findPermittedTicketByExactSha', () => {
    it('finds by short sha case-insensitively', () => {
      const ticket = t({ shas: { short: 'AbCdEf01', long: 'longhashvalue01234567890123456789012' } });
      const found = findPermittedTicketByExactSha([ticket], 'abcdef01');

      expect(found).toBe(ticket);
    });

    it('finds by full long sha', () => {
      const long = 'a'.repeat(40);
      const ticket = t({ shas: { short: 's', long } });
      const found = findPermittedTicketByExactSha([ticket], long);

      expect(found).toBe(ticket);
    });

    it('returns undefined when sha is not in allowlist', () => {
      const ticket = t({ shas: { short: 'only', long: 'longonly0123456789012345678901234567890' } });
      const found = findPermittedTicketByExactSha([ticket], 'nope');

      expect(found).toBeUndefined();
    });
  });
});
