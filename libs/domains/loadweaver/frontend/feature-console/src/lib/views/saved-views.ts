import { computed, type Signal, type WritableSignal } from '@angular/core';

/** Scope of the console settings row (`nav/console-settings.service.ts`); never offered as a list's views. */
export const RESERVED_VIEW_SCOPES: readonly string[] = ['settings'];

/** A saved view's state as the console stores it (3.37): the list's own keys plus optional `density`. */
export type SavedViewState = Readonly<Record<string, unknown>>;

/**
 * How a list / tree exposes its state to the "Views ▾" dropdown: the current state (search, filters, columns, sort,
 * tree view …) and how to apply a stored one.
 */
export interface SavedViewBinding {
  readonly state: Signal<SavedViewState>;
  apply(state: SavedViewState): void;
}

/** Whether `value` may replace a signal whose initial value was `initial` (same JSON shape class). */
export function compatibleViewValue(initial: unknown, value: unknown): boolean {
  if (value === undefined) return false;
  if (initial === null || initial === undefined) return true;
  if (Array.isArray(initial)) return Array.isArray(value);
  if (value === null) return false;

  return typeof value === typeof initial && Array.isArray(value) === Array.isArray(initial);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Binds writable signals (one per state key) to a saved view: `state` reads them all, `apply` sets every key the
 * stored state carries with a compatible value (objects merged over the initial value, so a filter added later keeps
 * its default) and resets the others to their initial values; `afterApply` reloads server-side filtered lists.
 */
export function savedViewBinding(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signals: Record<string, WritableSignal<any>>,
  afterApply?: () => void,
): SavedViewBinding {
  const initial = Object.fromEntries(Object.entries(signals).map(([key, value]) => [key, value()]));

  return {
    state: computed(() => Object.fromEntries(Object.entries(signals).map(([key, value]) => [key, value()]))),
    apply(state: SavedViewState): void {
      for (const [key, target] of Object.entries(signals)) {
        const value = state[key];
        const start = initial[key];

        if (!compatibleViewValue(start, value)) target.set(start);
        else target.set(isPlainObject(start) && isPlainObject(value) ? { ...start, ...value } : value);
      }

      afterApply?.();
    },
  };
}

/** JSON with sorted object keys: equal states give equal strings regardless of key order. */
export function stableViewJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableViewJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;

    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableViewJson(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value ?? null);
}

/** Whether a stored view equals the current state (keys of `ignore`, e.g. `density`, don't count). */
export function sameViewState(
  stored: SavedViewState,
  current: SavedViewState,
  ignore: readonly string[] = ['density'],
): boolean {
  const strip = (state: SavedViewState) =>
    Object.fromEntries(Object.entries(state).filter(([key]) => !ignore.includes(key)));

  return stableViewJson(strip(stored)) === stableViewJson(strip(current));
}

/** A view name as the API accepts it (1–100 characters, trimmed); null when empty. */
export function viewName(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').trim().slice(0, 100);

  return trimmed ? trimmed : null;
}
