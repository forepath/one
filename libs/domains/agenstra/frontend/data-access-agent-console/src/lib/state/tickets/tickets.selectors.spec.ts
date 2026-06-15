import { initialTicketsState, type TicketsState } from './tickets.reducer';
import {
  selectDetailBreadcrumb,
  selectRootTicketsByStatus,
  selectTicketById,
  selectTicketsBoardRowsByStatus,
  selectTicketsActivity,
  selectTicketsComments,
  selectTicketsDetail,
  selectTicketsError,
  selectTicketsList,
  selectTicketsLoadingDetail,
  selectTicketsLoadingList,
  selectTicketsSaving,
  selectTicketsSelectedId,
  selectTicketsState,
} from './tickets.selectors';
import {
  EMPTY_TICKET_TASKS,
  type TicketActivityResponseDto,
  type TicketCommentResponseDto,
  type TicketResponseDto,
} from './tickets.types';

describe('tickets selectors', () => {
  const baseTicket = (overrides: Partial<TicketResponseDto> = {}): TicketResponseDto => ({
    id: 'ticket-1',
    clientId: 'client-1',
    title: 'Example',
    content: null,
    priority: 'medium',
    status: 'draft',
    automationEligible: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    tasks: EMPTY_TICKET_TASKS,
    ...overrides,
  });
  const mockComment: TicketCommentResponseDto = {
    id: 'comment-1',
    ticketId: 'ticket-1',
    body: 'Hi',
    createdAt: '2024-01-02T00:00:00Z',
  };
  const mockActivity: TicketActivityResponseDto = {
    id: 'act-1',
    ticketId: 'ticket-1',
    occurredAt: '2024-01-02T00:00:00Z',
    actorType: 'human',
    actionType: 'updated',
    payload: {},
  };
  const createState = (overrides?: Partial<TicketsState>): TicketsState => ({
    ...initialTicketsState,
    ...overrides,
  });
  const root = (tickets: TicketsState) => ({ tickets }) as { tickets: TicketsState };

  describe('selectTicketsState', () => {
    it('should select the tickets feature state', () => {
      const state = createState({ error: 'e' });

      expect(selectTicketsState(root(state))).toEqual(state);
    });
  });

  describe('selectTicketsList', () => {
    it('should select list', () => {
      const list = [baseTicket()];
      const state = createState({ list });

      expect(selectTicketsList(root(state))).toEqual(list);
    });
  });

  describe('selectTicketsLoadingList', () => {
    it('should select loadingList', () => {
      expect(selectTicketsLoadingList(root(createState({ loadingList: true })))).toBe(true);
    });
  });

  describe('selectTicketsSelectedId', () => {
    it('should select selectedTicketId', () => {
      expect(selectTicketsSelectedId(root(createState({ selectedTicketId: 't1' })))).toBe('t1');
    });
  });

  describe('selectTicketsDetail', () => {
    it('should select detail', () => {
      const detail = baseTicket({ id: 'd1' });

      expect(selectTicketsDetail(root(createState({ detail })))).toEqual(detail);
    });
  });

  describe('selectTicketsComments', () => {
    it('should select comments', () => {
      expect(selectTicketsComments(root(createState({ comments: [mockComment] })))).toEqual([mockComment]);
    });
  });

  describe('selectTicketsActivity', () => {
    it('should select activity', () => {
      expect(selectTicketsActivity(root(createState({ activity: [mockActivity] })))).toEqual([mockActivity]);
    });
  });

  describe('selectTicketsLoadingDetail', () => {
    it('should select loadingDetail', () => {
      expect(selectTicketsLoadingDetail(root(createState({ loadingDetail: true })))).toBe(true);
    });
  });

  describe('selectTicketsSaving', () => {
    it('should select saving', () => {
      expect(selectTicketsSaving(root(createState({ saving: true })))).toBe(true);
    });
  });

  describe('selectTicketsError', () => {
    it('should select error', () => {
      expect(selectTicketsError(root(createState({ error: 'bad' })))).toBe('bad');
    });
  });

  describe('selectTicketsBoardRowsByStatus', () => {
    it('should nest only direct subtasks under root in the root lane regardless of child status', () => {
      const rootTicket = baseTicket({ id: 'root', status: 'todo', parentId: null });
      const child = baseTicket({ id: 'child', title: 'Sub', status: 'done', parentId: 'root' });
      const list = [rootTicket, child];
      const rows = selectTicketsBoardRowsByStatus(root(createState({ list })));

      expect(rows.todo.map((r) => ({ id: r.ticket.id, depth: r.depth }))).toEqual([
        { id: 'root', depth: 0 },
        { id: 'child', depth: 1 },
      ]);
    });

    it('should not show grandchildren in swimlanes', () => {
      const rootTicket = baseTicket({ id: 'root', status: 'draft', parentId: null });
      const child = baseTicket({ id: 'child', parentId: 'root' });
      const grandchild = baseTicket({ id: 'grand', title: 'Deep', parentId: 'child' });
      const list = [rootTicket, child, grandchild];
      const rows = selectTicketsBoardRowsByStatus(root(createState({ list })));

      expect(rows.draft.map((r) => r.ticket.id)).toEqual(['root', 'child']);
    });

    it('should order siblings by updatedAt descending', () => {
      const a = baseTicket({
        id: 'a',
        status: 'draft',
        parentId: null,
        updatedAt: '2024-01-01T00:00:00Z',
      });
      const b = baseTicket({
        id: 'b',
        status: 'draft',
        parentId: null,
        updatedAt: '2024-06-01T00:00:00Z',
      });
      const rows = selectTicketsBoardRowsByStatus(root(createState({ list: [a, b] })));

      expect(rows.draft.map((r) => r.ticket.id)).toEqual(['b', 'a']);
    });

    it('should omit done and closed roots and their direct subtasks from swimlanes', () => {
      const doneRoot = baseTicket({ id: 'done-root', status: 'done', parentId: null });
      const closedRoot = baseTicket({ id: 'closed-root', status: 'closed', parentId: null });
      const childOfDone = baseTicket({ id: 'c1', parentId: 'done-root', title: 'Under done' });
      const activeRoot = baseTicket({ id: 'active', status: 'todo', parentId: null });
      const list = [doneRoot, closedRoot, childOfDone, activeRoot];
      const rows = selectTicketsBoardRowsByStatus(root(createState({ list })));

      expect(rows.todo.map((r) => r.ticket.id)).toEqual(['active']);
      expect(rows.draft).toEqual([]);
      expect(rows.in_progress).toEqual([]);
      expect(rows.prototype).toEqual([]);
    });
  });

  describe('selectDetailBreadcrumb', () => {
    it('should build root-to-detail chain from flat list', () => {
      const rootTicket = baseTicket({ id: 'r', title: 'Root', parentId: null });
      const mid = baseTicket({ id: 'm', title: 'Mid', parentId: 'r' });
      const leaf = baseTicket({ id: 'l', title: 'Leaf', parentId: 'm' });
      const list = [rootTicket, mid, leaf];
      const chain = selectDetailBreadcrumb(root(createState({ list, detail: leaf })));

      expect(chain.map((t) => t.id)).toEqual(['r', 'm', 'l']);
    });

    it('should return only detail when list has no parents', () => {
      const leaf = baseTicket({ id: 'l', parentId: 'missing' });
      const chain = selectDetailBreadcrumb(root(createState({ list: [leaf], detail: leaf })));

      expect(chain).toEqual([leaf]);
    });
  });

  describe('selectRootTicketsByStatus', () => {
    it('should group root tickets by status and exclude children', () => {
      const list = [
        baseTicket({ id: 'a', status: 'draft', parentId: null }),
        baseTicket({ id: 'b', status: 'draft', parentId: undefined }),
        baseTicket({ id: 'c', status: 'todo' }),
        baseTicket({ id: 'child', status: 'done', parentId: 'c' }),
      ];
      const grouped = selectRootTicketsByStatus(root(createState({ list })));

      expect(grouped.draft.map((t) => t.id)).toEqual(['a', 'b']);
      expect(grouped.todo.map((t) => t.id)).toEqual(['c']);
      expect(grouped.in_progress).toEqual([]);
      expect(grouped.prototype).toEqual([]);
    });

    it('should exclude done and closed roots from swimlane buckets', () => {
      const list = [
        baseTicket({ id: 'd1', status: 'done', parentId: null }),
        baseTicket({ id: 'c1', status: 'closed', parentId: null }),
        baseTicket({ id: 't1', status: 'todo', parentId: null }),
      ];
      const grouped = selectRootTicketsByStatus(root(createState({ list })));

      expect(grouped.todo.map((t) => t.id)).toEqual(['t1']);
      expect(grouped.draft).toEqual([]);
      expect(grouped.in_progress).toEqual([]);
      expect(grouped.prototype).toEqual([]);
    });

    it('should return empty arrays per lane when list is empty', () => {
      const grouped = selectRootTicketsByStatus(root(createState({ list: [] })));

      expect(grouped).toEqual({
        draft: [],
        todo: [],
        in_progress: [],
        prototype: [],
      });
    });
  });

  describe('selectTicketById', () => {
    it('should return ticket when id matches', () => {
      const t = baseTicket({ id: 'x' });
      const sel = selectTicketById('x');

      expect(sel(root(createState({ list: [t] })))).toEqual(t);
    });

    it('should return null when id not found', () => {
      const sel = selectTicketById('missing');

      expect(sel(root(createState({ list: [baseTicket()] })))).toBeNull();
    });
  });
});
