import { createReducer, on } from '@ngrx/store';

import {
  clearAtlassianConnectionTestResult,
  clearAtlassianContextImportError,
  clearExternalImportMarkers,
  clearExternalImportMarkersFailure,
  clearExternalImportMarkersSuccess,
  createAtlassianConnection,
  createAtlassianConnectionFailure,
  createAtlassianConnectionSuccess,
  createExternalImportConfig,
  createExternalImportConfigFailure,
  createExternalImportConfigSuccess,
  deleteAtlassianConnection,
  deleteAtlassianConnectionFailure,
  deleteAtlassianConnectionSuccess,
  deleteExternalImportConfig,
  deleteExternalImportConfigFailure,
  deleteExternalImportConfigSuccess,
  loadAtlassianContextImportBatch,
  loadAtlassianContextImport,
  loadAtlassianContextImportFailure,
  loadAtlassianContextImportSuccess,
  runExternalImportConfig,
  runExternalImportConfigFailure,
  runExternalImportConfigSuccess,
  testAtlassianConnection,
  testAtlassianConnectionFailure,
  testAtlassianConnectionSuccess,
  updateAtlassianConnection,
  updateAtlassianConnectionFailure,
  updateAtlassianConnectionSuccess,
  updateExternalImportConfig,
  updateExternalImportConfigFailure,
  updateExternalImportConfigSuccess,
} from './context-import.actions';
import type {
  AtlassianConnectionTestResultDto,
  AtlassianSiteConnectionDto,
  ExternalImportConfigDto,
} from './context-import.types';

export interface AtlassianContextImportState {
  connections: AtlassianSiteConnectionDto[];
  configs: ExternalImportConfigDto[];
  loading: boolean;
  saving: boolean;
  deleting: boolean;
  runningConfigId: string | null;
  testingConnectionId: string | null;
  clearingMarkersId: string | null;
  error: string | null;
  lastConnectionTest: { connectionId: string; result: AtlassianConnectionTestResultDto } | null;
}

export const initialAtlassianContextImportState: AtlassianContextImportState = {
  connections: [],
  configs: [],
  loading: false,
  saving: false,
  deleting: false,
  runningConfigId: null,
  testingConnectionId: null,
  clearingMarkersId: null,
  error: null,
  lastConnectionTest: null,
};

export const atlassianContextImportReducer = createReducer(
  initialAtlassianContextImportState,
  on(loadAtlassianContextImport, (state) => ({
    ...state,
    connections: [],
    configs: [],
    loading: true,
    error: null,
  })),
  on(loadAtlassianContextImportBatch, (state, { accumulatedConnections, accumulatedConfigs }) => ({
    ...state,
    connections: accumulatedConnections,
    configs: accumulatedConfigs,
    loading: true,
    error: null,
  })),
  on(loadAtlassianContextImportSuccess, (state, { connections, configs }) => ({
    ...state,
    loading: false,
    connections,
    configs,
    error: null,
  })),
  on(loadAtlassianContextImportFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(
    createAtlassianConnection,
    updateAtlassianConnection,
    createExternalImportConfig,
    updateExternalImportConfig,
    (state) => ({ ...state, saving: true, error: null }),
  ),
  on(createAtlassianConnectionSuccess, (state, { connection }) => ({
    ...state,
    saving: false,
    connections: [...state.connections, connection].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    error: null,
  })),
  on(updateAtlassianConnectionSuccess, (state, { connection }) => ({
    ...state,
    saving: false,
    connections: state.connections.map((c) => (c.id === connection.id ? connection : c)),
    error: null,
  })),
  on(createExternalImportConfigSuccess, (state, { config }) => ({
    ...state,
    saving: false,
    configs: [...state.configs, config].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    error: null,
  })),
  on(updateExternalImportConfigSuccess, (state, { config }) => ({
    ...state,
    saving: false,
    configs: state.configs.map((c) => (c.id === config.id ? config : c)),
    error: null,
  })),
  on(
    createAtlassianConnectionFailure,
    updateAtlassianConnectionFailure,
    createExternalImportConfigFailure,
    updateExternalImportConfigFailure,
    (state, { error }) => ({ ...state, saving: false, error }),
  ),
  on(deleteAtlassianConnection, deleteExternalImportConfig, (state) => ({
    ...state,
    deleting: true,
    error: null,
  })),
  on(deleteAtlassianConnectionSuccess, (state, { id }) => ({
    ...state,
    deleting: false,
    connections: state.connections.filter((c) => c.id !== id),
    configs: state.configs.filter((c) => c.atlassianConnectionId !== id),
    error: null,
  })),
  on(deleteExternalImportConfigSuccess, (state, { id }) => ({
    ...state,
    deleting: false,
    configs: state.configs.filter((c) => c.id !== id),
    error: null,
  })),
  on(deleteAtlassianConnectionFailure, deleteExternalImportConfigFailure, (state, { error }) => ({
    ...state,
    deleting: false,
    error,
  })),
  on(testAtlassianConnection, (state, { id }) => ({
    ...state,
    testingConnectionId: id,
    error: null,
    lastConnectionTest: null,
  })),
  on(testAtlassianConnectionSuccess, (state, { connectionId, result }) => ({
    ...state,
    testingConnectionId: null,
    lastConnectionTest: { connectionId, result },
    error: null,
  })),
  on(testAtlassianConnectionFailure, (state, { error }) => ({
    ...state,
    testingConnectionId: null,
    error,
  })),
  on(runExternalImportConfig, (state, { id }) => ({
    ...state,
    runningConfigId: id,
    error: null,
  })),
  on(runExternalImportConfigSuccess, (state) => ({
    ...state,
    runningConfigId: null,
    error: null,
  })),
  on(runExternalImportConfigFailure, (state, { error }) => ({
    ...state,
    runningConfigId: null,
    error,
  })),
  on(clearExternalImportMarkers, (state, { id }) => ({
    ...state,
    clearingMarkersId: id,
    error: null,
  })),
  on(clearExternalImportMarkersSuccess, (state) => ({
    ...state,
    clearingMarkersId: null,
    error: null,
  })),
  on(clearExternalImportMarkersFailure, (state, { error }) => ({
    ...state,
    clearingMarkersId: null,
    error,
  })),
  on(clearAtlassianContextImportError, (state) => ({ ...state, error: null })),
  on(clearAtlassianConnectionTestResult, (state) => ({ ...state, lastConnectionTest: null })),
);
