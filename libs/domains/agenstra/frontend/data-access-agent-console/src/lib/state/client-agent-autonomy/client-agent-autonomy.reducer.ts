import { createReducer, on } from '@ngrx/store';

import {
  clearClientAgentAutonomy,
  clearClientAgentAutonomyError,
  loadClientAgentAutonomy,
  loadClientAgentAutonomyFailure,
  loadClientAgentAutonomySuccess,
  upsertClientAgentAutonomy,
  upsertClientAgentAutonomyFailure,
  upsertClientAgentAutonomySuccess,
} from './client-agent-autonomy.actions';
import type { ClientAgentAutonomyResponseDto } from './client-agent-autonomy.types';

export interface ClientAgentAutonomyState {
  clientId: string | null;
  agentId: string | null;
  autonomy: ClientAgentAutonomyResponseDto | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

export const initialClientAgentAutonomyState: ClientAgentAutonomyState = {
  clientId: null,
  agentId: null,
  autonomy: null,
  loading: false,
  saving: false,
  error: null,
};

export const clientAgentAutonomyReducer = createReducer(
  initialClientAgentAutonomyState,
  on(loadClientAgentAutonomy, (state, { clientId, agentId }) => ({
    ...state,
    clientId,
    agentId,
    loading: true,
    error: null,
    ...(state.clientId !== clientId || state.agentId !== agentId ? { autonomy: null } : {}),
  })),
  on(loadClientAgentAutonomySuccess, (state, { autonomy }) => ({
    ...state,
    loading: false,
    autonomy,
    error: null,
  })),
  on(loadClientAgentAutonomyFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(upsertClientAgentAutonomy, (state) => ({
    ...state,
    saving: true,
    error: null,
  })),
  on(upsertClientAgentAutonomySuccess, (state, { autonomy }) => ({
    ...state,
    saving: false,
    autonomy,
    error: null,
  })),
  on(upsertClientAgentAutonomyFailure, (state, { error }) => ({
    ...state,
    saving: false,
    error,
  })),
  on(clearClientAgentAutonomyError, (state) => ({ ...state, error: null })),
  on(clearClientAgentAutonomy, () => ({ ...initialClientAgentAutonomyState })),
);
