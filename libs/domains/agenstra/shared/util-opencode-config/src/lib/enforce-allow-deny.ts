import { isMcpServerAllowed, resolveMcpAllowDenyIdentity } from '@forepath/agenstra/shared/util-opencode-mcp-servers';
import {
  isModelRefAllowed,
  isProviderAllowed,
  parseProviderModelRef,
} from '@forepath/agenstra/shared/util-opencode-providers';

import { migrateConfigV1ToV2 } from './migrate-v1-to-v2';
import { INHERITED_MAP_ENTRY_OVERRIDE_KEYS, type InheritedAdditiveEntry, type JsonObject } from './types';

export interface EnforceAllowDenyContext {
  mcpAllow: readonly string[];
  mcpDeny: readonly string[];
  enabledProviders: readonly string[];
  disabledProviders: readonly string[];
  modelAllow: readonly string[];
  modelDeny: readonly string[];
  inheritedMcpServerKeys: readonly string[];
  inheritedProviderKeys: readonly string[];
  /** Effective `mcp.servers` map (for inherited identity / registry resolution). */
  effectiveMcpServers?: JsonObject | null;
}

export interface EnforceAllowDenyOptions {
  /**
   * When true, write `{ disabled: true }` stubs for inherited keys that are prohibited
   * even if this overlay does not already mention them. Use for the primary `config`
   * document so PUT persists the disable.
   */
  seedMissingInheritedDisables?: boolean;
  /**
   * Only ensure inherited disable stubs. Do not delete local map entries or clear
   * model lists / default models. Used when hydrating the editor so owning-layer
   * values stay pre-filled until the user edits allow/deny or saves.
   */
  seedInheritedDisablesOnly?: boolean;
  /** Skip mutating `mcp.servers` (e.g. map root locked). */
  skipMcpServers?: boolean;
  /** Skip mutating `providers`. */
  skipProviders?: boolean;
  /** Skip filtering `model_allow` / `model_deny`. */
  skipModelLists?: boolean;
  /** Skip clearing `model` / `small_model`. */
  skipDefaultModels?: boolean;
}

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringList(config: JsonObject, key: string): string[] {
  const value = config[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function inheritedKeysForPath(inheritedAdditive: readonly InheritedAdditiveEntry[], path: string): string[] {
  const normalized = path.startsWith('/') ? path : `/${path}`;

  return inheritedAdditive.find((entry) => entry.path === normalized)?.keys ?? [];
}

function readMcpServers(config: JsonObject): JsonObject | null {
  if (!isPlainObject(config['mcp'])) {
    return null;
  }

  const mcp = config['mcp'] as JsonObject;

  return isPlainObject(mcp['servers']) ? (mcp['servers'] as JsonObject) : null;
}

/** True when an overlay entry is only `disabled` / `hidden` (inherited override stub). */
export function isInheritedMapOverrideStub(entry: unknown): boolean {
  if (!isPlainObject(entry)) {
    return false;
  }

  const keys = Object.keys(entry);

  if (keys.length === 0) {
    return false;
  }

  return keys.every((key) => (INHERITED_MAP_ENTRY_OVERRIDE_KEYS as readonly string[]).includes(key));
}

function inheritedOverrideStub(entry: JsonObject | null | undefined, disabled: boolean): JsonObject | undefined {
  const next: JsonObject = {};

  if (entry) {
    for (const key of INHERITED_MAP_ENTRY_OVERRIDE_KEYS) {
      if (entry[key] !== undefined) {
        next[key] = entry[key];
      }
    }
  }

  if (disabled) {
    next['disabled'] = true;
  } else {
    delete next['disabled'];
  }

  return Object.keys(next).length ? next : undefined;
}

/**
 * Build allow/deny enforcement context from an effective (merged) config plus inherited keys.
 */
export function buildAllowDenyContext(
  effectiveConfig: JsonObject | null | undefined,
  inheritedAdditive: readonly InheritedAdditiveEntry[] = [],
): EnforceAllowDenyContext {
  const effective = migrateConfigV1ToV2(effectiveConfig ?? {});

  return {
    mcpAllow: stringList(effective, 'mcp_allow'),
    mcpDeny: stringList(effective, 'mcp_deny'),
    enabledProviders: stringList(effective, 'enabled_providers'),
    disabledProviders: stringList(effective, 'disabled_providers'),
    modelAllow: stringList(effective, 'model_allow'),
    modelDeny: stringList(effective, 'model_deny'),
    inheritedMcpServerKeys: inheritedKeysForPath(inheritedAdditive, '/mcp/servers'),
    inheritedProviderKeys: inheritedKeysForPath(inheritedAdditive, '/providers'),
    effectiveMcpServers: readMcpServers(effective),
  };
}

function enforceMcpServersMap(
  servers: JsonObject,
  context: EnforceAllowDenyContext,
  seedMissingInheritedDisables: boolean,
  deleteLocalProhibited: boolean,
): JsonObject | undefined {
  const inherited = new Set(context.inheritedMcpServerKeys);
  const next: JsonObject = { ...servers };
  const effectiveServers = context.effectiveMcpServers ?? {};
  const stubKeys: string[] = [];

  for (const key of Object.keys(next)) {
    const entry = isPlainObject(next[key]) ? (next[key] as JsonObject) : null;
    const treatAsInherited = inherited.has(key) || isInheritedMapOverrideStub(entry);

    if (treatAsInherited) {
      stubKeys.push(key);
      continue;
    }

    if (!deleteLocalProhibited) {
      continue;
    }

    const identity = resolveMcpAllowDenyIdentity(key, entry, context.mcpAllow, context.mcpDeny);

    if (!isMcpServerAllowed(identity, context.mcpAllow, context.mcpDeny)) {
      delete next[key];
    }
  }

  const inheritedOrStubKeys = new Set([...inherited, ...stubKeys]);

  for (const key of inheritedOrStubKeys) {
    const localEntry = isPlainObject(next[key]) ? (next[key] as JsonObject) : null;
    const effectiveEntry = isPlainObject(effectiveServers[key]) ? (effectiveServers[key] as JsonObject) : null;
    const identitySource =
      localEntry && typeof localEntry['registry'] === 'string' ? localEntry : (effectiveEntry ?? localEntry);
    const identity = resolveMcpAllowDenyIdentity(key, identitySource, context.mcpAllow, context.mcpDeny);
    const allowed = isMcpServerAllowed(identity, context.mcpAllow, context.mcpDeny);

    if (allowed) {
      continue;
    }

    if (localEntry) {
      // Never delete override stubs — force disabled regardless of checkbox / prior value.
      next[key] = inheritedOverrideStub(localEntry, true)!;
      continue;
    }

    if (seedMissingInheritedDisables && inherited.has(key)) {
      next[key] = { disabled: true };
    }
  }

  return Object.keys(next).length ? next : undefined;
}

function enforceProvidersMap(
  providers: JsonObject,
  context: EnforceAllowDenyContext,
  seedMissingInheritedDisables: boolean,
  deleteLocalProhibited: boolean,
): JsonObject | undefined {
  const inherited = new Set(context.inheritedProviderKeys);
  const next: JsonObject = { ...providers };
  const stubKeys: string[] = [];

  for (const key of Object.keys(next)) {
    const entry = isPlainObject(next[key]) ? (next[key] as JsonObject) : null;
    const treatAsInherited = inherited.has(key) || isInheritedMapOverrideStub(entry);

    if (treatAsInherited) {
      stubKeys.push(key);
      continue;
    }

    if (!deleteLocalProhibited) {
      continue;
    }

    if (!isProviderAllowed(key, context.enabledProviders, context.disabledProviders)) {
      delete next[key];
    }
  }

  const inheritedOrStubKeys = new Set([...inherited, ...stubKeys]);

  for (const key of inheritedOrStubKeys) {
    const localEntry = isPlainObject(next[key]) ? (next[key] as JsonObject) : null;
    const allowed = isProviderAllowed(key, context.enabledProviders, context.disabledProviders);

    if (allowed) {
      continue;
    }

    if (localEntry) {
      next[key] = inheritedOverrideStub(localEntry, true)!;
      continue;
    }

    if (seedMissingInheritedDisables && inherited.has(key)) {
      next[key] = { disabled: true };
    }
  }

  return Object.keys(next).length ? next : undefined;
}

function filterModelRefList(refs: readonly string[], context: EnforceAllowDenyContext): string[] | undefined {
  const next = refs.filter((ref) => {
    const parsed = parseProviderModelRef(ref);

    return !!parsed && isProviderAllowed(parsed.providerId, context.enabledProviders, context.disabledProviders);
  });

  return next.length ? next : undefined;
}

/**
 * Force overlay entries to respect effective allow/deny lists.
 *
 * - Local (non-inherited) `mcp.servers` / `providers` keys that are prohibited are **deleted**
 *   (unless `seedInheritedDisablesOnly`).
 * - Inherited keys / override stubs that are prohibited get `{ disabled: true }` (checkbox cannot override).
 * - `model_allow` / `model_deny` drop refs whose provider is outside provider allow/deny.
 * - `model` / `small_model` are cleared when outside provider or model allow/deny.
 *
 * Does not strip the allow/deny list keys themselves (those remain for UI / heredity).
 */
export function enforceAllowDenyOnOverlay(
  overlay: JsonObject | null | undefined,
  context: EnforceAllowDenyContext,
  options: EnforceAllowDenyOptions = {},
): JsonObject {
  const seedMissingInheritedDisables = options.seedMissingInheritedDisables === true;
  const seedInheritedDisablesOnly = options.seedInheritedDisablesOnly === true;
  const deleteLocalProhibited = !seedInheritedDisablesOnly;
  const config = migrateConfigV1ToV2(overlay ?? {});

  if (!options.skipMcpServers) {
    if (isPlainObject(config['mcp'])) {
      const mcp = { ...(config['mcp'] as JsonObject) };
      const servers = isPlainObject(mcp['servers']) ? (mcp['servers'] as JsonObject) : null;

      if (servers) {
        const nextServers = enforceMcpServersMap(servers, context, seedMissingInheritedDisables, deleteLocalProhibited);

        if (nextServers) {
          mcp['servers'] = nextServers;
        } else {
          delete mcp['servers'];
        }
      }

      if (Object.keys(mcp).length > 0) {
        config['mcp'] = mcp;
      } else {
        delete config['mcp'];
      }
    } else if (seedMissingInheritedDisables && context.inheritedMcpServerKeys.length > 0) {
      const seeded = enforceMcpServersMap({}, context, true, deleteLocalProhibited);

      if (seeded) {
        config['mcp'] = { servers: seeded };
      }
    }
  }

  if (!options.skipProviders) {
    if (isPlainObject(config['providers'])) {
      const nextProviders = enforceProvidersMap(
        config['providers'] as JsonObject,
        context,
        seedMissingInheritedDisables,
        deleteLocalProhibited,
      );

      if (nextProviders) {
        config['providers'] = nextProviders;
      } else {
        delete config['providers'];
      }
    } else if (seedMissingInheritedDisables && context.inheritedProviderKeys.length > 0) {
      const seeded = enforceProvidersMap({}, context, true, deleteLocalProhibited);

      if (seeded) {
        config['providers'] = seeded;
      }
    }
  }

  if (!options.skipModelLists && !seedInheritedDisablesOnly) {
    for (const path of ['model_allow', 'model_deny'] as const) {
      if (!(path in config)) {
        continue;
      }

      const current = stringList(config, path);
      const filtered = filterModelRefList(current, context);

      if (filtered) {
        config[path] = filtered;
      } else {
        delete config[path];
      }
    }
  }

  if (!options.skipDefaultModels && !seedInheritedDisablesOnly) {
    for (const path of ['model', 'small_model'] as const) {
      if (typeof config[path] !== 'string') {
        continue;
      }

      const value = (config[path] as string).trim();

      if (!value) {
        delete config[path];
        continue;
      }

      if (
        !isModelRefAllowed(
          value,
          context.enabledProviders,
          context.disabledProviders,
          context.modelAllow,
          context.modelDeny,
        )
      ) {
        delete config[path];
      }
    }
  }

  return config;
}
