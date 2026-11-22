import { InjectionToken } from '@angular/core';

/**
 * Minimal environment required by the shared settings admin feature.
 * Consuming applications provide a value mapped from their full environment.
 */
export interface SettingsAdminEnvironment {
  /** Base REST API URL (no trailing slash). */
  apiUrl: string;
  /** Path segment appended to apiUrl for settings endpoints (e.g. "admin/settings"). */
  settingsBasePath: string;
}

export const SETTINGS_ADMIN_ENVIRONMENT = new InjectionToken<SettingsAdminEnvironment>('SettingsAdminEnvironment');
