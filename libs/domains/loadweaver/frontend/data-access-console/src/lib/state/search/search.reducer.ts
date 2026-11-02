import { createReducer, on } from '@ngrx/store';

import type { SearchAction, SearchResult } from '../../types/search.types';
import {
  clearSearchActionResult,
  globalSearch,
  globalSearchFailure,
  globalSearchSuccess,
  loadSearchFavouritesFailure,
  loadSearchFavouritesSuccess,
  recordSearchVisit,
  runSearchAction,
  runSearchActionFailure,
  runSearchActionSuccess,
  setSearchFavourite,
  setSearchFavouriteFailure,
} from './search.actions';

/** Recent items kept in the session (the API has no list of them). */
export const SEARCH_RECENT_MAX = 8;

export interface SearchActionResult {
  title: string;
  ok: boolean;
  error?: string;
}

export interface ConsoleSearchState {
  query: string;
  results: SearchResult[];
  actions: SearchAction[];
  loading: boolean;
  error: string | null;
  /** Favourite items (`Kind:key`). */
  favourites: string[];
  favouritesLoaded: boolean;
  /** Results opened in this session, newest first. */
  recent: SearchResult[];
  /** The `api` action being run (its title). */
  running: string | null;
  /** How the last `api` action or favourite change went. */
  actionResult: SearchActionResult | null;
}

export const initialConsoleSearchState: ConsoleSearchState = {
  query: '',
  results: [],
  actions: [],
  loading: false,
  error: null,
  favourites: [],
  favouritesLoaded: false,
  recent: [],
  running: null,
  actionResult: null,
};

function applyFavourite(state: ConsoleSearchState, item: string, favourite: boolean): ConsoleSearchState {
  return {
    ...state,
    favourites: favourite
      ? [...state.favourites.filter((f) => f !== item), item]
      : state.favourites.filter((f) => f !== item),
    results: state.results.map((r) => (r.id === item ? { ...r, favourite } : r)),
    recent: state.recent.map((r) => (r.id === item ? { ...r, favourite } : r)),
  };
}

export const consoleSearchReducer = createReducer(
  initialConsoleSearchState,
  on(globalSearch, (state, { q }) =>
    q.trim()
      ? { ...state, query: q, loading: true, error: null }
      : { ...state, query: '', results: [], actions: [], loading: false, error: null },
  ),
  on(globalSearchSuccess, (state, { q, response }) =>
    q === state.query ? { ...state, results: response.results, actions: response.actions, loading: false } : state,
  ),
  on(globalSearchFailure, (state, { q, error }) => (q === state.query ? { ...state, loading: false, error } : state)),
  on(loadSearchFavouritesSuccess, (state, { items }) => ({ ...state, favourites: items, favouritesLoaded: true })),
  on(loadSearchFavouritesFailure, (state) => ({ ...state, favourites: [], favouritesLoaded: true })),
  on(setSearchFavourite, (state, { item, favourite }) => ({
    ...applyFavourite(state, item, favourite),
    actionResult: null,
  })),
  on(setSearchFavouriteFailure, (state, { item, favourite, error }) => ({
    ...applyFavourite(state, item, !favourite),
    actionResult: { title: item, ok: false, error },
  })),
  on(recordSearchVisit, (state, { result }) => ({
    ...state,
    recent: [result, ...state.recent.filter((r) => r.id !== result.id)].slice(0, SEARCH_RECENT_MAX),
  })),
  on(runSearchAction, (state, { action }) => ({ ...state, running: action.title, actionResult: null })),
  on(runSearchActionSuccess, (state, { action }) => ({
    ...state,
    running: null,
    actionResult: { title: action.title, ok: true },
  })),
  on(runSearchActionFailure, (state, { action, error }) => ({
    ...state,
    running: null,
    actionResult: { title: action.title, ok: false, error },
  })),
  on(clearSearchActionResult, (state) => ({ ...state, actionResult: null })),
);
