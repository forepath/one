import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type { BackorderCancelDto, BackorderRetryDto, BackorderResponse, ListParams } from '../../types/billing.types';

import { cancelBackorder, clearSelectedBackorder, loadBackorders, retryBackorder } from './backorders.actions';
import {
  selectBackorderById,
  selectBackordersByStatus,
  selectBackordersCanceling,
  selectBackordersCount,
  selectBackordersEntities,
  selectBackordersError,
  selectBackordersLoading,
  selectBackordersLoadingAny,
  selectBackordersRetrying,
  selectHasBackorders,
  selectPendingBackorders,
  selectSelectedBackorder,
} from './backorders.selectors';

@Injectable({
  providedIn: 'root',
})
export class BackordersFacade {
  private readonly store = inject(Store);

  getBackorders$(): Observable<BackorderResponse[]> {
    return this.store.select(selectBackordersEntities);
  }

  getSelectedBackorder$(): Observable<BackorderResponse | null> {
    return this.store.select(selectSelectedBackorder);
  }

  getBackordersLoading$(): Observable<boolean> {
    return this.store.select(selectBackordersLoading);
  }

  getBackordersRetrying$(): Observable<boolean> {
    return this.store.select(selectBackordersRetrying);
  }

  getBackordersCanceling$(): Observable<boolean> {
    return this.store.select(selectBackordersCanceling);
  }

  getBackordersLoadingAny$(): Observable<boolean> {
    return this.store.select(selectBackordersLoadingAny);
  }

  getBackordersError$(): Observable<string | null> {
    return this.store.select(selectBackordersError);
  }

  getBackordersCount$(): Observable<number> {
    return this.store.select(selectBackordersCount);
  }

  hasBackorders$(): Observable<boolean> {
    return this.store.select(selectHasBackorders);
  }

  getBackorderById$(id: string): Observable<BackorderResponse | undefined> {
    return this.store.select(selectBackorderById(id));
  }

  getBackordersByStatus$(status: string): Observable<BackorderResponse[]> {
    return this.store.select(selectBackordersByStatus(status));
  }

  getPendingBackorders$(): Observable<BackorderResponse[]> {
    return this.store.select(selectPendingBackorders);
  }

  loadBackorders(params?: ListParams): void {
    this.store.dispatch(loadBackorders({ params }));
  }

  retryBackorder(id: string, dto?: BackorderRetryDto): void {
    this.store.dispatch(retryBackorder({ id, dto }));
  }

  cancelBackorder(id: string, dto?: BackorderCancelDto): void {
    this.store.dispatch(cancelBackorder({ id, dto }));
  }

  clearSelectedBackorder(): void {
    this.store.dispatch(clearSelectedBackorder());
  }
}
