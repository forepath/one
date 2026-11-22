/** Mirrors `@forepath/shared/backend/util-settings-overrides` view types. */
export type SettingValueType =
  | 'string'
  | 'text'
  | 'secret'
  | 'boolean'
  | 'integer'
  | 'number'
  | 'enum'
  | 'url'
  | 'email'
  | 'cron'
  | 'timezone'
  | 'duration'
  | 'list';

export type SettingScope = 'global' | 'tenant';
export type SettingsLevel = 'global' | 'tenant';
export type SettingValueSource = 'tenant' | 'global' | 'environment' | 'default';

export interface SettingStateView {
  key: string;
  category: string;
  type: SettingValueType;
  scope: SettingScope;
  sensitive: boolean;
  restartRequired: boolean;
  options?: string[];
  min?: number;
  max?: number;
  defaultValue?: string;
  value: string | null;
  hasOverride: boolean;
  inheritedValue: string | null;
  hasInheritedValue: boolean;
  inheritedSource: Exclude<SettingValueSource, 'tenant'>;
  effectiveSource: SettingValueSource;
}

export interface SettingsOverviewResponse {
  level: SettingsLevel;
  tenantId: string | null;
  homeTenantId: string | null;
  canManageGlobal: boolean;
  viewableTenants: string[];
  categories: string[];
  settings: SettingStateView[];
}

/** Level / tenant a request targets (`tenantId` omitted = own tenant). */
export interface SettingsTarget {
  level: SettingsLevel;
  tenantId?: string | null;
}
