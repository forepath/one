import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleSearchState } from './search.reducer';

export const selectConsoleSearchState = createFeatureSelector<ConsoleSearchState>('consoleSearch');

export const selectSearchQuery = createSelector(selectConsoleSearchState, (state) => state.query);
export const selectSearchResults = createSelector(selectConsoleSearchState, (state) => state.results);
export const selectSearchActions = createSelector(selectConsoleSearchState, (state) => state.actions);
export const selectSearchLoading = createSelector(selectConsoleSearchState, (state) => state.loading);
export const selectSearchError = createSelector(selectConsoleSearchState, (state) => state.error);
export const selectSearchFavourites = createSelector(selectConsoleSearchState, (state) => state.favourites);
export const selectSearchFavouritesLoaded = createSelector(selectConsoleSearchState, (state) => state.favouritesLoaded);
export const selectSearchRecent = createSelector(selectConsoleSearchState, (state) => state.recent);
export const selectSearchRunning = createSelector(selectConsoleSearchState, (state) => state.running);
export const selectSearchActionResult = createSelector(selectConsoleSearchState, (state) => state.actionResult);
