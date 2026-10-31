import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { SearchAction, SearchResult } from '../../types/search.types';
import {
  clearSearchActionResult,
  globalSearch,
  loadSearchFavourites,
  recordSearchVisit,
  runSearchAction,
  setSearchFavourite,
} from './search.actions';
import {
  selectSearchActionResult,
  selectSearchActions,
  selectSearchError,
  selectSearchFavourites,
  selectSearchFavouritesLoaded,
  selectSearchLoading,
  selectSearchQuery,
  selectSearchRecent,
  selectSearchResults,
  selectSearchRunning,
} from './search.selectors';

@Injectable()
export class ConsoleSearchFacade {
  private readonly store = inject(Store);

  readonly query$ = this.store.select(selectSearchQuery);
  readonly results$ = this.store.select(selectSearchResults);
  readonly actions$ = this.store.select(selectSearchActions);
  readonly loading$ = this.store.select(selectSearchLoading);
  readonly error$ = this.store.select(selectSearchError);
  readonly favourites$ = this.store.select(selectSearchFavourites);
  readonly favouritesLoaded$ = this.store.select(selectSearchFavouritesLoaded);
  readonly recent$ = this.store.select(selectSearchRecent);
  readonly running$ = this.store.select(selectSearchRunning);
  readonly actionResult$ = this.store.select(selectSearchActionResult);

  search(q: string, limit?: number): void {
    this.store.dispatch(globalSearch({ q, ...(limit ? { limit } : {}) }));
  }

  loadFavourites(): void {
    this.store.dispatch(loadSearchFavourites());
  }

  setFavourite(item: string, favourite: boolean): void {
    this.store.dispatch(setSearchFavourite({ item, favourite }));
  }

  visit(result: SearchResult): void {
    this.store.dispatch(recordSearchVisit({ result }));
  }

  runAction(action: SearchAction): void {
    this.store.dispatch(runSearchAction({ action }));
  }

  clearActionResult(): void {
    this.store.dispatch(clearSearchActionResult());
  }
}
