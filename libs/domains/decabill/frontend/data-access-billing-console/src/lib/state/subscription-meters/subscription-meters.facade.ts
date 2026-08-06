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

  loadEntries(subscriptionId: string): void {
    this.store.dispatch(loadMeterEntries({ subscriptionId }));
  }

  loadAll(subscriptionId: string): void {
    this.loadSummaries(subscriptionId);
    this.loadEntries(subscriptionId);
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
