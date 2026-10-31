import { createReducer, on } from '@ngrx/store';

import type { UpdatesFullState, UpdatesStatusSummary } from '../../types/updates.types';

import {
  clearAdminUpdatesError,
  loadAdminUpdatesFull,
  loadAdminUpdatesFullFailure,
  loadAdminUpdatesFullSuccess,
  loadAdminUpdatesStatus,
  loadAdminUpdatesStatusFailure,
  loadAdminUpdatesStatusSuccess,
  triggerAdminUpdateCheck,
  triggerAdminUpdateCheckFailure,
  triggerAdminUpdateCheckSuccess,
} from './admin-updates.actions';

export interface AdminUpdatesState {
  status: UpdatesStatusSummary | null;
  fullState: UpdatesFullState | null;
  statusLoading: boolean;
  fullLoading: boolean;
  checking: boolean;
  error: string | null;
}

export const initialAdminUpdatesState: AdminUpdatesState = {
  status: null,
  fullState: null,
  statusLoading: false,
  fullLoading: false,
  checking: false,
  error: null,
};

function statusFromFullState(fullState: UpdatesFullState): UpdatesStatusSummary {
  return {
    installedVersion: fullState.installedVersion,
    latestVersion: fullState.latestVersion,
    updateState: fullState.updateState,
    lastCheckAt: fullState.lastCheckAt,
    lastCheckStatus: fullState.lastCheckStatus,
    instanceCount: fullState.instanceCount,
    outdatedInstanceCount: fullState.outdatedInstanceCount,
    ...(fullState.channel ? { channel: fullState.channel } : {}),
  };
}

export const adminUpdatesReducer = createReducer(
  initialAdminUpdatesState,
  on(loadAdminUpdatesStatus, (state) => ({
    ...state,
    statusLoading: true,
    error: null,
  })),
  on(loadAdminUpdatesStatusSuccess, (state, { status }) => ({
    ...state,
    statusLoading: false,
    status,
    checking: state.checking && status.lastCheckStatus === 'pending',
    error: null,
  })),
  on(loadAdminUpdatesStatusFailure, (state, { error }) => ({
    ...state,
    statusLoading: false,
    checking: false,
    error,
  })),
  on(loadAdminUpdatesFull, (state) => ({
    ...state,
    fullLoading: true,
    error: null,
  })),
  on(loadAdminUpdatesFullSuccess, (state, { fullState }) => ({
    ...state,
    fullLoading: false,
    checking: false,
    fullState,
    status: statusFromFullState(fullState),
    error: null,
  })),
  on(loadAdminUpdatesFullFailure, (state, { error }) => ({
    ...state,
    fullLoading: false,
    checking: false,
    error,
  })),
  on(triggerAdminUpdateCheck, (state) => ({
    ...state,
    checking: true,
    error: null,
  })),
  on(triggerAdminUpdateCheckSuccess, (state) => ({
    ...state,
    checking: true,
    error: null,
  })),
  on(triggerAdminUpdateCheckFailure, (state, { error }) => ({
    ...state,
    checking: false,
    error,
  })),
  on(clearAdminUpdatesError, (state) => ({ ...state, error: null })),
);
