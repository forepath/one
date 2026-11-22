/**
 * Value kinds a setting may hold. They drive validation on write and the input widget in the consoles.
 * - `secret`: write-only; values are never returned by the API.
 * - `text`: multi-line string (newlines allowed).
 * - `duration`: interval such as `60000`, `30s`, `15m`, `1h`, `1d` (job registries accept these suffixes).
 * - `list`: comma-separated values.
 */
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

/**
 * `global`: overridable deployment-wide only.
 * `tenant`: overridable deployment-wide and per tenant (tenant override wins). Only settings that are read per
 * request / job inside the tenant context may use this scope.
 */
export type SettingScope = 'global' | 'tenant';

export interface SettingDefinition {
  /** Environment variable name the override replaces. */
  key: string;
  /** Category id (sidebar entry in the console). */
  category: string;
  type: SettingValueType;
  scope: SettingScope;
  /** Read once at startup: an override applies after the next restart of the backend processes. */
  restartRequired?: boolean;
  /** Allowed values for `enum`. */
  options?: readonly string[];
  /** Inclusive bounds for `integer` / `number`. */
  min?: number;
  max?: number;
  /** Documented fallback used by the code when neither override nor environment variable is set (display only). */
  defaultValue?: string;
  /** Maximum stored length (defaults: 2048, `text` 16384). */
  maxLength?: number;
  /** `url`: require `https:` (default `false`, then `http:` is accepted as well). */
  httpsOnly?: boolean;
  /** Regular expression a non-empty value must match (anchored by the author). */
  pattern?: string;
}

/** Scope key of deployment-wide overrides (tenant ids never start with `_`). */
export const GLOBAL_SETTINGS_SCOPE = '__global__';

export interface SettingsOverrideRecord {
  /** {@link GLOBAL_SETTINGS_SCOPE} or a tenant id. */
  scopeKey: string;
  settingKey: string;
  value: string;
}

/** Where the effective value comes from (highest specificity first). */
export type SettingValueSource = 'tenant' | 'global' | 'environment' | 'default';

/** Level a console views / edits: deployment-wide or one tenant. */
export type SettingsLevel = 'global' | 'tenant';

/**
 * One setting as seen from a level. Values of sensitive settings are never returned (`null`), only whether
 * they are configured.
 */
export interface SettingStateView {
  key: string;
  category: string;
  type: SettingValueType;
  scope: SettingScope;
  sensitive: boolean;
  restartRequired: boolean;
  options?: readonly string[];
  min?: number;
  max?: number;
  defaultValue?: string;
  /** Override stored at the viewed level. */
  value: string | null;
  hasOverride: boolean;
  /** Value that applies when the override of the viewed level is reset. */
  inheritedValue: string | null;
  hasInheritedValue: boolean;
  inheritedSource: Exclude<SettingValueSource, 'tenant'>;
  effectiveSource: SettingValueSource;
}

/** `GET …/settings` response shared by both backends. */
export interface SettingsOverviewResponse {
  /** Level the `settings` are described from. */
  level: SettingsLevel;
  /** Tenant the view refers to (`null` for the global level). */
  tenantId: string | null;
  /** Tenant of the caller (`null` without tenants). */
  homeTenantId: string | null;
  /** Whether the caller may view and edit the deployment-wide level. */
  canManageGlobal: boolean;
  /** Tenants the caller may configure (empty without tenants). */
  viewableTenants: string[];
  /** Category ids in display order. */
  categories: string[];
  settings: SettingStateView[];
}
