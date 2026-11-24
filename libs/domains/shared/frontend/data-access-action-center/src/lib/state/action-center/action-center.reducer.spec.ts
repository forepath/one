import type { ActionCenterGroup, ActionCenterView } from '../../types/action-center.types';

import {
  actionCenterConnected,
  actionCenterConnectionLost,
  actionCenterReconnecting,
  actionCenterSilenceFailure,
  actionCenterViewReceived,
  disconnectActionCenter,
  loadActionCenter,
  silenceActionCenterItem,
  toggleActionCenterPanel,
} from './action-center.actions';
import { actionCenterReducer, createInitialActionCenterState, type ActionCenterState } from './action-center.reducer';
import {
  selectActionCenterOpenCount,
  selectActionCenterSetupGroups,
  selectActionCenterSilencedGroups,
  selectActionCenterTaskCategories,
} from './action-center.selectors';

function group(partial: Partial<ActionCenterGroup>): ActionCenterGroup {
  return {
    type: 'decabill.invoices.unsent',
    category: 'receivables',
    severity: 'warning',
    kind: 'task',
    audience: 'administrative',
    total: 2,
    openCount: 2,
    params: {},
    items: [],
    silencedBy: null,
    ...partial,
  };
}

function view(partial: Partial<ActionCenterView> = {}): ActionCenterView {
  return {
    generatedAt: '2026-11-24T10:00:00.000Z',
    role: 'admin',
    canSilenceForEveryone: true,
    counts: { open: 5, setup: 1, silenced: 1 },
    groups: [
      group({ type: 'decabill.setup.issuer', category: 'setup', kind: 'setup', total: 1, openCount: 1 }),
      group({}),
      group({ type: 'decabill.offers.unsent', category: 'offers', openCount: 2 }),
      group({ type: 'decabill.invoices.draft', silencedBy: 's-1', openCount: 0 }),
      group({
        type: 'decabill.invoices.overdue',
        openCount: 0,
        total: 1,
        items: [{ id: 'i', params: {}, occurredAt: null, silencedBy: 's-2' }],
      }),
    ],
    silences: [],
    ...partial,
  };
}

const initial = (): ActionCenterState => ({
  ...createInitialActionCenterState(),
  panelOpen: false,
  connection: 'live',
});

describe('actionCenterReducer', () => {
  it('tracks the connection state', () => {
    let state = actionCenterReducer(initial(), actionCenterConnected());

    expect(state.connection).toBe('live');
    state = actionCenterReducer(state, actionCenterReconnecting({ attempt: 2 }));
    expect(state.connection).toBe('reconnecting');
    state = actionCenterReducer(state, actionCenterConnectionLost({ error: 'x' }));
    expect(state.connection).toBe('offline');
  });

  it('stores views and ignores older ones', () => {
    let state = actionCenterReducer(initial(), loadActionCenter());

    expect(state.loading).toBe(true);
    state = actionCenterReducer(state, actionCenterViewReceived({ view: view() }));
    expect(state.view?.counts.open).toBe(5);
    expect(state.loading).toBe(false);

    state = actionCenterReducer(
      state,
      actionCenterViewReceived({
        view: view({ generatedAt: '2026-11-24T09:00:00.000Z', counts: { open: 1, setup: 0, silenced: 0 } }),
      }),
    );
    expect(state.view?.counts.open).toBe(5);
  });

  it('clears the view on disconnect (sign-out / role loss)', () => {
    const state = actionCenterReducer(
      actionCenterReducer(initial(), actionCenterViewReceived({ view: view() })),
      disconnectActionCenter(),
    );

    expect(state.view).toBeNull();
    expect(state.connection).toBe('idle');
  });

  it('tracks silence requests and their errors', () => {
    let state = actionCenterReducer(
      initial(),
      silenceActionCenterItem({ silence: { itemType: 'a.b', audience: 'self' } }),
    );

    expect(state.saving).toBe(true);
    state = actionCenterReducer(
      state,
      actionCenterSilenceFailure({ error: 'Only admins can silence items for everyone' }),
    );
    expect(state.saving).toBe(false);
    expect(state.error).toBe('Only admins can silence items for everyone');
  });

  it('ignores views arriving after a disconnect (no previous user data after sign-out)', () => {
    const state = actionCenterReducer({ ...initial(), connection: 'idle' }, actionCenterViewReceived({ view: view() }));

    expect(state.view).toBeNull();
  });

  it('toggles the panel', () => {
    expect(actionCenterReducer(initial(), toggleActionCenterPanel()).panelOpen).toBe(true);
  });
});

describe('action center selectors', () => {
  const state = { actionCenter: actionCenterReducer(initial(), actionCenterViewReceived({ view: view() })) };

  it('exposes the badge count', () => {
    expect(selectActionCenterOpenCount(state)).toBe(5);
    expect(selectActionCenterOpenCount({ actionCenter: initial() })).toBe(0);
  });

  it('separates setup suggestions from task categories and drops silenced / empty groups', () => {
    expect(selectActionCenterSetupGroups(state).map((entry) => entry.type)).toEqual(['decabill.setup.issuer']);
    expect(selectActionCenterTaskCategories(state)).toEqual([
      { category: 'receivables', groups: [expect.objectContaining({ type: 'decabill.invoices.unsent' })] },
      { category: 'offers', groups: [expect.objectContaining({ type: 'decabill.offers.unsent' })] },
    ]);
  });

  it('lists groups with silences', () => {
    expect(selectActionCenterSilencedGroups(state).map((entry) => entry.type)).toEqual([
      'decabill.invoices.draft',
      'decabill.invoices.overdue',
    ]);
  });
});
