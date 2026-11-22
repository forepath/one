import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import type { SettingsTarget } from '../../types/settings.types';

import {
  clearAdminSettingError,
  loadAdminSettings,
  resetAdminSetting,
  saveAdminSetting,
} from './admin-settings.actions';
import {
  selectAdminSettingsError,
  selectAdminSettingsErrors,
  selectAdminSettingsLoading,
  selectAdminSettingsOverview,
  selectAdminSettingsPendingKeys,
  selectAdminSettingsTarget,
} from './admin-settings.selectors';

@Injectable({
  providedIn: 'root',
})
export class AdminSettingsFacade {
  private readonly store = inject(Store);

  readonly overview$ = this.store.select(selectAdminSettingsOverview);
  readonly target$ = this.store.select(selectAdminSettingsTarget);
  readonly loading$ = this.store.select(selectAdminSettingsLoading);
  readonly error$ = this.store.select(selectAdminSettingsError);
  readonly pendingKeys$ = this.store.select(selectAdminSettingsPendingKeys);
  readonly settingErrors$ = this.store.select(selectAdminSettingsErrors);

  load(target?: SettingsTarget | null): void {
    this.store.dispatch(loadAdminSettings({ target }));
  }

  save(key: string, value: string): void {
    this.store.dispatch(saveAdminSetting({ key, value }));
  }

  reset(key: string): void {
    this.store.dispatch(resetAdminSetting({ key }));
  }

  clearError(key: string): void {
    this.store.dispatch(clearAdminSettingError({ key }));
  }
}
