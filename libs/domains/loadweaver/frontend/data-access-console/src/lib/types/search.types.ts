/** Global search and command palette (3.25): `/search`. */

/** One indexed entity; `id` is `Kind:key` (the item for favourites and visits). */
export interface SearchResult {
  id: string;
  kind: string;
  /** The object's name (plans / alerts: their id); absent from older servers. */
  name?: string;
  title: string;
  project: string | null;
  /** Console route. */
  link: string;
  favourite: boolean;
}

/** An action matching the query: navigate to a console route, or call the API (after a confirmation). */
export interface SearchAction {
  title: string;
  kind: 'navigate' | 'api';
  link?: string;
  request?: { method: string; path: string };
}

/** `GET /search?q=`: favourites first, then recently visited, then by relevance. */
export interface SearchResponse {
  results: SearchResult[];
  actions: SearchAction[];
}
