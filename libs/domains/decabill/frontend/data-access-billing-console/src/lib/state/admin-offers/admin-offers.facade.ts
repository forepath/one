import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { take } from 'rxjs';

import { BILLING_LIST_PAGE_SIZE, billingPageWindow } from '../../constants/list-paging.constants';

import type { AdminOfferStatisticsParams, CreateAdminOfferDto, UpdateAdminOfferDto } from '../../types/offers.types';

import {
  archiveAdminOffer,
  createAdminOffer,
  deleteAdminOffer,
  loadAdminOfferAuditLogs,
  loadAdminOfferStatistics,
  loadAdminOffers,
  revokeAdminOffer,
  updateAdminOffer,
} from './admin-offers.actions';
import {
  selectAdminOfferAuditLogsError,
  selectAdminOfferAuditLogsForOffer,
  selectAdminOfferAuditLogsLoading,
  selectAdminOfferAuditLogsOffsetByOffer,
  selectAdminOfferAuditLogsTotalForOffer,
  selectAdminOfferStatistics,
  selectAdminOfferStatisticsError,
  selectAdminOfferStatisticsLoading,
  selectAdminOffers,
  selectAdminOffersArchiving,
  selectAdminOffersCreating,
  selectAdminOffersDeleting,
  selectAdminOffersError,
  selectAdminOffersPage,
  selectAdminOffersPageSize,
  selectAdminOffersTotal,
  selectAdminOffersLoading,
  selectAdminOffersMutating,
  selectAdminOffersRevoking,
  selectAdminOffersState,
  selectAdminOffersUpdating,
} from './admin-offers.selectors';

@Injectable()
export class AdminOffersFacade {
  private readonly store = inject(Store);

  readonly offers$ = this.store.select(selectAdminOffers);
  readonly loading$ = this.store.select(selectAdminOffersLoading);
  readonly creating$ = this.store.select(selectAdminOffersCreating);
  readonly updating$ = this.store.select(selectAdminOffersUpdating);
  readonly deleting$ = this.store.select(selectAdminOffersDeleting);
  readonly archiving$ = this.store.select(selectAdminOffersArchiving);
  readonly revoking$ = this.store.select(selectAdminOffersRevoking);
  readonly mutating$ = this.store.select(selectAdminOffersMutating);
  readonly error$ = this.store.select(selectAdminOffersError);
  readonly total$ = this.store.select(selectAdminOffersTotal);
  readonly page$ = this.store.select(selectAdminOffersPage);
  readonly pageSize$ = this.store.select(selectAdminOffersPageSize);

  readonly statistics$ = this.store.select(selectAdminOfferStatistics);
  readonly statisticsLoading$ = this.store.select(selectAdminOfferStatisticsLoading);
  readonly statisticsError$ = this.store.select(selectAdminOfferStatisticsError);

  readonly auditLogsLoading$ = this.store.select(selectAdminOfferAuditLogsLoading);
  readonly auditLogsError$ = this.store.select(selectAdminOfferAuditLogsError);
  readonly auditLogsOffsetByOffer$ = this.store.select(selectAdminOfferAuditLogsOffsetByOffer);

  /** Loads page 1 (or the given page) of the filtered offers; the page replaces the current rows. */
  loadOffers(params?: { search?: string; userId?: string; page?: number; pageSize?: number }): void {
    this.store.dispatch(
      loadAdminOffers({
        search: params?.search,
        userId: params?.userId,
        page: params?.page,
        pageSize: params?.pageSize,
      }),
    );
  }

  /** Loads another page of the current filter (replace-page). */
  loadPage(page: number, pageSize?: number): void {
    this.store
      .select(selectAdminOffersState)
      .pipe(take(1))
      .subscribe((state) =>
        this.store.dispatch(
          loadAdminOffers({
            search: state.search ?? undefined,
            userId: state.userId ?? undefined,
            page,
            pageSize: pageSize ?? state.pageSize,
          }),
        ),
      );
  }

  loadStatistics(params: AdminOfferStatisticsParams): void {
    this.store.dispatch(loadAdminOfferStatistics({ params }));
  }

  createOffer(dto: CreateAdminOfferDto): void {
    this.store.dispatch(createAdminOffer({ dto }));
  }

  updateOffer(id: string, dto: UpdateAdminOfferDto): void {
    this.store.dispatch(updateAdminOffer({ id, dto }));
  }

  deleteOffer(id: string): void {
    this.store.dispatch(deleteAdminOffer({ id }));
  }

  archiveOffer(id: string): void {
    this.store.dispatch(archiveAdminOffer({ id }));
  }

  revokeOffer(id: string): void {
    this.store.dispatch(revokeAdminOffer({ id }));
  }

  /** One page of an offer's audit log (replace-page; 1-based page, 25 by default). */
  loadAuditLogs(offerId: string, page = 1, pageSize = BILLING_LIST_PAGE_SIZE): void {
    const window = billingPageWindow(page, pageSize);

    this.store.dispatch(loadAdminOfferAuditLogs({ offerId, limit: window.limit, offset: window.offset }));
  }

  getAuditLogsForOffer$(offerId: string) {
    return this.store.select(selectAdminOfferAuditLogsForOffer(offerId));
  }

  getAuditLogsTotal$(offerId: string) {
    return this.store.select(selectAdminOfferAuditLogsTotalForOffer(offerId));
  }
}
