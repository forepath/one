import { getTenantId } from '@forepath/shared/backend/util-http-context';

import {
  GLOBAL_SETTINGS_SCOPE,
  SettingDefinition,
  SettingsLevel,
  SettingsOverrideRecord,
  SettingStateView,
  SettingValueSource,
} from './setting-definition.types';
import { isSensitiveSetting } from './setting-value.validation';

/**
 * Process-wide registry of settings overrides (stored in the database, loaded by the backend).
 *
 * Resolution order (highest specificity first): tenant override → global override → environment variable.
 * Once {@link installSettingsOverridesEnv} ran, `process.env` reads of registered keys resolve through this
 * order, using the tenant bound to the current async context (`runWithTenantId`). Code that resolves for an
 * explicit tenant uses {@link resolveSettingValue}. The original environment is never mutated, so removing
 * an override lets the environment variable apply again.
 */
interface RegistryState {
  definitions: Map<string, SettingDefinition>;
  global: Map<string, string>;
  tenants: Map<string, Map<string, string>>;
  version: number;
  baseEnv: NodeJS.ProcessEnv;
  installed: boolean;
}

const state: RegistryState = {
  definitions: new Map(),
  global: new Map(),
  tenants: new Map(),
  version: 0,
  baseEnv: process.env,
  installed: false,
};

export function registerSettingDefinitions(definitions: readonly SettingDefinition[]): void {
  for (const definition of definitions) {
    state.definitions.set(definition.key, definition);
  }

  state.version++;
}

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return state.definitions.get(key);
}

/** Bumped on every change; lets services that derive state from settings cache per version. */
export function getSettingsOverridesVersion(): number {
  return state.version;
}

function isTenantScope(scopeKey: string): boolean {
  return scopeKey !== GLOBAL_SETTINGS_SCOPE;
}

function accepts(scopeKey: string, settingKey: string): boolean {
  const definition = state.definitions.get(settingKey);

  if (!definition) {
    return false;
  }

  return !isTenantScope(scopeKey) || definition.scope === 'tenant';
}

/** Replaces all overrides (initial load and periodic refresh). Unknown keys / scopes are ignored. */
export function replaceSettingsOverrides(records: readonly SettingsOverrideRecord[]): void {
  const global = new Map<string, string>();
  const tenants = new Map<string, Map<string, string>>();

  for (const record of records) {
    if (!accepts(record.scopeKey, record.settingKey) || typeof record.value !== 'string') {
      continue;
    }

    if (!isTenantScope(record.scopeKey)) {
      global.set(record.settingKey, record.value);
      continue;
    }

    let tenant = tenants.get(record.scopeKey);

    if (!tenant) {
      tenant = new Map();
      tenants.set(record.scopeKey, tenant);
    }

    tenant.set(record.settingKey, record.value);
  }

  if (!sameOverrides(global, tenants)) {
    state.global = global;
    state.tenants = tenants;
    state.version++;
  }
}

function sameMap(a: Map<string, string> | undefined, b: Map<string, string> | undefined): boolean {
  if ((a?.size ?? 0) !== (b?.size ?? 0)) {
    return false;
  }

  for (const [key, value] of a ?? []) {
    if (b?.get(key) !== value) {
      return false;
    }
  }

  return true;
}

function sameOverrides(global: Map<string, string>, tenants: Map<string, Map<string, string>>): boolean {
  if (!sameMap(global, state.global) || tenants.size !== state.tenants.size) {
    return false;
  }

  for (const [scopeKey, values] of tenants) {
    if (!sameMap(values, state.tenants.get(scopeKey))) {
      return false;
    }
  }

  return true;
}

export function setSettingsOverride(scopeKey: string, settingKey: string, value: string): void {
  if (!accepts(scopeKey, settingKey)) {
    return;
  }

  if (!isTenantScope(scopeKey)) {
    state.global.set(settingKey, value);
  } else {
    let tenant = state.tenants.get(scopeKey);

    if (!tenant) {
      tenant = new Map();
      state.tenants.set(scopeKey, tenant);
    }

    tenant.set(settingKey, value);
  }

  state.version++;
}

export function removeSettingsOverride(scopeKey: string, settingKey: string): void {
  const removed = !isTenantScope(scopeKey)
    ? state.global.delete(settingKey)
    : (state.tenants.get(scopeKey)?.delete(settingKey) ?? false);

  if (removed) {
    state.version++;
  }
}

/** Value of the environment variable itself (ignores overrides). */
export function getEnvironmentSettingValue(key: string): string | undefined {
  return Reflect.get(state.installed ? state.baseEnv : process.env, key) as string | undefined;
}

function resolveOverride(key: string, tenantId: string | undefined): string | undefined {
  const definition = state.definitions.get(key);

  if (!definition) {
    return undefined;
  }

  if (tenantId && definition.scope === 'tenant') {
    const tenantValue = state.tenants.get(tenantId)?.get(key);

    if (tenantValue !== undefined) {
      return tenantValue;
    }
  }

  return state.global.get(key);
}

/** Effective value for `tenantId` (defaults to the tenant of the current async context). */
export function resolveSettingValue(key: string, tenantId: string | undefined = getTenantId()): string | undefined {
  return resolveOverride(key, tenantId) ?? getEnvironmentSettingValue(key);
}

export function resolveSettingSource(key: string, tenantId: string | undefined = getTenantId()): SettingValueSource {
  const definition = state.definitions.get(key);

  if (tenantId && definition?.scope === 'tenant' && state.tenants.get(tenantId)?.has(key)) {
    return 'tenant';
  }

  if (definition && state.global.has(key)) {
    return 'global';
  }

  return getEnvironmentSettingValue(key) !== undefined ? 'environment' : 'default';
}

/**
 * Lets `process.env` reads of registered keys resolve through the overrides. Idempotent.
 * Writes and deletes still reach the original environment object.
 */
export function installSettingsOverridesEnv(): void {
  if (state.installed) {
    return;
  }

  const target = process.env;

  state.baseEnv = target;
  state.installed = true;

  const overrideFor = (prop: string | symbol): string | undefined =>
    typeof prop === 'string' ? resolveOverride(prop, getTenantId()) : undefined;

  process.env = new Proxy(target, {
    get(envTarget, prop, receiver) {
      return overrideFor(prop) ?? Reflect.get(envTarget, prop, receiver);
    },
    has(envTarget, prop) {
      return overrideFor(prop) !== undefined || Reflect.has(envTarget, prop);
    },
    ownKeys(envTarget) {
      const keys = new Set<string | symbol>(Reflect.ownKeys(envTarget));
      const tenantId = getTenantId();

      for (const key of state.definitions.keys()) {
        if (resolveOverride(key, tenantId) !== undefined) {
          keys.add(key);
        }
      }

      return [...keys];
    },
    getOwnPropertyDescriptor(envTarget, prop) {
      const override = overrideFor(prop);

      if (override !== undefined) {
        return { value: override, writable: true, enumerable: true, configurable: true };
      }

      return Reflect.getOwnPropertyDescriptor(envTarget, prop);
    },
  });
}

/**
 * Describes `definitions` from one level. `tenantId` is required for the tenant level.
 * Sensitive values are never included.
 */
export interface DescribeSettingsOptions {
  /**
   * Include inherited (all tenants / environment) values. `false` for callers that may not see the deployment's
   * configuration (tenant admins without global access): they only learn whether something is configured.
   */
  revealInherited?: boolean;
}

export function describeSettings(
  definitions: readonly SettingDefinition[],
  level: SettingsLevel,
  tenantId?: string,
  options: DescribeSettingsOptions = {},
): SettingStateView[] {
  const revealInherited = options.revealInherited ?? true;

  return definitions
    .filter((definition) => level === 'global' || definition.scope === 'tenant')
    .map((definition) => {
      const key = definition.key;
      const sensitive = isSensitiveSetting(definition);
      const globalValue = state.global.get(key);
      const environmentValue = getEnvironmentSettingValue(key);
      const tenantValue = level === 'tenant' && tenantId ? state.tenants.get(tenantId)?.get(key) : undefined;
      const ownValue = level === 'global' ? globalValue : tenantValue;
      const inheritedRaw = level === 'global' ? environmentValue : (globalValue ?? environmentValue);
      let inheritedSource: SettingStateView['inheritedSource'] = 'default';

      if (level === 'tenant' && globalValue !== undefined) {
        inheritedSource = 'global';
      } else if (environmentValue !== undefined) {
        inheritedSource = 'environment';
      }

      let effectiveSource: SettingValueSource = inheritedSource;

      if (ownValue !== undefined) {
        effectiveSource = level === 'global' ? 'global' : 'tenant';
      }

      return {
        key,
        category: definition.category,
        type: definition.type,
        scope: definition.scope,
        sensitive,
        restartRequired: definition.restartRequired ?? false,
        ...(definition.options ? { options: definition.options } : {}),
        ...(definition.min !== undefined ? { min: definition.min } : {}),
        ...(definition.max !== undefined ? { max: definition.max } : {}),
        ...(definition.defaultValue !== undefined ? { defaultValue: definition.defaultValue } : {}),
        value: sensitive || ownValue === undefined ? null : ownValue,
        hasOverride: ownValue !== undefined,
        inheritedValue: sensitive || !revealInherited || inheritedRaw === undefined ? null : inheritedRaw,
        hasInheritedValue: inheritedRaw !== undefined && inheritedRaw !== '',
        inheritedSource,
        effectiveSource,
      };
    });
}

/** Test helper: clears definitions and overrides (does not uninstall the env proxy). */
export function resetSettingsOverridesRegistryForTests(): void {
  state.definitions = new Map();
  state.global = new Map();
  state.tenants = new Map();
  state.version++;
}

/** Tenant override stored for `tenantId` (ignores the global layer and the environment). */
export function getTenantSettingOverride(key: string, tenantId: string): string | undefined {
  return state.definitions.get(key)?.scope === 'tenant' ? state.tenants.get(tenantId)?.get(key) : undefined;
}

/**
 * Memoizes a value derived from settings per tenant (current async context) and settings version, so services
 * that parse their configuration once stay cheap while still following overrides.
 */
export function createSettingsScopedCache<T>(compute: () => T): { get(): T; clear(): void } {
  const entries = new Map<string, T>();
  let cachedVersion = -1;

  return {
    get(): T {
      if (cachedVersion !== state.version) {
        entries.clear();
        cachedVersion = state.version;
      }

      const cacheKey = getTenantId() ?? '';

      if (!entries.has(cacheKey)) {
        entries.set(cacheKey, compute());
      }

      return entries.get(cacheKey) as T;
    },
    clear(): void {
      entries.clear();
    },
  };
}
