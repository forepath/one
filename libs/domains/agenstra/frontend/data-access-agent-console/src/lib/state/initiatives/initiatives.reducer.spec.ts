import {
  initiativeArtifactLiveUpsert,
  initiativeLiveUpsert,
  initiativeRunLiveUpsert,
  initiativeRunTurnLiveAppended,
  initiativeWorkItemsLiveChanged,
  loadInitiativeDetailSuccess,
  loadInitiatives,
  loadInitiativesSuccess,
  openInitiativeRun,
  openInitiativeRunSuccess,
  runInitiativeCommand,
  runInitiativeCommandFailure,
  runInitiativeCommandSuccess,
  selectInitiative,
} from './initiatives.actions';
import { initialInitiativesState, initiativesReducer, type InitiativesState } from './initiatives.reducer';
import type {
  InitiativeArtifactDto,
  InitiativeDto,
  InitiativeOverviewDto,
  InitiativeRunDto,
  InitiativeWorkItemDto,
  InitiativeWorkItemsDto,
} from './initiatives.types';

const initiative = (overrides: Partial<InitiativeDto> = {}): InitiativeDto =>
  ({
    id: 'ini-1',
    clientId: 'client-1',
    title: 'Checkout',
    intent: '',
    path: 'epic',
    phase: 'plan',
    state: 'active',
    iteration: 1,
    version: 2,
    updatedAt: '2026-11-07T10:00:00.000Z',
    createdAt: '2026-11-07T09:00:00.000Z',
    shas: { short: 'aaaaaaaa', long: 'a'.repeat(40) },
    ...overrides,
  }) as InitiativeDto;

const run = (overrides: Partial<InitiativeRunDto> = {}): InitiativeRunDto =>
  ({ id: 'run-1', initiativeId: 'ini-1', status: 'working', version: 2, ...overrides }) as InitiativeRunDto;

function selected(): InitiativesState {
  let state = initiativesReducer(initialInitiativesState, loadInitiatives({ clientId: 'client-1' }));

  state = initiativesReducer(state, loadInitiativesSuccess({ clientId: 'client-1', items: [initiative()], total: 1 }));
  state = initiativesReducer(state, selectInitiative({ id: 'ini-1' }));

  return initiativesReducer(
    state,
    loadInitiativeDetailSuccess({
      id: 'ini-1',
      overview: { initiative: initiative() } as InitiativeOverviewDto,
      artifacts: [],
      workItems: { initiativeId: 'ini-1', items: [], initiativeVersion: 2, unknowns: [] },
      runs: [run()],
      proposals: [],
      findings: [],
      decisions: [],
      activity: [],
    }),
  );
}

describe('initiativesReducer', () => {
  it('keeps the newest version of live and REST payloads', () => {
    let state = selected();

    state = initiativesReducer(state, initiativeLiveUpsert({ initiative: initiative({ version: 3, title: 'New' }) }));
    expect(state.list[0].title).toBe('New');
    expect(state.overview?.initiative.title).toBe('New');

    state = initiativesReducer(state, initiativeLiveUpsert({ initiative: initiative({ version: 2, title: 'Old' }) }));
    expect(state.list[0].title).toBe('New');
  });

  it('ignores initiatives of other workspaces', () => {
    const state = initiativesReducer(
      selected(),
      initiativeLiveUpsert({ initiative: initiative({ id: 'x', clientId: 'client-2' }) }),
    );

    expect(state.list.map((row) => row.id)).toEqual(['ini-1']);
  });

  it('applies work item trees only for the selected initiative and never older ones', () => {
    const tree = (version: number): InitiativeWorkItemsDto => ({
      initiativeId: 'ini-1',
      items: [],
      initiativeVersion: version,
      unknowns: [],
    });
    let state = initiativesReducer(
      selected(),
      initiativeWorkItemsLiveChanged({ initiativeId: 'ini-1', workItems: tree(5) }),
    );

    expect(state.workItems?.initiativeVersion).toBe(5);
    state = initiativesReducer(state, initiativeWorkItemsLiveChanged({ initiativeId: 'ini-1', workItems: tree(4) }));
    expect(state.workItems?.initiativeVersion).toBe(5);
    state = initiativesReducer(state, initiativeWorkItemsLiveChanged({ initiativeId: 'other', workItems: tree(9) }));
    expect(state.workItems?.initiativeVersion).toBe(5);
    // A tree without an initiative id (never sent by the server) must not land on whichever initiative is open.
    state = initiativesReducer(state, initiativeWorkItemsLiveChanged({ initiativeId: '', workItems: tree(9) }));
    expect(state.workItems?.initiativeVersion).toBe(5);
  });

  it('keeps document content out of the list and in the open document only', () => {
    const artifact = { id: 'a1', initiativeId: 'ini-1', version: 1, content: '# PRD' } as InitiativeArtifactDto;
    const state = initiativesReducer(selected(), initiativeArtifactLiveUpsert({ artifact }));

    expect(state.artifacts[0]).not.toHaveProperty('content');
  });

  it('streams turns into the open run once', () => {
    let state = initiativesReducer(selected(), openInitiativeRun({ runId: 'run-1' }));

    state = initiativesReducer(state, openInitiativeRunSuccess({ run: run({ turns: [] }) }));

    const turn = {
      id: 't1',
      runId: 'run-1',
      seq: 1,
      role: 'agent' as const,
      content: 'Hi',
      actorUserId: null,
      createdAt: '',
    };

    state = initiativesReducer(state, initiativeRunTurnLiveAppended({ initiativeId: 'ini-1', turn }));
    state = initiativesReducer(state, initiativeRunTurnLiveAppended({ initiativeId: 'ini-1', turn }));
    expect(state.openRun?.turns).toEqual([turn]);

    state = initiativesReducer(state, initiativeRunLiveUpsert({ run: run({ status: 'ready', version: 3 }) }));
    expect(state.openRun?.status).toBe('ready');
    expect(state.openRun?.turns).toEqual([turn]);
  });

  it('merges transfer results per item without rolling back newer live items', () => {
    const item = (id: string, version: number, title: string) => ({ id, version, title }) as InitiativeWorkItemDto;
    let state = initiativesReducer(
      selected(),
      initiativeWorkItemsLiveChanged({
        initiativeId: 'ini-1',
        workItems: {
          initiativeId: 'ini-1',
          items: [item('s1', 3, 'live'), item('s2', 1, 'old')],
          initiativeVersion: 5,
          unknowns: [],
        },
      }),
    );
    const command = { type: 'transfer' as const, initiativeId: 'ini-1', dto: {} };

    state = initiativesReducer(
      state,
      runInitiativeCommandSuccess({
        command,
        result: {
          kind: 'build',
          initiativeId: 'ini-1',
          result: { workItems: [item('s1', 2, 'stale'), item('s2', 1, 'linked')], ticketIds: [], skipped: [] },
        },
      }),
    );

    expect(state.workItems?.items.map((row) => row.title)).toEqual(['live', 'linked']);
  });

  it('tracks pending commands, conflicts and the created initiative', () => {
    const command = {
      type: 'createInitiative' as const,
      dto: { clientId: 'client-1', title: 'B', path: 'epic' as const },
    };
    let state = initiativesReducer(selected(), runInitiativeCommand({ command }));

    expect(state.pending).toBe(1);
    state = initiativesReducer(
      state,
      runInitiativeCommandSuccess({
        command,
        result: { kind: 'initiative', initiative: initiative({ id: 'ini-2', version: 1 }) },
      }),
    );
    expect(state.pending).toBe(0);
    expect(state.createdId).toBe('ini-2');
    expect(state.list.map((row) => row.id)).toContain('ini-2');

    state = initiativesReducer(state, runInitiativeCommand({ command }));
    state = initiativesReducer(state, runInitiativeCommandFailure({ command, error: 'changed', conflict: true }));
    expect(state).toMatchObject({ conflict: true, error: 'changed', pending: 0 });
  });
});
