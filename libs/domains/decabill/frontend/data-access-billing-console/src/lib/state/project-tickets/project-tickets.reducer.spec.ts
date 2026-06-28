import {
  loadProjectTickets,
  loadProjectTicketsSuccess,
  openProjectTicketDetail,
  projectBoardTicketUpsert,
} from './project-tickets.actions';
import { initialProjectTicketsState, projectTicketsReducer } from './project-tickets.reducer';

describe('projectTicketsReducer', () => {
  const ticket = {
    id: 't-1',
    projectId: 'p-1',
    title: 'Task',
    status: 'todo' as const,
    priority: 'medium' as const,
    shas: { short: 'abc', long: 'abc123' },
    tasks: { open: 0, done: 0, children: { open: 0, done: 0 } },
    locked: false,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };

  it('sets loading on load', () => {
    const state = projectTicketsReducer(
      initialProjectTicketsState,
      loadProjectTickets({ params: { projectId: 'p-1' } }),
    );

    expect(state.loadingList).toBe(true);
    expect(state.projectId).toBe('p-1');
  });

  it('stores tickets with subtask counts', () => {
    const state = projectTicketsReducer(
      { ...initialProjectTicketsState, loadingList: true },
      loadProjectTicketsSuccess({ tickets: [ticket] }),
    );

    expect(state.list).toHaveLength(1);
    expect(state.list[0].subtaskCounts).toEqual({ open: 0, done: 0 });
    expect(state.loadingList).toBe(false);
  });

  it('opens detail', () => {
    const state = projectTicketsReducer(initialProjectTicketsState, openProjectTicketDetail({ id: 't-1' }));

    expect(state.selectedTicketId).toBe('t-1');
    expect(state.loadingDetail).toBe(true);
  });

  it('merges socket upsert', () => {
    const state = projectTicketsReducer(
      { ...initialProjectTicketsState, list: [ticket] },
      projectBoardTicketUpsert({ ticket: { ...ticket, title: 'Updated' } }),
    );

    expect(state.list[0].title).toBe('Updated');
  });
});
