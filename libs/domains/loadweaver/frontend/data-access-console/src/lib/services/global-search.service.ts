import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { SearchAction, SearchResponse } from '../types/search.types';
import { ConsoleApi } from './console-api';

/** Global search and command palette (3.25): results, actions, favourites and visits. */
@Injectable({ providedIn: 'root' })
export class GlobalSearchService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  search(q: string, limit?: number): Observable<SearchResponse> {
    let params = new HttpParams().set('q', q);

    if (limit) params = params.set('limit', limit);

    return this.http.get<SearchResponse>(this.url('/search'), { params });
  }

  /** The caller's favourite items (`Kind:key`). */
  favourites(): Observable<string[]> {
    return this.http.get<string[]>(this.url('/search/favorites'));
  }

  setFavourite(item: string, favourite: boolean): Observable<void> {
    const url = this.url(`/search/favorites/${encodeURIComponent(item)}`);

    return favourite ? this.http.put<void>(url, null) : this.http.delete<void>(url);
  }

  /** Records a visit: recently visited items rank first. */
  visited(item: string): Observable<void> {
    return this.http.post<void>(this.url('/search/recent'), { item });
  }

  /** Runs an `api` action of the palette (the caller confirmed it). */
  runAction(action: SearchAction): Observable<unknown> {
    if (!action.request) throw new Error('not an API action');

    const path = action.request.path.startsWith('/') ? action.request.path : `/${action.request.path}`;

    return this.http.request(action.request.method.toUpperCase(), this.url(path), { body: {} });
  }
}
