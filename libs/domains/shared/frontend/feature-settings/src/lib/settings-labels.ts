import { InjectionToken } from '@angular/core';

export interface SettingsCategoryLabel {
  label: string;
  /** Sidebar section the category is grouped under. */
  section?: string;
  icon?: string;
}

export interface SettingLabel {
  title: string;
  description?: string;
}

/**
 * Localized labels of one backend's settings catalog, provided by the consuming application.
 * Settings without a label fall back to their environment variable name.
 */
export interface SettingsAdminLabels {
  categories: Record<string, SettingsCategoryLabel>;
  settings: Record<string, SettingLabel>;
}

export const SETTINGS_ADMIN_LABELS = new InjectionToken<SettingsAdminLabels>('SettingsAdminLabels');
