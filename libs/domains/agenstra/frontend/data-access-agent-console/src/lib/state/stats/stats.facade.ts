import { DestroyRef, inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { distinctUntilChanged, Observable } from 'rxjs';

import { clearAllStatsHistory, clearStatsHistory } from './stats.actions';
import {
  selectContainerRunningStatus,
  selectContainerStats,
  selectContainerStatsCount,
  selectContainerStatsFiltered,
  selectContainerStatsFromTime,
  selectContainerStatsInRange,
  selectContainerStatsLimited,
  selectContainersWithStats,
  selectCurrentContainerStats,
} from './stats.selectors';
import type { ContainerStatsEntry } from './stats.types';

/**
 * Facade for stats state management.
 * Provides a clean API for components to interact with container stats state.
 */
@Injectable({
  providedIn: 'root',
})
export class StatsFacade {
  private readonly store = inject(Store);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Get stats history for a specific container (clientId:agentId)
   * @param clientId - The client ID
   * @param agentId - The agent ID
   */
  getContainerStats$(clientId: string, agentId: string): Observable<ContainerStatsEntry[]> {
    return this.store.select(selectContainerStats(clientId, agentId)).pipe(distinctUntilChanged());
  }

  /**
   * Get the most recent stats entry for a specific container
   * @param clientId - The client ID
   * @param agentId - The agent ID
   */
  getCurrentContainerStats$(clientId: string, agentId: string): Observable<ContainerStatsEntry | null> {
    return this.store.select(selectCurrentContainerStats(clientId, agentId)).pipe(distinctUntilChanged());
  }

  /**
   * Get container run status (true = running, false = stopped) for a specific container.
   * Returns null when no status has been received yet.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   */
  getContainerRunningStatus$(clientId: string, agentId: string): Observable<boolean | null> {
    return this.store.select(selectContainerRunningStatus(clientId, agentId)).pipe(distinctUntilChanged());
  }

  /**
   * Get stats entries for a specific container within a time range
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param startTime - Start timestamp (Date.now() or ISO string)
   * @param endTime - End timestamp (Date.now() or ISO string), or null for "now"
   */
  getContainerStatsInRange$(
    clientId: string,
    agentId: string,
    startTime: number | string,
    endTime: number | string | null,
  ): Observable<ContainerStatsEntry[]> {
    return this.store
      .select(selectContainerStatsInRange(clientId, agentId, startTime, endTime))
      .pipe(distinctUntilChanged());
  }

  /**
   * Get stats entries for a specific container from a start time to now
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param startTime - Start timestamp (Date.now() or ISO string)
   */
  getContainerStatsFromTime$(
    clientId: string,
    agentId: string,
    startTime: number | string,
  ): Observable<ContainerStatsEntry[]> {
    return this.store.select(selectContainerStatsFromTime(clientId, agentId, startTime)).pipe(distinctUntilChanged());
  }

  /**
   * Get the count of stats entries for a specific container
   * @param clientId - The client ID
   * @param agentId - The agent ID
   */
  getContainerStatsCount$(clientId: string, agentId: string): Observable<number> {
    return this.store.select(selectContainerStatsCount(clientId, agentId)).pipe(distinctUntilChanged());
  }

  /**
   * Get all container keys (clientId:agentId) that have stats
   */
  getContainersWithStats$(): Observable<string[]> {
    return this.store.select(selectContainersWithStats).pipe(distinctUntilChanged());
  }

  /**
   * Get stats entries for a specific container, limited to the most recent N entries
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param limit - Maximum number of entries to return
   */
  getContainerStatsLimited$(clientId: string, agentId: string, limit: number): Observable<ContainerStatsEntry[]> {
    return this.store.select(selectContainerStatsLimited(clientId, agentId, limit)).pipe(distinctUntilChanged());
  }

  /**
   * Get stats entries for a specific container, filtered by a custom predicate
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param predicate - Filter function
   */
  getContainerStatsFiltered$(
    clientId: string,
    agentId: string,
    predicate: (entry: ContainerStatsEntry) => boolean,
  ): Observable<ContainerStatsEntry[]> {
    return this.store.select(selectContainerStatsFiltered(clientId, agentId, predicate)).pipe(distinctUntilChanged());
  }

  /**
   * Clear stats history for a specific container
   * @param clientId - The client ID
   * @param agentId - The agent ID
   */
  clearStatsHistory(clientId: string, agentId: string): void {
    this.store.dispatch(clearStatsHistory({ clientId, agentId }));
  }

  /**
   * Clear all stats history
   */
  clearAllStatsHistory(): void {
    this.store.dispatch(clearAllStatsHistory());
  }
}
