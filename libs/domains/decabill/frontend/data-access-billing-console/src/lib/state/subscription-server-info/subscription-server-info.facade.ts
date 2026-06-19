import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import { loadOverviewServerInfo, restartServer, startServer, stopServer } from './subscription-server-info.actions';
import type { ServerActionType } from './subscription-server-info.reducer';
import type { SubscriptionWithServerInfo } from './subscription-server-info.selectors';
import {
  selectOverviewServerInfoError,
  selectOverviewServerInfoLoading,
  selectServerActionInProgress,
  selectServerActionInProgressForSubscriptionId,
  selectSubscriptionsWithServerInfo,
} from './subscription-server-info.selectors';

@Injectable({
  providedIn: 'root',
})
export class SubscriptionServerInfoFacade {
  private readonly store = inject(Store);

  getSubscriptionsWithServerInfo$(): Observable<SubscriptionWithServerInfo[]> {
    return this.store.select(selectSubscriptionsWithServerInfo);
  }

  getOverviewServerInfoLoading$(): Observable<boolean> {
    return this.store.select(selectOverviewServerInfoLoading);
  }

  getOverviewServerInfoError$(): Observable<string | null> {
    return this.store.select(selectOverviewServerInfoError);
  }

  getServerActionInProgress$(subscriptionId: string): Observable<ServerActionType | undefined> {
    return this.store.select(selectServerActionInProgressForSubscriptionId(subscriptionId));
  }

  getServerActionInProgressMap$(): Observable<Record<string, ServerActionType>> {
    return this.store.select(selectServerActionInProgress);
  }

  loadOverviewServerInfo(): void {
    this.store.dispatch(loadOverviewServerInfo());
  }

  startServer(subscriptionId: string, itemId: string): void {
    this.store.dispatch(startServer({ subscriptionId, itemId }));
  }

  stopServer(subscriptionId: string, itemId: string): void {
    this.store.dispatch(stopServer({ subscriptionId, itemId }));
  }

  restartServer(subscriptionId: string, itemId: string): void {
    this.store.dispatch(restartServer({ subscriptionId, itemId }));
  }
}
