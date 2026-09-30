import { Store } from '@ngrx/store';
import { EMPTY, mergeMap, Observable, withLatestFrom } from 'rxjs';

import { selectSelectedAgentId, selectSelectedClientId } from '../container-socket/container-socket.selectors';
import type { ContainerStatsPayload, ForwardedEventPayload } from '../container-socket/container-socket.types';

import { containerStatsReceived } from './stats.actions';
import { selectStatsByContainer } from './stats.selectors';
import { buildContainerStatsEntry, isRedundantContainerStats } from './stats.utils';

/**
 * Map raw containerStats socket payloads to at most one {@link containerStatsReceived}
 * when the tick changes something the UI uses. Redundant stopped heartbeats yield EMPTY.
 */
export function mapContainerStatsTick$(payloads$: Observable<ForwardedEventPayload>, store: Store) {
  return payloads$.pipe(
    withLatestFrom(
      store.select(selectSelectedClientId),
      store.select(selectSelectedAgentId),
      store.select(selectStatsByContainer),
    ),
    mergeMap(([payload, selectedClientId, selectedAgentId, statsByContainer]) => {
      if (!payload || !('success' in payload) || !payload.success || !('data' in payload)) {
        return EMPTY;
      }

      const entry = buildContainerStatsEntry(payload.data as ContainerStatsPayload, selectedClientId, selectedAgentId);
      const key = `${entry.clientId}:${entry.agentId}`;
      const previous = statsByContainer[key]?.at(-1);

      if (isRedundantContainerStats(previous, entry)) {
        return EMPTY;
      }

      return [containerStatsReceived({ entry })];
    }),
  );
}
