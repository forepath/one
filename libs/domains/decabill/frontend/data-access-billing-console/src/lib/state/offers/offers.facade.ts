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
  selectHistoryOffersTotal,
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
  selectPendingOffersTotal,
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

  getPendingTotal$(): Observable<number> {
    return this.store.select(selectPendingOffersTotal);
  }

  /** One page of the pending offers (replace-page; page 1 by default). */
  loadPendingOffers(options?: { silent?: boolean; search?: string; page?: number; pageSize?: number }): void {
    this.store.dispatch(
      loadPendingOffers({
        silent: options?.silent === true,
        search: options?.search,
        page: options?.page,
        pageSize: options?.pageSize,
      }),
    );
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

  getHistoryTotal$(): Observable<number> {
    return this.store.select(selectHistoryOffersTotal);
  }

  /** One page of the history offers (replace-page; page 1 by default). */
  loadHistoryOffers(options?: { silent?: boolean; search?: string; page?: number; pageSize?: number }): void {
    this.store.dispatch(
      loadHistoryOffers({
        silent: options?.silent === true,
        search: options?.search,
        page: options?.page,
        pageSize: options?.pageSize,
      }),
    );
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
