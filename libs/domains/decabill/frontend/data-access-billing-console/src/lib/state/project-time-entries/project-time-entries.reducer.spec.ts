import {
  loadProjectTimeEntries,
  loadProjectTimeEntriesSuccess,
  createProjectTimeEntrySuccess,
  projectBoardTimeEntryUpsert,
} from './project-time-entries.actions';
import { initialProjectTimeEntriesState, projectTimeEntriesReducer } from './project-time-entries.reducer';

describe('projectTimeEntriesReducer', () => {
  const entry = {
    id: 'e-1',
    projectId: 'p-1',
    recordedByUserId: 'u-1',
    durationMinutes: 60,
    startedAt: '2024-01-01T09:00:00.000Z',
    endedAt: '2024-01-01T10:00:00.000Z',
    recordedAt: '2024-01-01T09:00:00.000Z',
    createdAt: '2024-01-01',
  };

  it('loads entries', () => {
    const state = projectTimeEntriesReducer(
      initialProjectTimeEntriesState,
      loadProjectTimeEntries({ projectId: 'p-1' }),
    );

    expect(state.loading).toBe(true);
    expect(state.entries).toEqual([]);
  });

  it('stores entries on success', () => {
    const state = projectTimeEntriesReducer(
      { ...initialProjectTimeEntriesState, loading: true },
      loadProjectTimeEntriesSuccess({ entries: [entry] }),
    );

    expect(state.entries).toEqual([entry]);
    expect(state.loading).toBe(false);
  });

  it('prepends entry on create', () => {
    const state = projectTimeEntriesReducer(initialProjectTimeEntriesState, createProjectTimeEntrySuccess({ entry }));

    expect(state.entries[0]).toEqual(entry);
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
});
