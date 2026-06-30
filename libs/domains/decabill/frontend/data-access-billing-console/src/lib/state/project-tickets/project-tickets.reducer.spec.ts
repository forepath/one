import type { ProjectTicketActivityResponse, ProjectTicketCommentResponse } from '../../types/projects.types';

import {
  addProjectTicketComment,
  addProjectTicketCommentFailure,
  addProjectTicketCommentSuccess,
  closeProjectTicketDetail,
  clearProjectTicketsError,
  createProjectTicket,
  createProjectTicketFailure,
  createProjectTicketSuccess,
  deleteProjectTicket,
  deleteProjectTicketFailure,
  deleteProjectTicketSuccess,
  loadProjectTicketDetailBundleSuccess,
  loadProjectTicketDetailFailure,
  loadProjectTickets,
  loadProjectTicketsFailure,
  loadProjectTicketsSuccess,
  openProjectTicketDetail,
  projectBoardActivityCreated,
  projectBoardCommentCreated,
  projectBoardTicketRemoved,
  projectBoardTicketUpsert,
  updateProjectTicket,
  updateProjectTicketFailure,
  updateProjectTicketSuccess,
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
  const childTicket = {
    ...ticket,
    id: 't-2',
    parentId: 't-1',
    title: 'Child',
  };
  const comment: ProjectTicketCommentResponse = {
    id: 'c-1',
    ticketId: 't-1',
    authorUserId: 'u-1',
    body: 'Hello',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };
  const activity: ProjectTicketActivityResponse = {
    id: 'a-1',
    ticketId: 't-1',
    actorUserId: 'u-1',
    actionType: 'updated',
    payload: {},
    createdAt: '2024-01-01',
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

  it('stores load failure', () => {
    const state = projectTicketsReducer(
      { ...initialProjectTicketsState, loadingList: true },
      loadProjectTicketsFailure({ error: 'failed' }),
    );

    expect(state.loadingList).toBe(false);
    expect(state.error).toBe('failed');
  });

  it('opens detail', () => {
    const state = projectTicketsReducer(initialProjectTicketsState, openProjectTicketDetail({ id: 't-1' }));

    expect(state.selectedTicketId).toBe('t-1');
    expect(state.loadingDetail).toBe(true);
  });

  it('stores detail bundle', () => {
    const state = projectTicketsReducer(
      { ...initialProjectTicketsState, list: [ticket], loadingDetail: true, selectedTicketId: 't-1' },
      loadProjectTicketDetailBundleSuccess({ ticket, comments: [comment], activity: [activity] }),
    );

    expect(state.detail).toEqual(expect.objectContaining({ id: 't-1' }));
    expect(state.comments).toEqual([comment]);
    expect(state.activity).toEqual([activity]);
    expect(state.loadingDetail).toBe(false);
  });

  it('clears detail on failure', () => {
    const state = projectTicketsReducer(
      { ...initialProjectTicketsState, loadingDetail: true, selectedTicketId: 't-1' },
      loadProjectTicketDetailFailure({ error: 'missing' }),
    );

    expect(state.loadingDetail).toBe(false);
    expect(state.selectedTicketId).toBeNull();
    expect(state.error).toBe('missing');
  });

  it('closes detail', () => {
    const state = projectTicketsReducer(
      {
        ...initialProjectTicketsState,
        selectedTicketId: 't-1',
        detail: ticket,
        comments: [comment],
        activity: [activity],
      },
      closeProjectTicketDetail(),
    );

    expect(state.selectedTicketId).toBeNull();
    expect(state.detail).toBeNull();
    expect(state.comments).toEqual([]);
    expect(state.activity).toEqual([]);
  });

  it('creates ticket and merges child into open detail', () => {
    const state = projectTicketsReducer(
      {
        ...initialProjectTicketsState,
        list: [ticket],
        detail: ticket,
        saving: true,
      },
      createProjectTicketSuccess({ ticket: childTicket }),
    );

    expect(state.saving).toBe(false);
    expect(state.list).toHaveLength(2);
    expect(state.detail?.children).toEqual([expect.objectContaining({ id: 't-2', title: 'Child' })]);
  });

  it('handles create failure', () => {
    const state = projectTicketsReducer(
      { ...initialProjectTicketsState, saving: true },
      createProjectTicketFailure({ error: 'create failed' }),
    );

    expect(state.saving).toBe(false);
    expect(state.error).toBe('create failed');
  });

  it('updates selected ticket and activity', () => {
    const updated = { ...ticket, title: 'Updated' };
    const state = projectTicketsReducer(
      {
        ...initialProjectTicketsState,
        list: [ticket],
        detail: ticket,
        selectedTicketId: 't-1',
        saving: true,
      },
      updateProjectTicketSuccess({ ticket: updated, activity: [activity] }),
    );

    expect(state.list[0].title).toBe('Updated');
    expect(state.detail?.title).toBe('Updated');
    expect(state.activity).toEqual([activity]);
  });

  it('handles update failure', () => {
    const state = projectTicketsReducer(
      { ...initialProjectTicketsState, saving: true },
      updateProjectTicketFailure({ error: 'update failed' }),
    );

    expect(state.saving).toBe(false);
    expect(state.error).toBe('update failed');
  });

  it('deletes ticket and clears selection', () => {
    const state = projectTicketsReducer(
      {
        ...initialProjectTicketsState,
        list: [ticket],
        detail: ticket,
        selectedTicketId: 't-1',
        saving: true,
      },
      deleteProjectTicketSuccess({ id: 't-1' }),
    );

    expect(state.list).toEqual([]);
    expect(state.detail).toBeNull();
    expect(state.selectedTicketId).toBeNull();
  });

  it('handles delete failure', () => {
    const state = projectTicketsReducer(
      { ...initialProjectTicketsState, saving: true },
      deleteProjectTicketFailure({ error: 'delete failed' }),
    );

    expect(state.error).toBe('delete failed');
  });

  it('adds comment to selected ticket', () => {
    const state = projectTicketsReducer(
      {
        ...initialProjectTicketsState,
        selectedTicketId: 't-1',
        comments: [],
        saving: true,
      },
      addProjectTicketCommentSuccess({ comment, activity: [activity] }),
    );

    expect(state.comments).toEqual([comment]);
    expect(state.activity).toEqual([activity]);
    expect(state.saving).toBe(false);
  });

  it('deduplicates comment on success', () => {
    const state = projectTicketsReducer(
      {
        ...initialProjectTicketsState,
        selectedTicketId: 't-1',
        comments: [comment],
      },
      addProjectTicketCommentSuccess({ comment: { ...comment, body: 'Edited' }, activity: [activity] }),
    );

    expect(state.comments).toEqual([{ ...comment, body: 'Edited' }]);
  });

  it('handles comment failure', () => {
    const state = projectTicketsReducer(
      { ...initialProjectTicketsState, saving: true },
      addProjectTicketCommentFailure({ error: 'comment failed' }),
    );

    expect(state.error).toBe('comment failed');
  });

  it('sets saving on mutations', () => {
    expect(projectTicketsReducer(initialProjectTicketsState, createProjectTicket({ dto: {} as never })).saving).toBe(
      true,
    );
    expect(projectTicketsReducer(initialProjectTicketsState, updateProjectTicket({ id: 't-1', dto: {} })).saving).toBe(
      true,
    );
    expect(projectTicketsReducer(initialProjectTicketsState, deleteProjectTicket({ id: 't-1' })).saving).toBe(true);
    expect(
      projectTicketsReducer(initialProjectTicketsState, addProjectTicketComment({ id: 't-1', dto: { body: 'x' } }))
        .saving,
    ).toBe(true);
  });

  it('clears error', () => {
    const state = projectTicketsReducer({ ...initialProjectTicketsState, error: 'x' }, clearProjectTicketsError());

    expect(state.error).toBeNull();
  });

  it('merges socket upsert', () => {
    const state = projectTicketsReducer(
      { ...initialProjectTicketsState, list: [ticket] },
      projectBoardTicketUpsert({ ticket: { ...ticket, title: 'Updated' } }),
    );

    expect(state.list[0].title).toBe('Updated');
  });

  it('removes ticket on socket removed', () => {
    const state = projectTicketsReducer(
      { ...initialProjectTicketsState, list: [ticket], detail: ticket, selectedTicketId: 't-1' },
      projectBoardTicketRemoved({ id: 't-1', projectId: 'p-1' }),
    );

    expect(state.list).toEqual([]);
    expect(state.detail).toBeNull();
    expect(state.selectedTicketId).toBeNull();
  });

  it('appends socket comment for selected ticket', () => {
    const state = projectTicketsReducer(
      { ...initialProjectTicketsState, selectedTicketId: 't-1', comments: [] },
      projectBoardCommentCreated({ comment }),
    );

    expect(state.comments).toEqual([comment]);
  });

  it('ignores socket comment for other ticket', () => {
    const state = projectTicketsReducer(
      { ...initialProjectTicketsState, selectedTicketId: 'other', comments: [] },
      projectBoardCommentCreated({ comment }),
    );

    expect(state).toEqual({ ...initialProjectTicketsState, selectedTicketId: 'other', comments: [] });
  });

  it('prepends socket activity for selected ticket', () => {
    const state = projectTicketsReducer(
      { ...initialProjectTicketsState, selectedTicketId: 't-1', activity: [] },
      projectBoardActivityCreated({ activity }),
    );

    expect(state.activity).toEqual([activity]);
  });
});
