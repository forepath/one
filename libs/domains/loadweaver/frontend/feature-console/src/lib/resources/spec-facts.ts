import type { FpcKeyValueItem } from '@forepath/shared/frontend/ui-components';

import { SCHEMA_TEXT } from '../objects/schema-form-labels';
import { enumLabel, fieldLabel } from '../objects/schema-form';

/** Longest value text in a summary row; the full spec stays on the Spec tab. */
const MAX_VALUE = 120;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalarText(value: unknown): string {
  if (typeof value === 'boolean') return value ? SCHEMA_TEXT.yes : SCHEMA_TEXT.no;

  if (typeof value === 'string') return enumLabel(value);

  return String(value);
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function clip(text: string): string {
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
}

/**
 * One readable line for a spec value (LW-12b): scalars translated (enum labels, Yes / No), flat lists and maps
 * inline (`a, b` / `tier=db`), nested structures as an entry count. Empty values read "Not set".
 */
export function specValueText(value: unknown, entries: (count: number) => string): string {
  if (value === null || value === undefined || value === '') return SCHEMA_TEXT.notSet;

  if (isScalar(value)) return clip(scalarText(value));

  if (Array.isArray(value)) {
    if (value.length === 0) return SCHEMA_TEXT.notSet;

    return value.every(isScalar) ? clip(value.map(scalarText).join(', ')) : entries(value.length);
  }

  if (isPlainObject(value)) {
    const pairs = Object.entries(value);

    if (pairs.length === 0) return SCHEMA_TEXT.notSet;

    return pairs.every(([, v]) => isScalar(v))
      ? clip(pairs.map(([k, v]) => `${k}=${scalarText(v)}`).join(', '))
      : entries(pairs.length);
  }

  return String(value);
}

/**
 * A resource's Summary facts (LW-12b, 2026-10-29): the top-level spec settings with their form labels, one readable
 * line each — the Summary tab no longer repeats the Spec tab's YAML.
 */
export function specFacts(kind: string, spec: unknown, entries: (count: number) => string): FpcKeyValueItem[] {
  if (!isPlainObject(spec)) return [];

  return Object.entries(spec).map(([key, value]) => ({
    key: `spec:${key}`,
    label: fieldLabel([key], kind),
    value: specValueText(value, entries),
  }));
}
