import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { WorkspaceConfigState } from './workspace-config.reducer';
import type { WorkspaceConfigurationSettingKey } from './workspace-config.types';

export const selectWorkspaceConfigState = createFeatureSelector<WorkspaceConfigState>('workspaceConfig');

export const selectWorkspaceConfigSettingsByClient = createSelector(
  selectWorkspaceConfigState,
  (state) => state.settingsByClient,
);
export const selectWorkspaceConfigLoading = createSelector(selectWorkspaceConfigState, (state) => state.loading);
export const selectWorkspaceConfigSaving = createSelector(selectWorkspaceConfigState, (state) => state.saving);
export const selectWorkspaceConfigDeleting = createSelector(selectWorkspaceConfigState, (state) => state.deleting);
export const selectWorkspaceConfigErrors = createSelector(selectWorkspaceConfigState, (state) => state.errors);

function getSettingKey(clientId: string, settingKey: WorkspaceConfigurationSettingKey): string {
  return `${clientId}:${settingKey}`;
}

export const selectWorkspaceConfigurationSettings = (clientId: string) =>
  createSelector(selectWorkspaceConfigSettingsByClient, (settingsByClient) => settingsByClient[clientId] ?? []);

export const selectWorkspaceConfigurationLoading = (clientId: string) =>
  createSelector(selectWorkspaceConfigLoading, (loading) => loading[clientId] ?? false);

export const selectWorkspaceConfigurationError = (clientId: string) =>
  createSelector(selectWorkspaceConfigErrors, (errors) => errors[clientId] ?? null);

export const selectWorkspaceConfigurationSettingSaving = (
  clientId: string,
  settingKey: WorkspaceConfigurationSettingKey,
) => createSelector(selectWorkspaceConfigSaving, (saving) => saving[getSettingKey(clientId, settingKey)] ?? false);

export const selectWorkspaceConfigurationSettingDeleting = (
  clientId: string,
  settingKey: WorkspaceConfigurationSettingKey,
) =>
  createSelector(selectWorkspaceConfigDeleting, (deleting) => deleting[getSettingKey(clientId, settingKey)] ?? false);

export const selectWorkspaceConfigurationSettingError = (
  clientId: string,
  settingKey: WorkspaceConfigurationSettingKey,
) => createSelector(selectWorkspaceConfigErrors, (errors) => errors[getSettingKey(clientId, settingKey)] ?? null);

export const selectWorkspaceConfigurationMutationInProgress = (clientId: string) =>
  createSelector(
    selectWorkspaceConfigSaving,
    selectWorkspaceConfigDeleting,
    (saving, deleting) =>
      Object.entries(saving).some(([key, isSaving]) => key.startsWith(`${clientId}:`) && isSaving) ||
      Object.entries(deleting).some(([key, isDeleting]) => key.startsWith(`${clientId}:`) && isDeleting),
  );
