import { createReducer, on } from '@ngrx/store';

import type { AccessMe } from '../../types/console.types';
import { clearAccess, loadAccess, loadAccessFailure, loadAccessSuccess } from './access.actions';

export interface ConsoleAccessState {
  me: AccessMe | null;
  loading: boolean;
  error: string | null;
}

export const initialConsoleAccessState: ConsoleAccessState = { me: null, loading: false, error: null };

export const consoleAccessReducer = createReducer(
  initialConsoleAccessState,
  on(loadAccess, (state) => ({ ...state, loading: true, error: null })),
  on(loadAccessSuccess, (state, { me }) => ({ ...state, me, loading: false })),
  // Never keep another (or the previous) user's permissions after a failed load.
  on(loadAccessFailure, (state, { error }) => ({ ...state, me: null, loading: false, error })),
  on(clearAccess, () => initialConsoleAccessState),
);
