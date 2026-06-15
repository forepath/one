import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  clearWorkspaceConfigurationOverrides,
  deleteWorkspaceConfigurationOverride,
  loadWorkspaceConfigurationOverrides,
  upsertWorkspaceConfigurationOverride,
} from './workspace-config.actions';
import {
  selectWorkspaceConfigurationError,
  selectWorkspaceConfigurationMutationInProgress,
  selectWorkspaceConfigurationLoading,
  selectWorkspaceConfigurationSettingDeleting,
  selectWorkspaceConfigurationSettingError,
  selectWorkspaceConfigurationSettings,
  selectWorkspaceConfigurationSettingSaving,
} from './workspace-config.selectors';
import type {
  WorkspaceConfigurationSettingKey,
  WorkspaceConfigurationSettingResponseDto,
} from './workspace-config.types';

@Injectable({
  providedIn: 'root',
})
export class WorkspaceConfigFacade {
  private readonly store = inject(Store);

  getSettings$(clientId: string): Observable<WorkspaceConfigurationSettingResponseDto[]> {
    return this.store.select(selectWorkspaceConfigurationSettings(clientId));
  }

  getLoading$(clientId: string): Observable<boolean> {
    return this.store.select(selectWorkspaceConfigurationLoading(clientId));
  }

  getError$(clientId: string): Observable<string | null> {
    return this.store.select(selectWorkspaceConfigurationError(clientId));
  }

  isSavingSetting$(clientId: string, settingKey: WorkspaceConfigurationSettingKey): Observable<boolean> {
    return this.store.select(selectWorkspaceConfigurationSettingSaving(clientId, settingKey));
  }

  isDeletingSetting$(clientId: string, settingKey: WorkspaceConfigurationSettingKey): Observable<boolean> {
    return this.store.select(selectWorkspaceConfigurationSettingDeleting(clientId, settingKey));
  }

  isMutationInProgress$(clientId: string): Observable<boolean> {
    return this.store.select(selectWorkspaceConfigurationMutationInProgress(clientId));
  }

  getSettingError$(clientId: string, settingKey: WorkspaceConfigurationSettingKey): Observable<string | null> {
    return this.store.select(selectWorkspaceConfigurationSettingError(clientId, settingKey));
  }

  loadSettings(clientId: string): void {
    this.store.dispatch(loadWorkspaceConfigurationOverrides({ clientId }));
  }

  upsertSetting(clientId: string, settingKey: WorkspaceConfigurationSettingKey, value: string): void {
    this.store.dispatch(upsertWorkspaceConfigurationOverride({ clientId, settingKey, dto: { value } }));
  }

  deleteSettingOverride(clientId: string, settingKey: WorkspaceConfigurationSettingKey): void {
    this.store.dispatch(deleteWorkspaceConfigurationOverride({ clientId, settingKey }));
  }

  clearSettings(clientId: string): void {
    this.store.dispatch(clearWorkspaceConfigurationOverrides({ clientId }));
  }
}
