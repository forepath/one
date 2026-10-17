import { logoutSuccess } from '@forepath/identity/frontend';
import type { Action, ActionReducer } from '@ngrx/store';

import { clearAccess } from '../access/access.actions';

/** Actions that end the user's session in the console: nothing of theirs may stay in the store after them. */
export const CONSOLE_SESSION_END_ACTIONS: readonly string[] = [logoutSuccess.type, clearAccess.type];

/**
 * A feature meta-reducer for every `console*` slice: on logout (`logoutSuccess`) and when access is cleared
 * (`clearAccess`, e.g. the session ended) the slice is rebuilt from its initial state, so the next user signing in
 * never sees the previous user's data (lists, details, favourites, …).
 */
export function resetConsoleStateOnLogout<T, V extends Action = Action>(
  reducer: ActionReducer<T, V>,
): ActionReducer<T, V> {
  return (state, action) => reducer(CONSOLE_SESSION_END_ACTIONS.includes(action.type) ? undefined : state, action);
}

/** `provideState(name, reducer, CONSOLE_FEATURE_CONFIG)` for the console's slices. */
export const CONSOLE_FEATURE_CONFIG = { metaReducers: [resetConsoleStateOnLogout] };
