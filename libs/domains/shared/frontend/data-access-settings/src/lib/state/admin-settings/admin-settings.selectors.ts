import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AdminSettingsState } from './admin-settings.reducer';

export const selectAdminSettingsState = createFeatureSelector<AdminSettingsState>('adminSettings');

export const selectAdminSettingsOverview = createSelector(selectAdminSettingsState, (state) => state.overview);
export const selectAdminSettingsTarget = createSelector(selectAdminSettingsState, (state) => state.target);
export const selectAdminSettingsLoading = createSelector(selectAdminSettingsState, (state) => state.loading);
export const selectAdminSettingsError = createSelector(selectAdminSettingsState, (state) => state.error);
export const selectAdminSettingsPendingKeys = createSelector(selectAdminSettingsState, (state) => state.pendingKeys);
export const selectAdminSettingsErrors = createSelector(selectAdminSettingsState, (state) => state.settingErrors);
