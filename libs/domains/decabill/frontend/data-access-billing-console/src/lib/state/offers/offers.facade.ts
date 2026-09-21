import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import { OffersService } from '../../services/offers.service';
import type {
  CustomerOfferDetailResponse,
  CustomerOfferListItem,
  OffersSummaryResponse,
} from '../../types/offers.types';

import {
  acceptOffer,
  clearOffers,
  declineOffer,
  loadHistoryOffers,
  loadOfferDetails,
  loadOffersSummary as loadOffersSummaryAction,
  loadPendingOffers,
} from './offers.actions';
import {
  selectHistoryOffersList,
  selectHistoryOffersListError,
  selectHistoryOffersListLoading,
  selectOfferDetailById,
  selectOfferDetailsLoading,
  selectOffersError,
  selectOffersPendingBadgeCount,
  selectOffersSummary,
  selectOffersSummaryError,
  selectOffersSummaryLoading,
  selectPendingOffersList,
  selectPendingOffersListError,
  selectPendingOffersListLoading,
  selectRespondingOfferId,
} from './offers.selectors';

@Injectable({
  providedIn: 'root',
})
export class OffersFacade {
  private readonly store = inject(Store);
  private readonly offersService = inject(OffersService);

  getOffersSummary$(): Observable<OffersSummaryResponse | null> {
    return this.store.select(selectOffersSummary);
  }

  getOffersSummaryLoading$(): Observable<boolean> {
    return this.store.select(selectOffersSummaryLoading);
  }

  getOffersSummaryError$(): Observable<string | null> {
    return this.store.select(selectOffersSummaryError);
  }

  getPendingBadgeCount$(): Observable<number> {
    return this.store.select(selectOffersPendingBadgeCount);
  }

  loadOffersSummary(options?: { silent?: boolean }): void {
    this.store.dispatch(loadOffersSummaryAction(options?.silent === true));
  }

  getPendingList$(): Observable<CustomerOfferListItem[]> {
    return this.store.select(selectPendingOffersList);
  }

  getPendingListLoading$(): Observable<boolean> {
    return this.store.select(selectPendingOffersListLoading);
  }

  getPendingListError$(): Observable<string | null> {
    return this.store.select(selectPendingOffersListError);
  }

  loadPendingOffers(options?: { silent?: boolean; search?: string }): void {
    this.store.dispatch(loadPendingOffers({ silent: options?.silent === true, search: options?.search }));
  }

  getHistoryList$(): Observable<CustomerOfferListItem[]> {
    return this.store.select(selectHistoryOffersList);
  }

  getHistoryListLoading$(): Observable<boolean> {
    return this.store.select(selectHistoryOffersListLoading);
  }

  getHistoryListError$(): Observable<string | null> {
    return this.store.select(selectHistoryOffersListError);
  }

  loadHistoryOffers(options?: { silent?: boolean; search?: string }): void {
    this.store.dispatch(loadHistoryOffers({ silent: options?.silent === true, search: options?.search }));
  }

  getOfferDetailsLoading$(): Observable<boolean> {
    return this.store.select(selectOfferDetailsLoading);
  }

  getOfferDetail$(offerId: string): Observable<CustomerOfferDetailResponse | null> {
    return this.store.select(selectOfferDetailById(offerId));
  }

  getRespondingOfferId$(): Observable<string | null> {
    return this.store.select(selectRespondingOfferId);
  }

  getOffersError$(): Observable<string | null> {
    return this.store.select(selectOffersError);
  }

  loadOfferDetails(offerId: string, options?: { silent?: boolean }): void {
    this.store.dispatch(loadOfferDetails({ offerId, silent: options?.silent === true }));
  }

  acceptOffer(offerId: string): void {
    this.store.dispatch(acceptOffer({ offerId }));
  }

  declineOffer(offerId: string): void {
    this.store.dispatch(declineOffer({ offerId }));
  }

  downloadOfferPdf(offerId: string): Observable<Blob> {
    return this.offersService.downloadOfferPdf(offerId);
  }

  clearOffers(): void {
    this.store.dispatch(clearOffers());
  }
}
