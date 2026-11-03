import { effect, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FPC_DEFAULT_PAGE_SIZE, fpcListQueryState } from '@forepath/shared/frontend/ui-components';
import { debounceTime, distinctUntilChanged } from 'rxjs';

/** What a server-paged table asks its facade for (replace-page). */
export interface DbPageQuery {
  search?: string;
  page: number;
  pageSize: number;
}

export interface DbServerPagingOptions {
  /** Extra applied filters the load depends on; a change reloads from page 1. */
  filters?: () => unknown;
  debounceMs?: number;
  /**
   * URL sync of search / page / page size via `fpcListQueryState` (`?q=&p=&n=`). The string prefixes the keys so
   * several lists (tabs, nested tables) on one route don't collide (`'hist-'` → `hist-q`, `hist-p`, `hist-n`).
   * Omit for no URL sync (nested / modal tables).
   */
  url?: string;
}

/**
 * Server paging state of one `fpc-data-table` (`paging="server"`): two-way `search` / `page` / `pageSize` signals and
 * an effect that loads the page whenever one of them (or a tracked extra filter) changes. Search keystrokes are
 * debounced (the table resets the page to 1 at once); a filter change goes back to page 1. Call in an injection
 * context.
 */
export function dbServerPaging(load: (query: DbPageQuery) => void, options: DbServerPagingOptions = {}) {
  const search = signal('');
  const page = signal(1);
  const pageSize = signal(FPC_DEFAULT_PAGE_SIZE);

  if (options.url !== undefined) {
    const prefix = options.url;

    // Seeds search / page / size from the URL at once (before the first load) and writes them back.
    fpcListQueryState({
      filters: {},
      search,
      page,
      pageSize,
      url: { search: `${prefix}q`, page: `${prefix}p`, pageSize: `${prefix}n`, filters: `${prefix}pf` },
    });
  }

  const debounced = toSignal(
    toObservable(search).pipe(debounceTime(options.debounceMs ?? 300), distinctUntilChanged()),
    { initialValue: untracked(search) },
  );
  const query = (): DbPageQuery => ({
    search: debounced().trim() || undefined,
    page: page(),
    pageSize: pageSize(),
  });
  let lastFilters: string | undefined;

  effect(() => {
    const current = query();
    const filters = JSON.stringify(options.filters?.() ?? null);
    const filtersChanged = lastFilters !== undefined && filters !== lastFilters;

    lastFilters = filters;

    // A new filter starts on page 1 (the page change re-runs this effect).
    if (filtersChanged && current.page !== 1) {
      untracked(() => page.set(1));

      return;
    }

    untracked(() => load(current));
  });

  return {
    search,
    page,
    pageSize,
    /** Reloads the current page (after a row / bulk action). */
    reload: () => load(untracked(query)),
  };
}

/**
 * Pager total for a server-paged list whose API returns a page without a count (D4 "x–y of N"): the summary count
 * is exact while no search is applied; with a search the pager falls back to `hasNext`.
 */
export function dbPagerTotal(search: string | null | undefined, count: number | null | undefined): number | null {
  if (search?.trim() || count == null || !Number.isFinite(count)) {
    return null;
  }

  return count;
}
