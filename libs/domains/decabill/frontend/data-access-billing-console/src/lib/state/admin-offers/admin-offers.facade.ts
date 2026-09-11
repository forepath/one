import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import type { AdminOfferStatisticsParams, CreateAdminOfferDto, UpdateAdminOfferDto } from '../../types/offers.types';

import {
  archiveAdminOffer,
  createAdminOffer,
  deleteAdminOffer,
  loadAdminOfferAuditLogs,
  loadAdminOfferStatistics,
  loadAdminOffers,
  loadMoreAdminOfferAuditLogs,
  revokeAdminOffer,
  updateAdminOffer,
} from './admin-offers.actions';
import {
  selectAdminOfferAuditLogsAppendLoading,
  selectAdminOfferAuditLogsError,
  selectAdminOfferAuditLogsForOffer,
  selectAdminOfferAuditLogsHasMore,
  selectAdminOfferAuditLogsLoading,
  selectAdminOfferAuditLogsOffsetByOffer,
  selectAdminOfferStatistics,
  selectAdminOfferStatisticsError,
  selectAdminOfferStatisticsLoading,
  selectAdminOffers,
  selectAdminOffersArchiving,
  selectAdminOffersCreating,
  selectAdminOffersDeleting,
  selectAdminOffersError,
  selectAdminOffersLoading,
  selectAdminOffersMutating,
  selectAdminOffersRevoking,
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

  readonly statistics$ = this.store.select(selectAdminOfferStatistics);
  readonly statisticsLoading$ = this.store.select(selectAdminOfferStatisticsLoading);
  readonly statisticsError$ = this.store.select(selectAdminOfferStatisticsError);

  readonly auditLogsLoading$ = this.store.select(selectAdminOfferAuditLogsLoading);
  readonly auditLogsAppendLoading$ = this.store.select(selectAdminOfferAuditLogsAppendLoading);
  readonly auditLogsError$ = this.store.select(selectAdminOfferAuditLogsError);
  readonly auditLogsOffsetByOffer$ = this.store.select(selectAdminOfferAuditLogsOffsetByOffer);

  loadOffers(params?: { search?: string; userId?: string }): void {
    this.store.dispatch(loadAdminOffers({ search: params?.search, userId: params?.userId }));
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

  loadAuditLogs(offerId: string): void {
    this.store.dispatch(loadAdminOfferAuditLogs({ offerId }));
  }

  loadMoreAuditLogs(offerId: string, offset: number): void {
    this.store.dispatch(loadMoreAdminOfferAuditLogs({ offerId, offset }));
  }

  getAuditLogsForOffer$(offerId: string) {
    return this.store.select(selectAdminOfferAuditLogsForOffer(offerId));
  }

  getAuditLogsHasMore$(offerId: string) {
    return this.store.select(selectAdminOfferAuditLogsHasMore(offerId));
  }
}
