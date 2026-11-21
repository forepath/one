import type { ParsedStructuredReference } from '../bank-import.types';
import { extractStructuredReferences } from '../bank-parse.utils';

/** Returns a shallow copy of `value` without `undefined` properties, or `undefined` when nothing is left. */
export function pruneUndefined<T extends object>(value: T): T | undefined {
  const result: Partial<T> = {};
  let hasValue = false;

  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] !== undefined) {
      result[key] = value[key];
      hasValue = true;
    }
  }

  return hasValue ? (result as T) : undefined;
}

/** Merges explicit structured references with those found in the remittance text (deduplicated). */
export function mergeStructuredReferences(
  explicit: ParsedStructuredReference[],
  remittance: string | undefined,
): ParsedStructuredReference[] | undefined {
  const merged: ParsedStructuredReference[] = [];
  const seen = new Set<string>();

  for (const ref of [...explicit, ...extractStructuredReferences(remittance)]) {
    const key = ref.reference.replace(/\s/g, '').toUpperCase();

    if (!seen.has(key)) {
      seen.add(key);
      merged.push(ref);
    }
  }

  return merged.length > 0 ? merged : undefined;
}
