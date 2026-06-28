import { createReducer, on } from '@ngrx/store';

import type { CloudInitConfigResponse } from '../../types/billing.types';

import {
  clearSelectedCloudInitConfig,
  createCloudInitConfig,
  createCloudInitConfigFailure,
  createCloudInitConfigSuccess,
  deleteCloudInitConfig,
  deleteCloudInitConfigFailure,
  deleteCloudInitConfigSuccess,
  loadCloudInitConfig,
  loadCloudInitConfigFailure,
  loadCloudInitConfigs,
  loadCloudInitConfigsBatch,
  loadCloudInitConfigsFailure,
  loadCloudInitConfigsSuccess,
  loadCloudInitConfigSuccess,
  updateCloudInitConfig,
  updateCloudInitConfigFailure,
  updateCloudInitConfigSuccess,
} from './cloud-init-configs.actions';

export interface CloudInitConfigsState {
  entities: CloudInitConfigResponse[];
  selectedCloudInitConfig: CloudInitConfigResponse | null;
  loading: boolean;
  loadingCloudInitConfig: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  error: string | null;
}

export const initialCloudInitConfigsState: CloudInitConfigsState = {
  entities: [],
  selectedCloudInitConfig: null,
  loading: false,
  loadingCloudInitConfig: false,
  creating: false,
  updating: false,
  deleting: false,
  error: null,
};

export const cloudInitConfigsReducer = createReducer(
  initialCloudInitConfigsState,
  on(loadCloudInitConfigs, (state) => ({ ...state, entities: [], loading: true, error: null })),
  on(loadCloudInitConfigsBatch, (state, { accumulatedCloudInitConfigs }) => ({
    ...state,
    entities: accumulatedCloudInitConfigs,
    loading: true,
    error: null,
  })),
  on(loadCloudInitConfigsSuccess, (state, { cloudInitConfigs }) => ({
    ...state,
    entities: cloudInitConfigs,
    loading: false,
    error: null,
  })),
  on(loadCloudInitConfigsFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadCloudInitConfig, (state) => ({ ...state, loadingCloudInitConfig: true, error: null })),
  on(loadCloudInitConfigSuccess, (state, { cloudInitConfig }) => {
    const existingIndex = state.entities.findIndex((c) => c.id === cloudInitConfig.id);
    const entities =
      existingIndex >= 0
        ? state.entities.map((c) => (c.id === cloudInitConfig.id ? cloudInitConfig : c))
        : [...state.entities, cloudInitConfig];

    return {
      ...state,
      entities,
      selectedCloudInitConfig: cloudInitConfig,
      loadingCloudInitConfig: false,
      error: null,
    };
  }),
  on(loadCloudInitConfigFailure, (state, { error }) => ({ ...state, loadingCloudInitConfig: false, error })),
  on(createCloudInitConfig, (state) => ({ ...state, creating: true, error: null })),
  on(createCloudInitConfigSuccess, (state, { cloudInitConfig }) => ({
    ...state,
    entities: [...state.entities, cloudInitConfig],
    selectedCloudInitConfig: cloudInitConfig,
    creating: false,
    error: null,
  })),
  on(createCloudInitConfigFailure, (state, { error }) => ({ ...state, creating: false, error })),
  on(updateCloudInitConfig, (state) => ({ ...state, updating: true, error: null })),
  on(updateCloudInitConfigSuccess, (state, { cloudInitConfig }) => ({
    ...state,
    entities: state.entities.map((c) => (c.id === cloudInitConfig.id ? cloudInitConfig : c)),
    selectedCloudInitConfig:
      state.selectedCloudInitConfig?.id === cloudInitConfig.id ? cloudInitConfig : state.selectedCloudInitConfig,
    updating: false,
    error: null,
  })),
  on(updateCloudInitConfigFailure, (state, { error }) => ({ ...state, updating: false, error })),
  on(deleteCloudInitConfig, (state) => ({ ...state, deleting: true, error: null })),
  on(deleteCloudInitConfigSuccess, (state, { id }) => ({
    ...state,
    entities: state.entities.filter((c) => c.id !== id),
    selectedCloudInitConfig: state.selectedCloudInitConfig?.id === id ? null : state.selectedCloudInitConfig,
    deleting: false,
    error: null,
  })),
  on(deleteCloudInitConfigFailure, (state, { error }) => ({ ...state, deleting: false, error })),
  on(clearSelectedCloudInitConfig, (state) => ({ ...state, selectedCloudInitConfig: null })),
);
