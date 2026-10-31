import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { TopologyQuery } from '../../types/topology.types';
import {
  clearTopologyTrace,
  connectTopologyLive,
  disconnectTopologyLive,
  loadTopology,
  traceTopology,
} from './topology.actions';
import {
  selectTopologyAt,
  selectTopologyError,
  selectTopologyGraph,
  selectTopologyLive,
  selectTopologyLiveConnected,
  selectTopologyLiveError,
  selectTopologyStructureVersion,
  selectTopologyLoading,
  selectTopologyOverlay,
  selectTopologyQuery,
  selectTopologyTraceError,
  selectTopologyTraceHost,
  selectTopologyTraceLoading,
  selectTopologyTraceSteps,
} from './topology.selectors';

@Injectable()
export class ConsoleTopologyFacade {
  private readonly store = inject(Store);

  readonly graph$ = this.store.select(selectTopologyGraph);
  readonly query$ = this.store.select(selectTopologyQuery);
  readonly loading$ = this.store.select(selectTopologyLoading);
  readonly error$ = this.store.select(selectTopologyError);
  readonly at$ = this.store.select(selectTopologyAt);
  readonly overlay$ = this.store.select(selectTopologyOverlay);
  readonly live$ = this.store.select(selectTopologyLive);
  readonly liveConnected$ = this.store.select(selectTopologyLiveConnected);
  readonly liveError$ = this.store.select(selectTopologyLiveError);
  /** Changes when `socket/topology` announces a new structure (3.36 B3); the map reloads on its own. */
  readonly structureVersion$ = this.store.select(selectTopologyStructureVersion);
  readonly traceHost$ = this.store.select(selectTopologyTraceHost);
  readonly traceSteps$ = this.store.select(selectTopologyTraceSteps);
  readonly traceLoading$ = this.store.select(selectTopologyTraceLoading);
  readonly traceError$ = this.store.select(selectTopologyTraceError);

  /** `silent`: refresh without the loading state. */
  load(query: TopologyQuery = {}, silent = false): void {
    this.store.dispatch(loadTopology({ query, silent }));
  }

  connectLive(): void {
    this.store.dispatch(connectTopologyLive());
  }

  disconnectLive(): void {
    this.store.dispatch(disconnectTopologyLive());
  }

  trace(host: string): void {
    this.store.dispatch(traceTopology({ host }));
  }

  clearTrace(): void {
    this.store.dispatch(clearTopologyTrace());
  }
}
