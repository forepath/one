import {
  clearProjectTicketTimeEntries,
  createProjectTimeEntry,
  createProjectTimeEntryFailure,
  createProjectTimeEntrySuccess,
  deleteProjectTimeEntry,
  deleteProjectTimeEntryFailure,
  deleteProjectTimeEntrySuccess,
  loadProjectTicketTimeEntries,
  loadProjectTicketTimeEntriesBatch,
  loadProjectTicketTimeEntriesFailure,
  loadProjectTicketTimeEntriesSuccess,
  loadProjectTimeEntries,
  loadProjectTimeEntriesBatch,
  loadProjectTimeEntriesFailure,
  loadProjectTimeEntriesSuccess,
  projectBoardTimeEntryRemoved,
  projectBoardTimeEntryUpsert,
  updateProjectTimeEntry,
  updateProjectTimeEntryFailure,
  updateProjectTimeEntrySuccess,
} from './project-time-entries.actions';
import { initialProjectTimeEntriesState, projectTimeEntriesReducer } from './project-time-entries.reducer';

describe('projectTimeEntriesReducer', () => {
  const entry = {
    id: 'e-1',
    projectId: 'p-1',
    ticketId: 't-1',
    recordedByUserId: 'u-1',
    durationMinutes: 60,
    startedAt: '2024-01-01T09:00:00.000Z',
    endedAt: '2024-01-01T10:00:00.000Z',
    recordedAt: '2024-01-01T09:00:00.000Z',
    createdAt: '2024-01-01',
  };
  const otherEntry = { ...entry, id: 'e-2', ticketId: 't-2' };

  it('loads entries', () => {
    const state = projectTimeEntriesReducer(
      initialProjectTimeEntriesState,
      loadProjectTimeEntries({ projectId: 'p-1' }),
    );

    expect(state.loading).toBe(true);
    expect(state.entries).toEqual([]);
  });

  it('accumulates batch and stores success', () => {
    const batched = projectTimeEntriesReducer(
      initialProjectTimeEntriesState,
      loadProjectTimeEntriesBatch({ accumulatedEntries: [entry] }),
    );
    const done = projectTimeEntriesReducer(batched, loadProjectTimeEntriesSuccess({ entries: [entry, otherEntry] }));

    expect(batched.entries).toEqual([entry]);
    expect(done.entries).toEqual([entry, otherEntry]);
    expect(done.loading).toBe(false);
  });

  it('stores load failure', () => {
    const state = projectTimeEntriesReducer(
      { ...initialProjectTimeEntriesState, loading: true },
      loadProjectTimeEntriesFailure({ error: 'failed' }),
    );

    expect(state.loading).toBe(false);
    expect(state.error).toBe('failed');
  });

  it('loads ticket scope entries', () => {
    const state = projectTimeEntriesReducer(
      initialProjectTimeEntriesState,
      loadProjectTicketTimeEntries({ projectId: 'p-1', ticketId: 't-1' }),
    );

    expect(state.ticketScope.loading).toBe(true);
    expect(state.ticketScope.ticketId).toBe('t-1');
  });

  it('accumulates ticket scope batch and success', () => {
    const batched = projectTimeEntriesReducer(
      initialProjectTimeEntriesState,
      loadProjectTicketTimeEntriesBatch({ accumulatedEntries: [entry] }),
    );
    const done = projectTimeEntriesReducer(
      batched,
      loadProjectTicketTimeEntriesSuccess({ entries: [entry, otherEntry] }),
    );

    expect(batched.ticketScope.entries).toEqual([entry]);
    expect(done.ticketScope.entries).toEqual([entry, otherEntry]);
    expect(done.ticketScope.loading).toBe(false);
  });

  it('stores ticket scope failure', () => {
    const state = projectTimeEntriesReducer(
      {
        ...initialProjectTimeEntriesState,
        ticketScope: { ...initialProjectTimeEntriesState.ticketScope, loading: true },
      },
      loadProjectTicketTimeEntriesFailure({ error: 'scope failed' }),
    );

    expect(state.ticketScope.loading).toBe(false);
    expect(state.ticketScope.error).toBe('scope failed');
  });

  it('clears ticket scope', () => {
    const state = projectTimeEntriesReducer(
      {
        ...initialProjectTimeEntriesState,
        ticketScope: { projectId: 'p-1', ticketId: 't-1', entries: [entry], loading: false, error: null },
      },
      clearProjectTicketTimeEntries(),
    );

    expect(state.ticketScope.ticketId).toBeNull();
    expect(state.ticketScope.entries).toEqual([]);
  });

  it('prepends entry on create', () => {
    const state = projectTimeEntriesReducer(initialProjectTimeEntriesState, createProjectTimeEntrySuccess({ entry }));

    expect(state.entries[0]).toEqual(entry);
  });

  it('updates ticket scope on create when matching ticket', () => {
    const state = projectTimeEntriesReducer(
      {
        ...initialProjectTimeEntriesState,
        ticketScope: { projectId: 'p-1', ticketId: 't-1', entries: [], loading: false, error: null },
      },
      createProjectTimeEntrySuccess({ entry }),
    );

    expect(state.ticketScope.entries).toEqual([entry]);
  });

  it('updates entry on success', () => {
    const updated = { ...entry, durationMinutes: 90 };
    const state = projectTimeEntriesReducer(
      {
        ...initialProjectTimeEntriesState,
        entries: [entry],
        ticketScope: { projectId: 'p-1', ticketId: 't-1', entries: [entry], loading: false, error: null },
      },
      updateProjectTimeEntrySuccess({ entry: updated }),
    );

    expect(state.entries[0].durationMinutes).toBe(90);
    expect(state.ticketScope.entries[0].durationMinutes).toBe(90);
  });

  it('deletes entry from project and ticket scope', () => {
    const state = projectTimeEntriesReducer(
      {
        ...initialProjectTimeEntriesState,
        entries: [entry],
        ticketScope: { projectId: 'p-1', ticketId: 't-1', entries: [entry], loading: false, error: null },
      },
      deleteProjectTimeEntrySuccess({ id: 'e-1', projectId: 'p-1' }),
    );

    expect(state.entries).toEqual([]);
    expect(state.ticketScope.entries).toEqual([]);
  });

  it('handles mutation failures', () => {
    expect(
      projectTimeEntriesReducer(
        { ...initialProjectTimeEntriesState, saving: true },
        createProjectTimeEntryFailure({ error: 'create failed' }),
      ).error,
    ).toBe('create failed');
    expect(
      projectTimeEntriesReducer(
        { ...initialProjectTimeEntriesState, saving: true },
        updateProjectTimeEntryFailure({ error: 'update failed' }),
      ).error,
    ).toBe('update failed');
    expect(
      projectTimeEntriesReducer(
        { ...initialProjectTimeEntriesState, saving: true },
        deleteProjectTimeEntryFailure({ error: 'delete failed' }),
      ).error,
    ).toBe('delete failed');
  });

  it('sets saving on mutations and clears ticket scope error', () => {
    const state = projectTimeEntriesReducer(
      {
        ...initialProjectTimeEntriesState,
        ticketScope: { projectId: 'p-1', ticketId: 't-1', entries: [], loading: false, error: 'old' },
      },
      createProjectTimeEntry({ dto: {} as never }),
    );

    expect(state.saving).toBe(true);
    expect(state.ticketScope.error).toBeNull();
  });

  it('does not duplicate entry when socket upsert arrives before create success', () => {
    const afterSocket = projectTimeEntriesReducer(
      initialProjectTimeEntriesState,
      projectBoardTimeEntryUpsert({ entry }),
    );
    const afterCreate = projectTimeEntriesReducer(afterSocket, createProjectTimeEntrySuccess({ entry }));

    expect(afterCreate.entries).toHaveLength(1);
    expect(afterCreate.entries[0]).toEqual(entry);
  });

  it('updates existing entry on socket upsert', () => {
    const updated = { ...entry, durationMinutes: 120 };
    const state = projectTimeEntriesReducer(
      { ...initialProjectTimeEntriesState, entries: [entry] },
      projectBoardTimeEntryUpsert({ entry: updated }),
    );

    expect(state.entries[0].durationMinutes).toBe(120);
  });

  it('removes entry on socket removed', () => {
    const state = projectTimeEntriesReducer(
      {
        ...initialProjectTimeEntriesState,
        entries: [entry],
        ticketScope: { projectId: 'p-1', ticketId: 't-1', entries: [entry], loading: false, error: null },
      },
      projectBoardTimeEntryRemoved({ id: 'e-1', projectId: 'p-1' }),
    );

    expect(state.entries).toEqual([]);
    expect(state.ticketScope.entries).toEqual([]);
  });
});
