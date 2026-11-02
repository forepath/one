import { logoutSuccess } from '@forepath/identity/frontend';
import type { Action, ActionReducer } from '@ngrx/store';

import { clearAccess } from '../access/access.actions';
import { fleetClusterSwitched } from '../fleet/fleet.actions';

/** Actions that end the user's session in the console: nothing of theirs may stay in the store after them. */
export const CONSOLE_SESSION_END_ACTIONS: readonly string[] = [logoutSuccess.type, clearAccess.type];

/** Plus, for the cluster-scoped slices, switching the active cluster in fleet mode. */
export const CONSOLE_CLUSTER_RESET_ACTIONS: readonly string[] = [
  ...CONSOLE_SESSION_END_ACTIONS,
  fleetClusterSwitched.type,
];

/**
 * A feature meta-reducer for every cluster-scoped `console*` slice: on logout (`logoutSuccess`), when access is
 * cleared (`clearAccess`, e.g. the session ended) and when the fleet mode switches clusters (`fleetClusterSwitched`)
 * the slice is rebuilt from its initial state, so the next user — or the next cluster — never shows the previous
 * one's data (lists, details, favourites, …).
 */
export function resetConsoleStateOnLogout<T, V extends Action = Action>(
  reducer: ActionReducer<T, V>,
): ActionReducer<T, V> {
  return (state, action) => reducer(CONSOLE_CLUSTER_RESET_ACTIONS.includes(action.type) ? undefined : state, action);
}

/** For slices that outlive a cluster switch (the fleet's own views): reset on session end only. */
export function resetFleetStateOnLogout<T, V extends Action = Action>(
  reducer: ActionReducer<T, V>,
): ActionReducer<T, V> {
  return (state, action) => reducer(CONSOLE_SESSION_END_ACTIONS.includes(action.type) ? undefined : state, action);
}

/** `provideState(name, reducer, CONSOLE_FEATURE_CONFIG)` for the console's slices. */
export const CONSOLE_FEATURE_CONFIG = { metaReducers: [resetConsoleStateOnLogout] };

/** `provideState('consoleFleet', consoleFleetReducer, FLEET_FEATURE_CONFIG)`. */
export const FLEET_FEATURE_CONFIG = { metaReducers: [resetFleetStateOnLogout] };
