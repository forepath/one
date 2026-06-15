import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { combineLatest, filter, map, withLatestFrom } from 'rxjs';

import { forwardedEventReceived } from '../sockets/sockets.actions';
import { selectSelectedAgentId, selectSelectedClientId } from '../sockets/sockets.selectors';
import type { ContainerStatsPayload } from '../sockets/sockets.types';

import { containerStatsReceived } from './stats.actions';
import type { ContainerStatsEntry } from './stats.types';

/**
 * Effect to process containerStats events from socket and dispatch stats actions
 */
export const processContainerStats$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) => {
    return actions$.pipe(
      ofType(forwardedEventReceived),
      // Only process containerStats events
      filter((action) => action.event === 'containerStats'),
      withLatestFrom(combineLatest([store.select(selectSelectedClientId), store.select(selectSelectedAgentId)])),
      map(([action, [selectedClientId, selectedAgentId]]) => {
        // Extract payload
        const payload = action.payload;

        if (!payload || !('success' in payload) || !payload.success || !('data' in payload)) {
          // Return null for invalid payloads - will be filtered out
          return null;
        }

        const statsData = payload.data as ContainerStatsPayload;
        // Create stats entry with both clientId and agentId
        const entry: ContainerStatsEntry = {
          stats: statsData.stats,
          status: statsData.status,
          timestamp: statsData.timestamp,
          receivedAt: Date.now(),
          clientId: selectedClientId || 'unknown', // Use selected clientId or fallback
          agentId: selectedAgentId || 'unknown', // Use selected agentId or fallback
        };

        return containerStatsReceived({ entry });
      }),
      // Filter out null values (invalid payloads)
      filter((action): action is ReturnType<typeof containerStatsReceived> => action !== null),
    );
  },
  { functional: true },
);
