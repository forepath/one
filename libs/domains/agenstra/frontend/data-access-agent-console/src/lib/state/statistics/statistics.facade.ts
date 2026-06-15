import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  loadClientStatisticsChatIo,
  loadClientStatisticsEntityEvents,
  loadClientStatisticsFilterDrops,
  loadClientStatisticsFilterFlags,
  loadClientStatisticsSummary,
  loadStatisticsChatIo,
  loadStatisticsEntityEvents,
  loadStatisticsFilterDrops,
  loadStatisticsFilterFlags,
  loadStatisticsSummary,
} from './statistics.actions';
import {
  selectChatIo,
  selectClientChatIo,
  selectClientEntityEvents,
  selectClientFilterDrops,
  selectClientFilterFlags,
  selectClientSummary,
  selectEntityEvents,
  selectFilterDrops,
  selectFilterFlags,
  selectLoadingChatIo,
  selectLoadingClientChatIo,
  selectLoadingClientEntityEvents,
  selectLoadingClientFilterDrops,
  selectLoadingClientFilterFlags,
  selectLoadingClientSummary,
  selectLoadingEntityEvents,
  selectLoadingFilterDrops,
  selectLoadingFilterFlags,
  selectLoadingSummary,
  selectStatisticsError,
  selectSummary,
} from './statistics.selectors';
import type {
  StatisticsAggregateParams,
  StatisticsChatIoListDto,
  StatisticsClientScopeParams,
  StatisticsEntityEventListDto,
  StatisticsFilterDropListDto,
  StatisticsFilterFlagListDto,
  StatisticsSummaryDto,
} from './statistics.types';

/**
 * Facade for statistics state management (API statistics).
 * Separate from StatsFacade which handles container stats (socket).
 */
@Injectable({
  providedIn: 'root',
})
export class StatisticsFacade {
  private readonly store = inject(Store);

  // Aggregate state
  readonly summary$: Observable<StatisticsSummaryDto | null> = this.store.select(selectSummary);
  readonly chatIo$: Observable<StatisticsChatIoListDto | null> = this.store.select(selectChatIo);
  readonly filterDrops$: Observable<StatisticsFilterDropListDto | null> = this.store.select(selectFilterDrops);
  readonly filterFlags$: Observable<StatisticsFilterFlagListDto | null> = this.store.select(selectFilterFlags);
  readonly entityEvents$: Observable<StatisticsEntityEventListDto | null> = this.store.select(selectEntityEvents);
  readonly loadingSummary$: Observable<boolean> = this.store.select(selectLoadingSummary);
  readonly loadingChatIo$: Observable<boolean> = this.store.select(selectLoadingChatIo);
  readonly loadingFilterDrops$: Observable<boolean> = this.store.select(selectLoadingFilterDrops);
  readonly loadingFilterFlags$: Observable<boolean> = this.store.select(selectLoadingFilterFlags);
  readonly loadingEntityEvents$: Observable<boolean> = this.store.select(selectLoadingEntityEvents);
  readonly error$: Observable<string | null> = this.store.select(selectStatisticsError);

  /** Client-scoped: load summary */
  loadClientSummary(clientId: string, params?: { from?: string; to?: string; groupBy?: 'day' | 'hour' }): void {
    this.store.dispatch(loadClientStatisticsSummary({ clientId, params }));
  }

  /** Client-scoped: load chat I/O */
  loadClientChatIo(params: StatisticsClientScopeParams): void {
    this.store.dispatch(loadClientStatisticsChatIo({ params }));
  }

  /** Client-scoped: load filter drops */
  loadClientFilterDrops(params: StatisticsClientScopeParams): void {
    this.store.dispatch(loadClientStatisticsFilterDrops({ params }));
  }

  /** Client-scoped: load filter flags */
  loadClientFilterFlags(params: StatisticsClientScopeParams): void {
    this.store.dispatch(loadClientStatisticsFilterFlags({ params }));
  }

  /** Client-scoped: load entity events */
  loadClientEntityEvents(params: StatisticsClientScopeParams): void {
    this.store.dispatch(loadClientStatisticsEntityEvents({ params }));
  }

  /** Aggregate: load summary */
  loadSummary(params?: StatisticsAggregateParams): void {
    this.store.dispatch(loadStatisticsSummary({ params }));
  }

  /** Aggregate: load chat I/O */
  loadChatIo(params?: StatisticsAggregateParams): void {
    this.store.dispatch(loadStatisticsChatIo({ params }));
  }

  /** Aggregate: load filter drops */
  loadFilterDrops(params?: StatisticsAggregateParams): void {
    this.store.dispatch(loadStatisticsFilterDrops({ params }));
  }

  /** Aggregate: load filter flags */
  loadFilterFlags(params?: StatisticsAggregateParams): void {
    this.store.dispatch(loadStatisticsFilterFlags({ params }));
  }

  /** Aggregate: load entity events */
  loadEntityEvents(params?: StatisticsAggregateParams): void {
    this.store.dispatch(loadStatisticsEntityEvents({ params }));
  }

  /** Client-scoped: get summary for client */
  getClientSummary$(clientId: string): Observable<StatisticsSummaryDto | undefined> {
    return this.store.select(selectClientSummary(clientId));
  }

  /** Client-scoped: get chat I/O for client */
  getClientChatIo$(clientId: string): Observable<StatisticsChatIoListDto | undefined> {
    return this.store.select(selectClientChatIo(clientId));
  }

  /** Client-scoped: get filter drops for client */
  getClientFilterDrops$(clientId: string): Observable<StatisticsFilterDropListDto | undefined> {
    return this.store.select(selectClientFilterDrops(clientId));
  }

  /** Client-scoped: get filter flags for client */
  getClientFilterFlags$(clientId: string): Observable<StatisticsFilterFlagListDto | undefined> {
    return this.store.select(selectClientFilterFlags(clientId));
  }

  /** Client-scoped: get entity events for client */
  getClientEntityEvents$(clientId: string): Observable<StatisticsEntityEventListDto | undefined> {
    return this.store.select(selectClientEntityEvents(clientId));
  }

  /** Client-scoped: loading state for summary */
  getLoadingClientSummary$(clientId: string): Observable<boolean> {
    return this.store.select(selectLoadingClientSummary(clientId));
  }

  /** Client-scoped: loading state for chat I/O */
  getLoadingClientChatIo$(clientId: string): Observable<boolean> {
    return this.store.select(selectLoadingClientChatIo(clientId));
  }

  /** Client-scoped: loading state for filter drops */
  getLoadingClientFilterDrops$(clientId: string): Observable<boolean> {
    return this.store.select(selectLoadingClientFilterDrops(clientId));
  }

  /** Client-scoped: loading state for filter flags */
  getLoadingClientFilterFlags$(clientId: string): Observable<boolean> {
    return this.store.select(selectLoadingClientFilterFlags(clientId));
  }

  /** Client-scoped: loading state for entity events */
  getLoadingClientEntityEvents$(clientId: string): Observable<boolean> {
    return this.store.select(selectLoadingClientEntityEvents(clientId));
  }
}
