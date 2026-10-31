import { createReducer, on } from '@ngrx/store';

import type { Overview } from '../../types/console.types';
import { loadOverview, loadOverviewFailure, loadOverviewSuccess } from './overview.actions';

export interface ConsoleOverviewState {
  overview: Overview | null;
  project: string | null;
  loading: boolean;
  error: string | null;
}

export const initialConsoleOverviewState: ConsoleOverviewState = {
  overview: null,
  project: null,
  loading: false,
  error: null,
};

export const consoleOverviewReducer = createReducer(
  initialConsoleOverviewState,
  on(loadOverview, (state, { project, silent }) => ({
    ...state,
    // Another scope: the previous one's numbers must not show meanwhile.
    overview: (project ?? null) === state.project ? state.overview : null,
    project: project ?? null,
    loading: !silent,
    error: null,
  })),
  on(loadOverviewSuccess, (state, { overview }) => ({ ...state, overview, loading: false })),
  on(loadOverviewFailure, (state, { error }) => ({ ...state, loading: false, error })),
);
