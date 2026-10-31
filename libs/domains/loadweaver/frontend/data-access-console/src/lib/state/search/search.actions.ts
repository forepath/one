import { createAction, props } from '@ngrx/store';

import type { SearchAction, SearchResponse, SearchResult } from '../../types/search.types';

/** An empty query clears the results. */
export const globalSearch = createAction('[ConsoleSearch] Search', props<{ q: string; limit?: number }>());
export const globalSearchSuccess = createAction(
  '[ConsoleSearch] Search Success',
  props<{ q: string; response: SearchResponse }>(),
);
export const globalSearchFailure = createAction(
  '[ConsoleSearch] Search Failure',
  props<{ q: string; error: string }>(),
);

export const loadSearchFavourites = createAction('[ConsoleSearch] Load Favourites');
export const loadSearchFavouritesSuccess = createAction(
  '[ConsoleSearch] Load Favourites Success',
  props<{ items: string[] }>(),
);
export const loadSearchFavouritesFailure = createAction(
  '[ConsoleSearch] Load Favourites Failure',
  props<{ error: string }>(),
);

/** Stars or unstars an item; applied right away and taken back when the API refuses. */
export const setSearchFavourite = createAction(
  '[ConsoleSearch] Set Favourite',
  props<{ item: string; favourite: boolean }>(),
);
export const setSearchFavouriteSuccess = createAction(
  '[ConsoleSearch] Set Favourite Success',
  props<{ item: string; favourite: boolean }>(),
);
export const setSearchFavouriteFailure = createAction(
  '[ConsoleSearch] Set Favourite Failure',
  props<{ item: string; favourite: boolean; error: string }>(),
);

/** A result was opened: recorded as a visit (recent items rank first) and kept as recent in this session. */
export const recordSearchVisit = createAction('[ConsoleSearch] Record Visit', props<{ result: SearchResult }>());

/** Runs an `api` action of the palette (after the caller confirmed it). */
export const runSearchAction = createAction('[ConsoleSearch] Run Action', props<{ action: SearchAction }>());
export const runSearchActionSuccess = createAction(
  '[ConsoleSearch] Run Action Success',
  props<{ action: SearchAction }>(),
);
export const runSearchActionFailure = createAction(
  '[ConsoleSearch] Run Action Failure',
  props<{ action: SearchAction; error: string }>(),
);

export const clearSearchActionResult = createAction('[ConsoleSearch] Clear Action Result');
