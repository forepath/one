import { createReducer, on } from '@ngrx/store';

import type { Slo } from '../../types/slos.types';
import { loadSlos, loadSlosFailure, loadSlosSuccess } from './slos.actions';

export interface ConsoleSlosState {
  slos: Slo[];
  /** The project filter of the last load (null: every readable project). */
  project: string | null;
  loading: boolean;
  error: string | null;
}

export const initialConsoleSlosState: ConsoleSlosState = {
  slos: [],
  project: null,
  loading: false,
  error: null,
};

export const consoleSlosReducer = createReducer(
  initialConsoleSlosState,
  on(loadSlos, (state, { project, silent }) => ({
    ...state,
    slos: project === state.project ? state.slos : [],
    project,
    loading: !silent,
    error: null,
  })),
  on(loadSlosSuccess, (state, { slos }) => ({ ...state, slos, loading: false })),
  on(loadSlosFailure, (state, { error }) => ({ ...state, loading: false, error })),
);
