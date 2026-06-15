import { createReducer, on } from '@ngrx/store';

import {
  clearWorkspaceConfigurationOverrides,
  deleteWorkspaceConfigurationOverride,
  deleteWorkspaceConfigurationOverrideFailure,
  deleteWorkspaceConfigurationOverrideSuccess,
  loadWorkspaceConfigurationOverrides,
  loadWorkspaceConfigurationOverridesFailure,
  loadWorkspaceConfigurationOverridesSuccess,
  upsertWorkspaceConfigurationOverride,
  upsertWorkspaceConfigurationOverrideFailure,
  upsertWorkspaceConfigurationOverrideSuccess,
} from './workspace-config.actions';
import type { WorkspaceConfigurationSettingResponseDto } from './workspace-config.types';

export interface WorkspaceConfigState {
  settingsByClient: Record<string, WorkspaceConfigurationSettingResponseDto[]>;
  loading: Record<string, boolean>;
  saving: Record<string, boolean>;
  deleting: Record<string, boolean>;
  errors: Record<string, string | null>;
}

export const initialWorkspaceConfigState: WorkspaceConfigState = {
  settingsByClient: {},
  loading: {},
  saving: {},
  deleting: {},
  errors: {},
};

function getSettingKey(clientId: string, settingKey: string): string {
  return `${clientId}:${settingKey}`;
}

export const workspaceConfigReducer = createReducer(
  initialWorkspaceConfigState,
  on(loadWorkspaceConfigurationOverrides, (state, { clientId, silent }) => ({
    ...state,
    loading: { ...state.loading, [clientId]: silent ? (state.loading[clientId] ?? false) : true },
    errors: { ...state.errors, [clientId]: null },
  })),
  on(loadWorkspaceConfigurationOverridesSuccess, (state, { clientId, settings }) => ({
    ...state,
    settingsByClient: { ...state.settingsByClient, [clientId]: settings },
    loading: { ...state.loading, [clientId]: false },
    errors: { ...state.errors, [clientId]: null },
  })),
  on(loadWorkspaceConfigurationOverridesFailure, (state, { clientId, error }) => ({
    ...state,
    loading: { ...state.loading, [clientId]: false },
    errors: { ...state.errors, [clientId]: error },
  })),
  on(upsertWorkspaceConfigurationOverride, (state, { clientId, settingKey }) => {
    const key = getSettingKey(clientId, settingKey);

    return {
      ...state,
      saving: { ...state.saving, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(upsertWorkspaceConfigurationOverrideSuccess, (state, { clientId, setting }) => {
    const key = getSettingKey(clientId, setting.settingKey);
    const existing = state.settingsByClient[clientId] || [];
    const hasExisting = existing.some((entry) => entry.settingKey === setting.settingKey);
    const merged = hasExisting
      ? existing.map((entry) => (entry.settingKey === setting.settingKey ? setting : entry))
      : [...existing, setting];

    return {
      ...state,
      settingsByClient: { ...state.settingsByClient, [clientId]: merged },
      saving: { ...state.saving, [key]: false },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(upsertWorkspaceConfigurationOverrideFailure, (state, { clientId, settingKey, error }) => {
    const key = getSettingKey(clientId, settingKey);

    return {
      ...state,
      saving: { ...state.saving, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  on(deleteWorkspaceConfigurationOverride, (state, { clientId, settingKey }) => {
    const key = getSettingKey(clientId, settingKey);

    return {
      ...state,
      deleting: { ...state.deleting, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(deleteWorkspaceConfigurationOverrideSuccess, (state, { clientId, settingKey }) => {
    const key = getSettingKey(clientId, settingKey);

    return {
      ...state,
      deleting: { ...state.deleting, [key]: false },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(deleteWorkspaceConfigurationOverrideFailure, (state, { clientId, settingKey, error }) => {
    const key = getSettingKey(clientId, settingKey);

    return {
      ...state,
      deleting: { ...state.deleting, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  on(clearWorkspaceConfigurationOverrides, (state, { clientId }) => {
    const { [clientId]: _, ...settingsByClient } = state.settingsByClient;

    return {
      ...state,
      settingsByClient,
    };
  }),
);
