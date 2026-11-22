import { CanActivateFn, Route } from '@angular/router';
import {
  adminSettingsReducer,
  loadAdminSettings$,
  resetAdminSetting$,
  saveAdminSetting$,
} from '@forepath/shared/frontend/data-access-settings';
import { buildPageTitle } from '@forepath/shared/frontend/util-configuration';
import { provideEffects } from '@ngrx/effects';
import { provideState } from '@ngrx/store';

import { SettingsManagerComponent } from './settings-manager/settings-manager.component';

/**
 * Settings admin routes (console overrides of backend environment variables).
 *
 * The consuming application must provide `SETTINGS_ADMIN_ENVIRONMENT` and `SETTINGS_ADMIN_LABELS`, and register
 * {@link settingsAdminProviders}.
 */
export function createSettingsAdminRoutes(canActivate: CanActivateFn[], path = 'settings'): Route[] {
  return [
    {
      path,
      canActivate,
      component: SettingsManagerComponent,
      title: () => buildPageTitle($localize`:@@featureSettings-pageTitle:Settings`),
    },
  ];
}

/** NgRx providers for the shared settings admin state. */
export const settingsAdminProviders = [
  provideState('adminSettings', adminSettingsReducer),
  provideEffects({ loadAdminSettings$, saveAdminSetting$, resetAdminSetting$ }),
];
