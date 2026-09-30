import {
  INHERITED_MAP_ENTRY_OVERRIDE_KEYS,
  OpencodeConfigValidationError,
  type InheritedAdditiveEntry,
  type JsonObject,
} from './types';
import { findForbiddenV1RootKeys } from './migrate-v1-to-v2';

const ALLOWED_INHERITED_OVERRIDE = new Set<string>(INHERITED_MAP_ENTRY_OVERRIDE_KEYS);

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizePointer(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function pathSegments(pointerPath: string): string[] {
  return normalizePointer(pointerPath)
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function getAtPointer(config: JsonObject, pointerPath: string): unknown {
  let current: unknown = config;

  for (const segment of pathSegments(pointerPath)) {
    if (!isPlainObject(current) || !(segment in current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

export function isPathLocked(lockedPaths: readonly string[], candidate: string): boolean {
  const normalized = normalizePointer(candidate);

  return lockedPaths.some((locked) => {
    const lockedNorm = normalizePointer(locked);

    return normalized === lockedNorm || normalized.startsWith(`${lockedNorm}/`);
  });
}

function assertNoLockedWrites(value: JsonObject, lockedPaths: readonly string[], prefix = ''): void {
  for (const [key, nested] of Object.entries(value)) {
    if (nested === undefined) {
      continue;
    }

    const pointer = `${prefix}/${key}`;

    if (isPathLocked(lockedPaths, pointer)) {
      throw new OpencodeConfigValidationError(`Path '${pointer}' is locked by a higher layer`);
    }

    if (isPlainObject(nested)) {
      assertNoLockedWrites(nested, lockedPaths, pointer);
    }
  }
}

/**
 * Ensures an overlay does not write over locked replace paths or mutate inherited additive entries.
 */
export function assertOverlayRespectsHeredity(
  overlay: JsonObject | null | undefined,
  lockedPaths: string[],
  inheritedAdditive: InheritedAdditiveEntry[] = [],
): void {
  if (!overlay) {
    return;
  }

  const v1 = findForbiddenV1RootKeys(overlay);

  if (v1.length > 0) {
    throw new OpencodeConfigValidationError(
      `OpenCode config V1 keys are not allowed: ${v1.join(', ')}. Use V2 field names.`,
    );
  }

  assertNoLockedWrites(overlay, lockedPaths);

  for (const entry of inheritedAdditive) {
    const path = normalizePointer(entry.path);
    const value = getAtPointer(overlay, path);

    // Fully locked list/map roots already rejected above; skip additive checks when path is locked.
    if (isPathLocked(lockedPaths, path)) {
      continue;
    }

    if (entry.keys?.length && isPlainObject(value)) {
      for (const key of entry.keys) {
        if (!(key in value)) {
          continue;
        }

        const overlayEntry = value[key];

        if (!isPlainObject(overlayEntry)) {
          throw new OpencodeConfigValidationError(
            `Key '${key}' at '${path}' is inherited from a higher layer and cannot be overridden`,
          );
        }

        const disallowed = Object.keys(overlayEntry).filter((field) => !ALLOWED_INHERITED_OVERRIDE.has(field));

        if (disallowed.length > 0) {
          throw new OpencodeConfigValidationError(
            `Key '${key}' at '${path}' is inherited; only ${INHERITED_MAP_ENTRY_OVERRIDE_KEYS.join(
              ', ',
            )} may be set (disallowed: ${disallowed.join(', ')})`,
          );
        }
      }
    }

    if (entry.items?.length && Array.isArray(value)) {
      for (const item of entry.items) {
        const serialized = JSON.stringify(item);

        if (value.some((candidate) => JSON.stringify(candidate) === serialized)) {
          // Re-declaring an inherited item is redundant but allowed only if identical —
          // plan says child appends only and cannot remove inherited; re-adding same item is OK.
          continue;
        }
      }
    }
  }
}

/**
 * Reject secret map keys locked by a higher layer (`/secrets/{KEY}`).
 */
export function assertSecretsRespectLocks(
  secrets: Record<string, string> | null | undefined,
  lockedPaths: readonly string[],
): void {
  if (!secrets) {
    return;
  }

  for (const key of Object.keys(secrets)) {
    const pointer = `/secrets/${key}`;

    if (isPathLocked(lockedPaths, pointer)) {
      throw new OpencodeConfigValidationError(`Path '${pointer}' is locked by a higher layer`);
    }
  }
}

/**
 * Pure validation for raw JSON editors. Returns an error message or null when valid.
 */
export function validateOverlayAgainstHeredity(
  overlay: JsonObject | null | undefined,
  lockedPaths: string[],
  inheritedAdditive: InheritedAdditiveEntry[] = [],
): string | null {
  try {
    assertOverlayRespectsHeredity(overlay, lockedPaths, inheritedAdditive);

    return null;
  } catch (error) {
    if (error instanceof OpencodeConfigValidationError) {
      return error.message;
    }

    throw error;
  }
}
