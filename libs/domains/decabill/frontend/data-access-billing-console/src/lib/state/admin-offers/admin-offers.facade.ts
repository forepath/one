import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { take } from 'rxjs';

import { BILLING_LIST_PAGE_SIZE, billingPageWindow } from '../../constants/list-paging.constants';
import type {
  AcceptAdminOfferDto,
  AdminOfferStatisticsParams,
  ArchiveAdminOfferDto,
  CreateAdminOfferDto,
  DeclineAdminOfferDto,
  RevokeAdminOfferDto,
  UpdateAdminOfferDto,
} from '../../types/offers.types';
import type { MarkDocumentSentDto, SpooledDeliveryChannel } from '../../types/spooler.types';

import {
  acceptAdminOffer,
  archiveAdminOffer,
  createAdminOffer,
  declineAdminOffer,
  deleteAdminOffer,
  loadAdminOfferAuditLogs,
  loadAdminOfferStatistics,
  loadAdminOffers,
  revokeAdminOffer,
  sendAdminOffer,
  markAdminOfferSent,
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
  selectAdminOffersResponding,
  selectAdminOffersRevoking,
  selectAdminOffersSending,
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
  readonly sending$ = this.store.select(selectAdminOffersSending);
  readonly revoking$ = this.store.select(selectAdminOffersRevoking);
  readonly responding$ = this.store.select(selectAdminOffersResponding);
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

  /**
   * Finalizes a draft; `dto.notifyCustomer: false` archives it without sending it yet, `sendLetter` archives it without
   * email and sends it as a letter.
   */
  archiveOffer(id: string, dto?: ArchiveAdminOfferDto, sendLetter = false): void {
    this.store.dispatch(archiveAdminOffer({ id, dto, ...(sendLetter ? { sendLetter } : {}) }));
  }

  /** Sends an offer that was archived without notification (email by default, or a letter); spooled. */
  sendOffer(id: string, channel: SpooledDeliveryChannel = 'email'): void {
    this.store.dispatch(sendAdminOffer({ id, channel }));
  }

  /** Records that an offer was sent outside Decabill. */
  markOfferSent(id: string, dto?: MarkDocumentSentDto): void {
    this.store.dispatch(markAdminOfferSent({ id, ...(dto ? { dto } : {}) }));
  }

  revokeOffer(id: string, dto?: RevokeAdminOfferDto): void {
    this.store.dispatch(revokeAdminOffer({ id, dto }));
  }

  /** Records the customer's acceptance given outside the system (phone, signed copy, ...). */
  acceptOffer(id: string, dto?: AcceptAdminOfferDto): void {
    this.store.dispatch(acceptAdminOffer({ id, dto }));
  }

  /** Records the customer's decline given outside the system. */
  declineOffer(id: string, dto?: DeclineAdminOfferDto): void {
    this.store.dispatch(declineAdminOffer({ id, dto }));
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
