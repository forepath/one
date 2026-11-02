import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  OffersFacade,
  type CustomerOfferDetailResponse,
  type CustomerOfferListItem,
  type OffersSummaryResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcMoneyPipe,
  FpcPageHeaderComponent,
  fpcRunBulk,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcBadgeTone,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { BehaviorSubject, firstValueFrom, map, of, switchMap } from 'rxjs';

import { canCustomerRespondToOffer, getOfferStatusBadgeTone, getOfferStatusLabel } from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { dbBulkSummary, type DbBulkResult } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';
import { offerState } from '../shared/table-states';
import { getUnnumberedOfferLabel } from '../named-label.util';
import { formatBillingDate, formatBillingMoney } from '../billing-format';

type CustomerOffersTab = 'pending' | 'history';

@Component({
  selector: 'framework-billing-offers-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcDataTableComponent,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcSummaryCardValueDirective,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcEmptyStateComponent,
    FpcConfirmDialogComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcMoneyPipe,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
  ],
  providers: [DatePipe],
  templateUrl: './offers-page.component.html',
  styleUrls: ['./offers-page.component.scss'],
})
export class OffersPageComponent implements OnInit {
  readonly previewOfferModalOpen = signal(false);
  readonly declineConfirmModalOpen = signal(false);

  private readonly destroyRef = inject(DestroyRef);
  private readonly offersFacade = inject(OffersFacade);
  private readonly datePipe = inject(DatePipe);

  readonly activeTab = signal<CustomerOffersTab>('pending');
  readonly searchPendingPlaceholder = $localize`:@@featureOffers-searchPending:Search pending offers`;
  readonly searchHistoryPlaceholder = $localize`:@@featureOffers-searchHistory:Search offer history`;
  readonly downloadPdfsLabel = $localize`:@@featureOffers-bulkDownload:Download PDFs`;
  readonly columns: FpcTableColumn<CustomerOfferListItem>[] = [
    {
      id: 'status',
      label: $localize`:@@featureOffers-colStatus:Status`,
      type: 'state',
      state: (offer) => offerState(offer.status),
    },
    {
      id: 'name',
      label: $localize`:@@featureOffers-colOffer:Offer`,
      value: (offer) => this.offerDisplayTitle(offer),
      required: true,
      priority: 1,
    },
    {
      id: 'total',
      label: $localize`:@@featureOffers-colTotal:Total (gross)`,
      value: (offer) => offer.totalGross,
      align: 'end',
      priority: 1,
    },
    {
      id: 'expires',
      label: $localize`:@@featureOffers-colExpires:Expires`,
      value: (offer) => offer.expiresAt ?? '',
      priority: 2,
    },
  ];
  readonly rowMenu = (): FpcMenuItem[] => [
    { id: 'preview', label: $localize`:@@featureOffers-previewButtonTitle:Preview offer`, icon: 'eye' },
    { id: 'download', label: $localize`:@@featureOffers-downloadButtonTitle:Download PDF`, icon: 'file-earmark-pdf' },
  ];
  readonly selected = signal<readonly string[]>([]);
  readonly bulkResult = signal<DbBulkResult | null>(null);
  readonly selectedOffers = computed(() => {
    const ids = new Set(this.selected());
    const rows = this.activeTab() === 'pending' ? this.pendingList() : this.historyList();

    return rows.filter((offer) => ids.has(offer.id));
  });
  /** Pending tab → `GET /offers/pending?limit&offset&search` (replace-page; only while the tab is shown). */
  readonly pendingPaging = dbServerPaging(
    (query) => {
      if (untracked(this.activeTab) === 'pending') this.offersFacade.loadPendingOffers(query);
    },
    { url: 'pend-' },
  );
  /** History tab → `GET /offers/history?limit&offset&search` (replace-page; only while the tab is shown). */
  readonly historyPaging = dbServerPaging(
    (query) => {
      if (untracked(this.activeTab) === 'history') this.offersFacade.loadHistoryOffers(query);
    },
    { url: 'hist-' },
  );

  readonly previewOfferId$ = new BehaviorSubject<string | null>(null);
  readonly previewDetail$ = this.previewOfferId$.pipe(
    switchMap((offerId) => (offerId ? this.offersFacade.getOfferDetail$(offerId) : of(null))),
  );

  readonly pendingList = toSignal(this.offersFacade.getPendingList$(), {
    initialValue: [] as CustomerOfferListItem[],
  });
  readonly historyList = toSignal(this.offersFacade.getHistoryList$(), {
    initialValue: [] as CustomerOfferListItem[],
  });
  readonly pendingTotal = toSignal(this.offersFacade.getPendingTotal$(), { initialValue: 0 });
  readonly historyTotal = toSignal(this.offersFacade.getHistoryTotal$(), { initialValue: 0 });
  readonly offersSummary = toSignal(this.offersFacade.getOffersSummary$(), {
    initialValue: null as OffersSummaryResponse | null,
  });

  readonly offersSummary$ = this.offersFacade.getOffersSummary$();
  readonly offersSummaryLoading$ = this.offersFacade.getOffersSummaryLoading$();
  readonly pendingListLoading$ = this.offersFacade.getPendingListLoading$();
  readonly pendingListError$ = this.offersFacade.getPendingListError$();
  readonly historyListLoading$ = this.offersFacade.getHistoryListLoading$();
  readonly historyListError$ = this.offersFacade.getHistoryListError$();
  readonly offerDetailsLoading$ = this.offersFacade.getOfferDetailsLoading$();
  readonly respondingOfferId$ = this.offersFacade.getRespondingOfferId$();
  readonly offersError$ = this.offersFacade.getOffersError$();
  readonly pageTitle = $localize`:@@featureOffers-title:Offers`;
  readonly pendingCountLabel = $localize`:@@featureOffers-pendingCount:Pending offers`;
  readonly actionRequiredCountLabel = $localize`:@@featureOffers-actionRequiredCount:Action required`;
  readonly acceptedCountLabel = $localize`:@@featureOffers-acceptedCount:Accepted`;
  readonly historyCountLabel = $localize`:@@featureOffers-historyCount:History`;

  pendingDeclineOfferId: string | null = null;

  ngOnInit(): void {
    this.offersFacade.loadOffersSummary();

    watchBillingMutationModalClose({
      loading$: this.respondingOfferId$.pipe(map((id) => id !== null)),
      error$: this.offersError$,
      open: this.previewOfferModalOpen,
      destroyRef: this.destroyRef,
    });
  }

  constructor() {
    // A tab switch loads the shown tab's current page (the hidden tab does not query).
    let firstTab = true;

    effect(() => {
      const tab = this.activeTab();

      if (firstTab) {
        firstTab = false;

        return;
      }
      untracked(() => (tab === 'history' ? this.historyPaging : this.pendingPaging).reload());
    });
  }

  onRowAction(offer: CustomerOfferListItem, action: string): void {
    if (action === 'preview') this.openPreview(offer);
    else if (action === 'download') this.downloadOfferPdf(offer);
  }

  /** Bulk Download PDFs: one `GET /offers/:id/pdf` per selected offer, saved one by one. */
  async downloadSelected(): Promise<void> {
    const offers = this.selectedOffers();

    if (offers.length === 0) return;

    const result = await fpcRunBulk(
      offers,
      async (offer) => {
        const blob = await firstValueFrom(this.offersFacade.downloadOfferPdf(offer.id));

        this.saveBlob(blob, `${offer.offerNumber ?? offer.id}.pdf`);
      },
      1,
    );

    this.bulkResult.set(dbBulkSummary(result, (offer) => this.offerDisplayTitle(offer)));
    this.selected.set([]);
  }

  offerTotal(offer: CustomerOfferListItem): string {
    return formatBillingMoney(offer.totalGross, offer.currency);
  }

  offerExpiresAt(offer: CustomerOfferListItem): string | null | undefined {
    return offer.expiresAt;
  }

  openPreview(offer: CustomerOfferListItem): void {
    this.previewOfferId$.next(offer.id);
    this.offersFacade.loadOfferDetails(offer.id);
    showBillingModal(this.previewOfferModalOpen);
  }

  acceptOffer(offerId: string): void {
    this.offersFacade.acceptOffer(offerId);
  }

  openDeclineConfirm(offerId: string): void {
    this.pendingDeclineOfferId = offerId;
    showBillingModal(this.declineConfirmModalOpen);
  }

  confirmDecline(): void {
    if (!this.pendingDeclineOfferId) return;

    this.offersFacade.declineOffer(this.pendingDeclineOfferId);
    this.pendingDeclineOfferId = null;
  }

  downloadOfferPdf(offer: CustomerOfferListItem): void {
    this.downloadPdfBlob(this.offersFacade.downloadOfferPdf(offer.id), `${offer.offerNumber ?? offer.id}.pdf`);
  }

  private downloadPdfBlob(source: ReturnType<OffersFacade['downloadOfferPdf']>, filename: string): void {
    source.subscribe({ next: (blob) => this.saveBlob(blob, filename) });
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  offerStatusLabel(status: string | null | undefined): string {
    return getOfferStatusLabel(status);
  }

  offerStatusBadgeTone(status: string | null | undefined): FpcBadgeTone {
    return getOfferStatusBadgeTone(status);
  }

  canRespond(status: string | null | undefined): boolean {
    return canCustomerRespondToOffer(status);
  }

  offerDisplayTitle(offer: CustomerOfferListItem): string {
    return offer.offerNumber?.trim() || getUnnumberedOfferLabel();
  }

  formatDate(value?: string | null): string {
    if (!value) return '-';

    return formatBillingDate(value, '-');
  }

  onTabChange(tabId: string | null): void {
    if (tabId === 'pending' || tabId === 'history') {
      this.activeTab.set(tabId);
      this.selected.set([]);
    }
  }

  tabLabel(panel: CustomerOffersTab): string {
    return panel === 'pending'
      ? $localize`:@@featureOffers-mobilePending:Pending`
      : $localize`:@@featureOffers-mobileHistory:History`;
  }

  previewCanRespond(detail: CustomerOfferDetailResponse | null): boolean {
    return !!detail && this.canRespond(detail.status);
  }
}
