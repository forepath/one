import type { ProjectTicketResponse } from '../../types/projects.types';

import { initialProjectTicketsState } from './project-tickets.reducer';
import {
  selectProjectTicketDetailBreadcrumb,
  selectProjectTicketsActivity,
  selectProjectTicketsBoardRowsByStatus,
  selectProjectTicketsComments,
  selectProjectTicketsDetail,
  selectProjectTicketsError,
  selectProjectTicketsList,
  selectProjectTicketsLoadingDetail,
  selectProjectTicketsLoadingList,
  selectProjectTicketsProjectId,
  selectProjectTicketsSaving,
  selectProjectTicketsSelectedId,
  selectProjectTicketsState,
  selectRootProjectTicketsByStatus,
} from './project-tickets.selectors';

describe('projectTickets selectors', () => {
  const rootTicket: ProjectTicketResponse = {
    id: 't-1',
    projectId: 'p-1',
    title: 'Root',
    status: 'todo',
    priority: 'medium',
    shas: { short: 'abc', long: 'abc123' },
    tasks: { open: 0, done: 0, children: { open: 0, done: 0 } },
    locked: false,
    createdAt: '2024-01-02',
    updatedAt: '2024-01-02',
  };
  const childTicket: ProjectTicketResponse = {
    ...rootTicket,
    id: 't-2',
    parentId: 't-1',
    title: 'Child',
    status: 'in_progress',
    updatedAt: '2024-01-03',
  };
  const closedRoot: ProjectTicketResponse = {
    ...rootTicket,
    id: 't-3',
    status: 'closed',
  };
  const rootState = {
    projectTickets: {
      ...initialProjectTicketsState,
      projectId: 'p-1',
      list: [rootTicket, childTicket, closedRoot],
      selectedTicketId: 't-2',
      detail: childTicket,
      comments: [],
      activity: [],
      loadingList: false,
      loadingDetail: false,
      saving: false,
      error: null,
    },
  };

  it('selects feature state and scalar fields', () => {
    expect(selectProjectTicketsState(rootState as never)).toEqual(rootState.projectTickets);
    expect(selectProjectTicketsProjectId(rootState as never)).toBe('p-1');
    expect(selectProjectTicketsList(rootState as never)).toHaveLength(3);
    expect(selectProjectTicketsLoadingList(rootState as never)).toBe(false);
    expect(selectProjectTicketsSelectedId(rootState as never)).toBe('t-2');
    expect(selectProjectTicketsDetail(rootState as never)?.id).toBe('t-2');
    expect(selectProjectTicketsComments(rootState as never)).toEqual([]);
    expect(selectProjectTicketsActivity(rootState as never)).toEqual([]);
    expect(selectProjectTicketsLoadingDetail(rootState as never)).toBe(false);
    expect(selectProjectTicketsSaving(rootState as never)).toBe(false);
    expect(selectProjectTicketsError(rootState as never)).toBeNull();
  });

  it('selectProjectTicketsBoardRowsByStatus nests children under roots', () => {
    const board = selectProjectTicketsBoardRowsByStatus(rootState as never);

    expect(board.todo).toEqual([
      { ticket: rootTicket, depth: 0 },
      { ticket: childTicket, depth: 1 },
    ]);
    expect(board.in_progress).toEqual([]);
  });

  it('selectProjectTicketDetailBreadcrumb walks parent chain', () => {
    expect(selectProjectTicketDetailBreadcrumb(rootState as never)).toEqual([rootTicket, childTicket]);
    expect(
      selectProjectTicketDetailBreadcrumb({
        projectTickets: { ...initialProjectTicketsState, list: [], detail: null },
      } as never),
    ).toEqual([]);
  });

  it('selectRootProjectTicketsByStatus excludes closed roots', () => {
    const roots = selectRootProjectTicketsByStatus(rootState as never);

    expect(roots.todo).toEqual([rootTicket]);
    expect(roots.done).toEqual([]);
  });
});
