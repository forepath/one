import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { TopologyGraph, TopologyQuery, TopologyTrace } from '../types/topology.types';
import { ConsoleApi } from './console-api';

/** The topology map (3.9): structure, flows (now / at a time), plan overlay and the path trace of a hostname. */
@Injectable({ providedIn: 'root' })
export class TopologyService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  graph(query: TopologyQuery = {}): Observable<TopologyGraph> {
    let params = new HttpParams();

    if (query.flows) params = params.set('flows', 'true');

    if (query.at) params = params.set('at', query.at);

    if (query.plan) params = params.set('plan', query.plan);

    return this.http.get<TopologyGraph>(this.url('/topology'), { params });
  }

  trace(host: string): Observable<TopologyTrace> {
    return this.http.get<TopologyTrace>(this.url('/topology/trace'), { params: new HttpParams().set('host', host) });
  }
}
