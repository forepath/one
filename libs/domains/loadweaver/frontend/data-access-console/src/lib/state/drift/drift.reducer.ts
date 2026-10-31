import { createReducer, on } from '@ngrx/store';

import type { DriftReport } from '../../types/drift.types';
import {
  clearDriftProposeError,
  loadDrift,
  loadDriftFailure,
  loadDriftSuccess,
  proposeDriftPlan,
  proposeDriftPlanFailure,
  proposeDriftPlanSuccess,
} from './drift.actions';

export interface ConsoleDriftState {
  report: DriftReport | null;
  loading: boolean;
  error: string | null;
  proposing: boolean;
  proposeError: string | null;
}

export const initialConsoleDriftState: ConsoleDriftState = {
  report: null,
  loading: false,
  error: null,
  proposing: false,
  proposeError: null,
};

export const consoleDriftReducer = createReducer(
  initialConsoleDriftState,
  on(loadDrift, (state, { silent }) => ({ ...state, loading: !silent, error: null })),
  on(loadDriftSuccess, (state, { report }) => ({ ...state, report, loading: false })),
  on(loadDriftFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(proposeDriftPlan, (state) => ({ ...state, proposing: true, proposeError: null })),
  on(proposeDriftPlanSuccess, (state) => ({ ...state, proposing: false })),
  on(proposeDriftPlanFailure, (state, { error }) => ({ ...state, proposing: false, proposeError: error })),
  on(clearDriftProposeError, (state) => ({ ...state, proposeError: null })),
);
