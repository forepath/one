import {
  ARRAY_CONCAT_ROOT_KEYS,
  MAP_MERGE_ROOT_KEYS,
  REPLACE_LOCK_ROOT_KEYS,
  SCALAR_LOCK_ROOT_KEYS,
  type InheritedAdditiveEntry,
  type JsonObject,
} from './types';
import { migrateConfigV1ToV2 } from './migrate-v1-to-v2';

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeObjects(base: JsonObject, overlay: JsonObject): JsonObject {
  const result: JsonObject = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) {
      continue;
    }

    const existing = result[key];

    if (isPlainObject(value) && isPlainObject(existing)) {
      result[key] = deepMergeObjects(existing, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function mergeMapRoot(base: JsonObject, overlay: JsonObject): JsonObject {
  return deepMergeObjects(base, overlay);
}

function concatArrays(base: unknown, overlay: unknown): unknown[] {
  const left = Array.isArray(base) ? base : [];
  const right = Array.isArray(overlay) ? overlay : [];

  return [...left, ...right];
}

function mergeMcp(base: unknown, overlay: unknown): JsonObject {
  const left = isPlainObject(base) ? base : {};
  const right = isPlainObject(overlay) ? overlay : {};
  const result: JsonObject = { ...left };

  if (isPlainObject(right['timeout'])) {
    result['timeout'] = isPlainObject(left['timeout'])
      ? deepMergeObjects(left['timeout'], right['timeout'])
      : { ...right['timeout'] };
  }

  const leftServers = isPlainObject(left['servers']) ? left['servers'] : {};
  const rightServers = isPlainObject(right['servers']) ? right['servers'] : {};

  result['servers'] = mergeMapRoot(leftServers, rightServers);

  for (const [key, value] of Object.entries(right)) {
    if (key === 'timeout' || key === 'servers' || value === undefined) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

function mergeExperimental(base: unknown, overlay: unknown): JsonObject {
  // Parent (later layer) wins entirely for policies / security experimental flags.
  if (isPlainObject(overlay) && Object.keys(overlay).length > 0) {
    return structuredClone(overlay);
  }

  return isPlainObject(base) ? structuredClone(base) : {};
}

/**
 * Merge layers low → high (first is lowest precedence).
 * Typical call: mergeConfigs(agent, workspace, global).
 */
export function mergeConfigs(...layers: Array<JsonObject | null | undefined>): JsonObject {
  let result: JsonObject = {};

  for (const layer of layers) {
    if (!layer) {
      continue;
    }

    const normalized = migrateConfigV1ToV2(layer);
    const next: JsonObject = { ...result };

    for (const [key, value] of Object.entries(normalized)) {
      if (value === undefined) {
        continue;
      }

      if ((REPLACE_LOCK_ROOT_KEYS as readonly string[]).includes(key)) {
        if (key === 'experimental') {
          next[key] = mergeExperimental(result[key], value);
        } else {
          next[key] = structuredClone(value);
        }
        continue;
      }

      if ((ARRAY_CONCAT_ROOT_KEYS as readonly string[]).includes(key)) {
        next[key] = concatArrays(result[key], value);
        continue;
      }

      if ((MAP_MERGE_ROOT_KEYS as readonly string[]).includes(key)) {
        const base = isPlainObject(result[key]) ? (result[key] as JsonObject) : {};
        const overlay = isPlainObject(value) ? value : {};
        next[key] = mergeMapRoot(base, overlay);
        continue;
      }

      if (key === 'mcp') {
        next[key] = mergeMcp(result[key], value);
        continue;
      }

      if (key === 'formatter' && isPlainObject(value) && isPlainObject(result[key])) {
        next[key] = mergeMapRoot(result[key] as JsonObject, value);
        continue;
      }

      if (isPlainObject(value) && isPlainObject(result[key])) {
        next[key] = deepMergeObjects(result[key] as JsonObject, value);
      } else {
        next[key] = structuredClone(value);
      }
    }

    result = next;
  }

  return result;
}

/**
 * Compose a single layer's structured `config` with optional raw `overrides`.
 * Overrides win for the same keys (same merge rules as cross-layer merge).
 */
export function composeLayerOverlay(config?: JsonObject | null, overrides?: JsonObject | null): JsonObject {
  return mergeConfigs(config ?? {}, overrides ?? {});
}

export function mergeSecrets(...layers: Array<Record<string, string> | null | undefined>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const layer of layers) {
    if (!layer) {
      continue;
    }

    Object.assign(result, layer);
  }

  return result;
}

/**
 * Apply a secrets patch onto the current map.
 * - `undefined` → no change (caller should leave storage untouched)
 * - `null` → clear all secrets
 * - empty string values → delete those keys
 * - other string values → set / overwrite
 */
export function applySecretsPatch(
  current: Record<string, string>,
  patch: Record<string, string> | null | undefined,
): Record<string, string> | undefined {
  if (patch === undefined) {
    return undefined;
  }

  if (patch === null) {
    return {};
  }

  const next = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    if (value === '') {
      delete next[key];
    } else {
      next[key] = value;
    }
  }

  return next;
}

function pointer(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Compute locked paths and inherited additive entries from parent overlays
 * (higher layers only — not including the current layer).
 */
export function computeHeredityMetadata(...parents: Array<JsonObject | null | undefined>): {
  lockedPaths: string[];
  inheritedAdditive: InheritedAdditiveEntry[];
} {
  const locked = new Set<string>();
  const additiveByPath = new Map<string, InheritedAdditiveEntry>();

  const ensureAdditive = (path: string): InheritedAdditiveEntry => {
    const existing = additiveByPath.get(path);

    if (existing) {
      return existing;
    }

    const created: InheritedAdditiveEntry = { path };
    additiveByPath.set(path, created);

    return created;
  };

  for (const parent of parents) {
    if (!parent) {
      continue;
    }

    const normalized = migrateConfigV1ToV2(parent);

    for (const key of Object.keys(normalized)) {
      if ((REPLACE_LOCK_ROOT_KEYS as readonly string[]).includes(key)) {
        locked.add(pointer(key));

        if (key === 'experimental' && isPlainObject(normalized['experimental'])) {
          for (const nested of Object.keys(normalized['experimental'])) {
            locked.add(pointer(`experimental/${nested}`));
          }
        }

        continue;
      }

      if ((SCALAR_LOCK_ROOT_KEYS as readonly string[]).includes(key)) {
        if (key === 'mcp') {
          const mcp = normalized['mcp'];

          if (isPlainObject(mcp)) {
            if ('timeout' in mcp) {
              locked.add(pointer('mcp/timeout'));
            }

            if (isPlainObject(mcp['servers'])) {
              const entry = ensureAdditive('/mcp/servers');
              entry.keys = [...new Set([...(entry.keys ?? []), ...Object.keys(mcp['servers'])])];
            }
          }

          continue;
        }

        locked.add(pointer(key));
        continue;
      }

      if ((MAP_MERGE_ROOT_KEYS as readonly string[]).includes(key) && isPlainObject(normalized[key])) {
        const entry = ensureAdditive(pointer(key));
        entry.keys = [...new Set([...(entry.keys ?? []), ...Object.keys(normalized[key] as JsonObject)])];
        continue;
      }

      if ((ARRAY_CONCAT_ROOT_KEYS as readonly string[]).includes(key) && Array.isArray(normalized[key])) {
        const entry = ensureAdditive(pointer(key));
        entry.items = [...(entry.items ?? []), ...(normalized[key] as unknown[])];
        continue;
      }

      // `formatter: false` fully disables formatters (replace lock); object maps merge additively.
      if (key === 'formatter') {
        if (normalized[key] === false) {
          locked.add(pointer(key));
        } else if (isPlainObject(normalized[key])) {
          const entry = ensureAdditive(pointer(key));
          entry.keys = [...new Set([...(entry.keys ?? []), ...Object.keys(normalized[key] as JsonObject)])];
        }
      }
    }
  }

  return {
    lockedPaths: [...locked].sort(),
    inheritedAdditive: [...additiveByPath.values()],
  };
}
