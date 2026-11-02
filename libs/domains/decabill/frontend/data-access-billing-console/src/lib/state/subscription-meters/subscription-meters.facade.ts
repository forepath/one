import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type {
  CreateUsageMeterEntryDto,
  SubscriptionMeterSummary,
  UpdateUsageMeterEntryDto,
  UsageMeterEntryResponse,
} from '../../types/billing.types';

import {
  clearSubscriptionMeters,
  createMeterEntry,
  deleteMeterEntry,
  loadMeterEntries,
  loadSubscriptionMeters,
  updateMeterEntry,
} from './subscription-meters.actions';
import {
  selectSubscriptionMeterEntries,
  selectSubscriptionMeterEntriesPage,
  selectSubscriptionMeterEntriesPageSize,
  selectSubscriptionMeterEntriesTotal,
  selectSubscriptionMeterSummaries,
  selectSubscriptionMetersCreating,
  selectSubscriptionMetersDeleting,
  selectSubscriptionMetersError,
  selectSubscriptionMetersLoadingAny,
  selectSubscriptionMetersLoadingEntries,
  selectSubscriptionMetersLoadingSummaries,
  selectSubscriptionMetersSubscriptionId,
  selectSubscriptionMetersUpdating,
} from './subscription-meters.selectors';

@Injectable({
  providedIn: 'root',
})
export class SubscriptionMetersFacade {
  private readonly store = inject(Store);

  readonly summaries$ = this.store.select(selectSubscriptionMeterSummaries);
  readonly entries$ = this.store.select(selectSubscriptionMeterEntries);
  readonly entriesTotal$ = this.store.select(selectSubscriptionMeterEntriesTotal);
  readonly entriesPage$ = this.store.select(selectSubscriptionMeterEntriesPage);
  readonly entriesPageSize$ = this.store.select(selectSubscriptionMeterEntriesPageSize);
  readonly subscriptionId$ = this.store.select(selectSubscriptionMetersSubscriptionId);
  readonly loadingSummaries$ = this.store.select(selectSubscriptionMetersLoadingSummaries);
  readonly loadingEntries$ = this.store.select(selectSubscriptionMetersLoadingEntries);
  readonly creating$ = this.store.select(selectSubscriptionMetersCreating);
  readonly updating$ = this.store.select(selectSubscriptionMetersUpdating);
  readonly deleting$ = this.store.select(selectSubscriptionMetersDeleting);
  readonly error$ = this.store.select(selectSubscriptionMetersError);
  readonly loadingAny$ = this.store.select(selectSubscriptionMetersLoadingAny);

  getSummaries$(): Observable<SubscriptionMeterSummary[]> {
    return this.summaries$;
  }

  getEntries$(): Observable<UsageMeterEntryResponse[]> {
    return this.entries$;
  }

  loadSummaries(subscriptionId: string): void {
    this.store.dispatch(loadSubscriptionMeters({ subscriptionId }));
  }

  /** One page of the meter entries (page 1 by default); the page replaces the current rows. */
  loadEntries(subscriptionId: string, page?: number, pageSize?: number): void {
    this.store.dispatch(loadMeterEntries({ subscriptionId, page, pageSize }));
  }

  /** Summaries + one page of the entries. */
  loadAll(subscriptionId: string, page?: number, pageSize?: number): void {
    this.loadSummaries(subscriptionId);
    this.loadEntries(subscriptionId, page, pageSize);
  }

  createEntry(subscriptionId: string, entry: CreateUsageMeterEntryDto): void {
    this.store.dispatch(createMeterEntry({ subscriptionId, entry }));
  }

  updateEntry(subscriptionId: string, entryId: string, entry: UpdateUsageMeterEntryDto): void {
    this.store.dispatch(updateMeterEntry({ subscriptionId, entryId, entry }));
  }

  deleteEntry(subscriptionId: string, entryId: string): void {
    this.store.dispatch(deleteMeterEntry({ subscriptionId, entryId }));
  }

  clear(): void {
    this.store.dispatch(clearSubscriptionMeters());
  }
}
