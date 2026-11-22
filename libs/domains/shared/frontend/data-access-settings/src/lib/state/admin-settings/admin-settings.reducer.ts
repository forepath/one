import { createReducer, on } from '@ngrx/store';

import type { SettingStateView, SettingsOverviewResponse, SettingsTarget } from '../../types/settings.types';

import {
  clearAdminSettingError,
  loadAdminSettings,
  loadAdminSettingsFailure,
  loadAdminSettingsSuccess,
  resetAdminSetting,
  resetAdminSettingFailure,
  resetAdminSettingSuccess,
  saveAdminSetting,
  saveAdminSettingFailure,
  saveAdminSettingSuccess,
} from './admin-settings.actions';

export interface AdminSettingsState {
  overview: SettingsOverviewResponse | null;
  /** Target of the loaded overview (used for writes). */
  target: SettingsTarget | null;
  loading: boolean;
  error: string | null;
  /** Keys with a write in flight. */
  pendingKeys: string[];
  /** Write errors per key. */
  settingErrors: Record<string, string>;
}

export const initialAdminSettingsState: AdminSettingsState = {
  overview: null,
  target: null,
  loading: false,
  error: null,
  pendingKeys: [],
  settingErrors: {},
};

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };

  delete next[key];

  return next;
}

function replaceSetting(state: AdminSettingsState, setting: SettingStateView): AdminSettingsState {
  return {
    ...state,
    overview: state.overview
      ? {
          ...state.overview,
          settings: state.overview.settings.map((entry) => (entry.key === setting.key ? setting : entry)),
        }
      : state.overview,
    pendingKeys: state.pendingKeys.filter((key) => key !== setting.key),
    settingErrors: withoutKey(state.settingErrors, setting.key),
  };
}

export const adminSettingsReducer = createReducer(
  initialAdminSettingsState,
  on(loadAdminSettings, (state) => ({ ...state, loading: true, error: null })),
  on(loadAdminSettingsSuccess, (state, { overview }) => ({
    ...state,
    overview,
    target: { level: overview.level, tenantId: overview.tenantId },
    loading: false,
    error: null,
    pendingKeys: [],
    settingErrors: {},
  })),
  on(loadAdminSettingsFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(saveAdminSetting, resetAdminSetting, (state, { key }) => ({
    ...state,
    pendingKeys: state.pendingKeys.includes(key) ? state.pendingKeys : [...state.pendingKeys, key],
    settingErrors: withoutKey(state.settingErrors, key),
  })),
  on(saveAdminSettingSuccess, resetAdminSettingSuccess, (state, { setting }) => replaceSetting(state, setting)),
  on(saveAdminSettingFailure, resetAdminSettingFailure, (state, { key, error }) => ({
    ...state,
    pendingKeys: state.pendingKeys.filter((entry) => entry !== key),
    settingErrors: { ...state.settingErrors, [key]: error },
  })),
  on(clearAdminSettingError, (state, { key }) => ({ ...state, settingErrors: withoutKey(state.settingErrors, key) })),
);
