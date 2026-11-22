import { createAction, props } from '@ngrx/store';

import type { SettingStateView, SettingsOverviewResponse, SettingsTarget } from '../../types/settings.types';

/** `target` omitted: the backend default (all tenants for global-view tenants, else the own tenant). */
export const loadAdminSettings = createAction('[Admin Settings] Load', props<{ target?: SettingsTarget | null }>());

export const loadAdminSettingsSuccess = createAction(
  '[Admin Settings] Load Success',
  props<{ overview: SettingsOverviewResponse }>(),
);

export const loadAdminSettingsFailure = createAction('[Admin Settings] Load Failure', props<{ error: string }>());

export const saveAdminSetting = createAction('[Admin Settings] Save', props<{ key: string; value: string }>());

export const saveAdminSettingSuccess = createAction(
  '[Admin Settings] Save Success',
  props<{ setting: SettingStateView }>(),
);

export const saveAdminSettingFailure = createAction(
  '[Admin Settings] Save Failure',
  props<{ key: string; error: string }>(),
);

export const resetAdminSetting = createAction('[Admin Settings] Reset', props<{ key: string }>());

export const resetAdminSettingSuccess = createAction(
  '[Admin Settings] Reset Success',
  props<{ setting: SettingStateView }>(),
);

export const resetAdminSettingFailure = createAction(
  '[Admin Settings] Reset Failure',
  props<{ key: string; error: string }>(),
);

export const clearAdminSettingError = createAction('[Admin Settings] Clear Error', props<{ key: string }>());
