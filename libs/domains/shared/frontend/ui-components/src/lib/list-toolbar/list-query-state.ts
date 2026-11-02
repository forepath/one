import {
  computed,
  DestroyRef,
  effect,
  inject,
  linkedSignal,
  type Signal,
  untracked,
  type WritableSignal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import type { FpcTableSort } from '../data-table/data-table.model';

/** A filter value of a list: a select (string / number), a switch (boolean) or a multi-select (string[]). */
export type FpcFilterValue = string | number | boolean | readonly string[] | null;

export type FpcFilterValues = Record<string, FpcFilterValue>;

export interface FpcListQueryStateOptions<F extends FpcFilterValues> {
  /** The **applied** filter signals: the list filters (or the server query reads) these. */
  filters: { [K in keyof F]: WritableSignal<F[K]> };
  /** Live search of the list (not a filter: applies while typing, no Apply). */
  search?: WritableSignal<string>;
  /**
   * URL sync of the applied filters and the search (`?q=&f=status=failed;project=a|b`). Keys per list so lanes on
   * one page don't collide; `false` = no URL sync. Default `{ search: 'q', filters: 'f' }`.
   */
  url?: false | { search?: string; filters?: string; page?: string; pageSize?: string; sort?: string };
  /** Current page (1-based; back to 1 on Apply / Clear all / chip removal / search). URL `p` (omitted on page 1). */
  page?: WritableSignal<number>;
  /** Page size (URL `n`, omitted at its initial value). */
  pageSize?: WritableSignal<number>;
  /** Sort (URL `s=<column>:<asc|desc>`; server-side lists send it to the API). */
  sort?: WritableSignal<FpcTableSort | null>;
  /** The drawer's open state: opening it starts a fresh draft from the applied values. */
  open?: Signal<boolean>;
  /** Runs after Apply / Clear all / chip removal (server-side lists re-query here). */
  changed?: () => void;
  /** Debounce of URL writes in ms (search typing). Default 300. */
  debounceMs?: number;
}

/** Applied filters, the drawer's draft and the URL of one list (3.38 R12). */
export interface FpcListQueryState<F extends FpcFilterValues> {
  /** Drawer values (bind the drawer's fields to these). */
  readonly draft: Signal<F>;
  /** Applied values (what the list shows). */
  readonly applied: Signal<F>;
  /** Number of applied filters that differ from their defaults (the toggle's count badge). */
  readonly activeCount: Signal<number>;
  /** Keys of the applied filters that differ from their defaults (chips). */
  readonly activeKeys: Signal<(keyof F)[]>;
  /** Changes drawer values and applies them live (while typing in a text field after `debounceMs`, else right away). */
  patch(values: Partial<F>): void;
  /** Apply now: draft → applied (+ URL); no-op when nothing changed. */
  apply(): void;
  /** Clear all: every filter back to its default (draft too). The search stays (it has its own clear). */
  clear(): void;
  /** Removes one applied filter (its chip). */
  reset(key: keyof F): void;
  /** Re-seeds the draft from the applied values (the drawer opened). */
  syncDraft(): void;
}

function isDefault(value: FpcFilterValue, fallback: FpcFilterValue): boolean {
  return JSON.stringify(value ?? null) === JSON.stringify(fallback ?? null);
}

function toParam(value: FpcFilterValue): string[] {
  if (value === null || value === undefined || value === '' || value === false) return [];
  if (Array.isArray(value)) return [...value];

  return [String(value)];
}

function fromParam(raw: readonly string[], fallback: FpcFilterValue): FpcFilterValue {
  if (Array.isArray(fallback)) return [...raw];
  if (typeof fallback === 'boolean') return raw[0] === 'true';
  if (typeof fallback === 'number') {
    const n = Number(raw[0]);

    return Number.isFinite(n) ? n : fallback;
  }

  return raw[0] ?? fallback;
}

/** Filter-panel state in the URL (`status=failed;project=a|b`); `null` when nothing is set. */
export function fpcEncodeFilterParam(filters: Readonly<Record<string, readonly string[]>>): string | null {
  const parts = Object.keys(filters)
    .sort()
    .filter((key) => filters[key].length > 0)
    .map((key) => `${encodeURIComponent(key)}=${filters[key].map(encodeURIComponent).join('|')}`);

  return parts.length > 0 ? parts.join(';') : null;
}

export function fpcDecodeFilterParam(param: string | null | undefined): Record<string, string[]> {
  const filters: Record<string, string[]> = {};

  for (const part of (param ?? '').split(';')) {
    const [key, values] = part.split('=');

    if (!key || !values) continue;

    try {
      filters[decodeURIComponent(key)] = values.split('|').filter(Boolean).map(decodeURIComponent);
    } catch {
      // A malformed part is skipped.
    }
  }

  return filters;
}

/**
 * Shared list query state for `fpc-list-toolbar` (3.38 R12) — call it in an injection context (field initializer):
 *
 * ```ts
 * readonly status = signal('');            // applied: the list filters on it
 * readonly search = signal('');
 * readonly filtersOpen = signal(false);
 * readonly query = fpcListQueryState({ filters: { status: this.status }, search: this.search, open: this.filtersOpen });
 * ```
 * ```html
 * <fpc-list-toolbar [(open)]="filtersOpen" [activeCount]="query.activeCount()" (applied)="query.apply()"
 *                   (cleared)="query.clear()">
 *   <fpc-search-field fpcListToolbarLead [value]="search()" (valueChange)="search.set($event)" … />
 *   <select [ngModel]="query.draft().status" (ngModelChange)="query.patch({ status: $event })">…</select>
 * </fpc-list-toolbar>
 * ```
 *
 * The initial values of the applied signals are the defaults (what "Clear all" restores); the URL (if any) seeds
 * them on creation and every applied change / search change is written back (`replaceUrl`, debounced).
 */
export function fpcListQueryState<F extends FpcFilterValues>(
  options: FpcListQueryStateOptions<F>,
): FpcListQueryState<F> {
  const keys = Object.keys(options.filters) as (keyof F & string)[];
  const signals = options.filters;
  const defaults = Object.fromEntries(keys.map((key) => [key, untracked(signals[key])])) as unknown as F;
  const router = inject(Router, { optional: true });
  const route = inject(ActivatedRoute, { optional: true });
  const destroyRef = inject(DestroyRef);
  const url =
    options.url === false || !router
      ? null
      : { search: 'q', filters: 'f', page: 'p', pageSize: 'n', sort: 's', ...(options.url ?? {}) };
  const defaultPageSize = options.pageSize ? untracked(options.pageSize) : null;
  const toFirstPage = (): void => {
    if (options.page && untracked(options.page) !== 1) options.page.set(1);
  };
  const debounceMs = options.debounceMs ?? 300;

  // Seed from the URL (deep links, reload, back / forward of shared links).
  if (url && route) {
    const params = route.snapshot.queryParamMap;
    const decoded = fpcDecodeFilterParam(params.get(url.filters));

    for (const key of keys) {
      if (decoded[key]) signals[key].set(fromParam(decoded[key], defaults[key]) as F[typeof key]);
    }

    const q = params.get(url.search);

    if (q !== null && options.search) options.search.set(q);

    const page = Number(params.get(url.page));

    if (options.page && Number.isInteger(page) && page > 1) options.page.set(page);

    const size = Number(params.get(url.pageSize));

    if (options.pageSize && Number.isInteger(size) && size > 0) options.pageSize.set(size);

    const [column, direction] = (params.get(url.sort) ?? '').split(':');

    if (options.sort && column && (direction === 'asc' || direction === 'desc'))
      options.sort.set({ column, direction });
  }

  // A new search starts on page 1.
  if (options.search && options.page) {
    let firstSearch = true;

    effect(() => {
      options.search?.();
      if (firstSearch) {
        firstSearch = false;
        return;
      }
      toFirstPage();
    });
  }

  const applied = computed(() => Object.fromEntries(keys.map((key) => [key, signals[key]()])) as unknown as F);
  // The draft follows the applied values (saved views, chips, Clear all) and restarts whenever the drawer opens.
  const draft = linkedSignal<F>(() => {
    options.open?.();

    return { ...applied() };
  });
  const activeKeys = computed(() => {
    const values = applied();

    return keys.filter((key) => !isDefault(values[key], defaults[key]));
  });

  const syncDraft = (): void => draft.set({ ...untracked(applied) });

  if (url && router) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let first = true;

    effect(() => {
      const values = applied();
      const q = options.search?.() ?? '';
      const page = options.page?.() ?? 1;
      const size = options.pageSize?.() ?? null;
      const sort = options.sort?.() ?? null;

      if (first) {
        first = false;
        return;
      }

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const filters = Object.fromEntries(
          keys.filter((key) => !isDefault(values[key], defaults[key])).map((key) => [key, toParam(values[key])]),
        );

        void router.navigate([], {
          relativeTo: route ?? undefined,
          queryParams: {
            [url.filters]: fpcEncodeFilterParam(filters),
            ...(options.search ? { [url.search]: q || null } : {}),
            ...(options.page ? { [url.page]: page > 1 ? page : null } : {}),
            ...(options.pageSize ? { [url.pageSize]: size !== defaultPageSize ? size : null } : {}),
            ...(options.sort ? { [url.sort]: sort ? `${sort.column}:${sort.direction}` : null } : {}),
          },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }, debounceMs);
    });
    destroyRef.onDestroy(() => {
      if (timer) clearTimeout(timer);
    });
  }

  const set = (values: Partial<F>): void => {
    for (const key of keys) {
      if (key in values) signals[key].set(values[key] as F[typeof key]);
    }
  };

  const same = (a: FpcFilterValue, b: FpcFilterValue): boolean =>
    Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b;

  // Live apply (user, 2026-10-29: no Apply button): drawer changes apply immediately; the toolbar's `applied` may
  // repeat the same values, so an unchanged draft is a no-op (no duplicate reloads).
  const apply = (): void => {
    const next = untracked(draft);
    const current = untracked(applied);

    if (keys.every((key) => same(next[key], current[key]))) return;

    set(next);
    toFirstPage();
    options.changed?.();
  };
  let applyTimer: ReturnType<typeof setTimeout> | null = null;
  // Typing (focus in a text-like field) applies after a pause; selects, check boxes, dates, menus apply at once.
  const typing = (): boolean => {
    const el = typeof document === 'undefined' ? null : document.activeElement;

    return (
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLInputElement &&
        !/^(checkbox|radio|date|datetime-local|month|week|time|color|range|file)$/.test(el.type))
    );
  };
  const cancelApply = (): void => {
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = null;
  };

  destroyRef.onDestroy(cancelApply);

  return {
    draft: draft.asReadonly(),
    applied,
    activeKeys,
    activeCount: computed(() => activeKeys().length),
    patch: (values) => {
      draft.update((current) => ({ ...current, ...values }));
      cancelApply();
      if (typing()) {
        applyTimer = setTimeout(() => {
          applyTimer = null;
          apply();
        }, debounceMs);
      } else {
        apply();
      }
    },
    apply: () => {
      cancelApply();
      apply();
    },
    clear: () => {
      cancelApply();
      set(defaults);
      syncDraft();
      toFirstPage();
      options.changed?.();
    },
    reset: (key) => {
      set({ [key]: defaults[key] } as Partial<F>);
      toFirstPage();
      options.changed?.();
    },
    syncDraft,
  };
}
