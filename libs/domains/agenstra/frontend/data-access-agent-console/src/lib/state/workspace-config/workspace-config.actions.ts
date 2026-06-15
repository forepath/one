import { createAction, props } from '@ngrx/store';

import type {
  UpsertWorkspaceConfigurationOverrideDto,
  WorkspaceConfigurationSettingResponseDto,
  WorkspaceConfigurationSettingKey,
} from './workspace-config.types';

export const loadWorkspaceConfigurationOverrides = createAction(
  '[Workspace Config] Load Overrides',
  props<{ clientId: string; silent?: boolean }>(),
);

export const loadWorkspaceConfigurationOverridesSuccess = createAction(
  '[Workspace Config] Load Overrides Success',
  props<{ clientId: string; settings: WorkspaceConfigurationSettingResponseDto[] }>(),
);

export const loadWorkspaceConfigurationOverridesFailure = createAction(
  '[Workspace Config] Load Overrides Failure',
  props<{ clientId: string; error: string }>(),
);

export const upsertWorkspaceConfigurationOverride = createAction(
  '[Workspace Config] Upsert Override',
  props<{
    clientId: string;
    settingKey: WorkspaceConfigurationSettingKey;
    dto: UpsertWorkspaceConfigurationOverrideDto;
  }>(),
);

export const upsertWorkspaceConfigurationOverrideSuccess = createAction(
  '[Workspace Config] Upsert Override Success',
  props<{ clientId: string; setting: WorkspaceConfigurationSettingResponseDto }>(),
);

export const upsertWorkspaceConfigurationOverrideFailure = createAction(
  '[Workspace Config] Upsert Override Failure',
  props<{ clientId: string; settingKey: WorkspaceConfigurationSettingKey; error: string }>(),
);

export const deleteWorkspaceConfigurationOverride = createAction(
  '[Workspace Config] Delete Override',
  props<{ clientId: string; settingKey: WorkspaceConfigurationSettingKey }>(),
);

export const deleteWorkspaceConfigurationOverrideSuccess = createAction(
  '[Workspace Config] Delete Override Success',
  props<{ clientId: string; settingKey: WorkspaceConfigurationSettingKey }>(),
);

export const deleteWorkspaceConfigurationOverrideFailure = createAction(
  '[Workspace Config] Delete Override Failure',
  props<{ clientId: string; settingKey: WorkspaceConfigurationSettingKey; error: string }>(),
);

export const clearWorkspaceConfigurationOverrides = createAction(
  '[Workspace Config] Clear Overrides',
  props<{ clientId: string }>(),
);
