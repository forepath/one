import { projectBoardTimeEntryUpsert } from './project-time-entries.actions';
import { initialProjectTimeEntriesState, projectTimeEntriesReducer } from './project-time-entries.reducer';
import { syncTicketScopeOnUpsert } from './project-time-entries.utils';

describe('projectTimeEntries.utils', () => {
  it('syncTicketScopeOnUpsert adds matching entry', () => {
    const scope = {
      projectId: 'p-1',
      ticketId: 't-1',
      entries: [],
      loading: false,
      error: null,
    };
    const entry = {
      id: 'e-1',
      projectId: 'p-1',
      ticketId: 't-1',
      recordedByUserId: 'u-1',
      durationMinutes: 30,
      startedAt: '2024-01-01T09:00:00.000Z',
      endedAt: '2024-01-01T09:30:00.000Z',
      recordedAt: '2024-01-01T09:00:00.000Z',
      createdAt: '2024-01-01',
    };

    const next = syncTicketScopeOnUpsert(scope, entry);

    expect(next.entries).toEqual([entry]);
  });

  it('syncTicketScopeOnUpsert removes entry when ticket link changes away', () => {
    const entry = {
      id: 'e-1',
      projectId: 'p-1',
      ticketId: 't-2',
      recordedByUserId: 'u-1',
      durationMinutes: 30,
      startedAt: '2024-01-01T09:00:00.000Z',
      endedAt: '2024-01-01T09:30:00.000Z',
      recordedAt: '2024-01-01T09:00:00.000Z',
      createdAt: '2024-01-01',
    };
    const scope = {
      projectId: 'p-1',
      ticketId: 't-1',
      entries: [{ ...entry, ticketId: 't-1' }],
      loading: false,
      error: null,
    };

    const next = syncTicketScopeOnUpsert(scope, entry);

    expect(next.entries).toEqual([]);
  });
});

describe('projectTimeEntriesReducer ticket scope', () => {
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

  it('updates ticket scope on websocket upsert', () => {
    const state = {
      ...initialProjectTimeEntriesState,
      ticketScope: {
        projectId: 'p-1',
        ticketId: 't-1',
        entries: [],
        loading: false,
        error: null,
      },
    };

    const next = projectTimeEntriesReducer(state, projectBoardTimeEntryUpsert({ entry }));

    expect(next.ticketScope.entries).toEqual([entry]);
  });
});
