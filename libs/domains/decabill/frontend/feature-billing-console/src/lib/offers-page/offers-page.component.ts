import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  OffersFacade,
  type CustomerOfferDetailResponse,
  type CustomerOfferListItem,
  type OffersSummaryResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { BehaviorSubject, debounceTime, distinctUntilChanged, map, of, skip, switchMap } from 'rxjs';

import { canCustomerRespondToOffer, getOfferStatusBadgeClass, getOfferStatusLabel } from '../billing-status-labels';
import { hideBillingModal, showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

type CustomerOffersMobilePanel = 'pending' | 'history';

@Component({
  selector: 'framework-billing-offers-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [DatePipe],
  templateUrl: './offers-page.component.html',
  styleUrls: ['./offers-page.component.scss'],
})
export class OffersPageComponent implements OnInit {
  @ViewChild('previewOfferModal', { static: false }) private previewOfferModal!: ElementRef<HTMLDivElement>;
  @ViewChild('declineConfirmModal', { static: false }) private declineConfirmModal!: ElementRef<HTMLDivElement>;

  private readonly destroyRef = inject(DestroyRef);
  private readonly offersFacade = inject(OffersFacade);
  private readonly datePipe = inject(DatePipe);

  readonly mobilePanels: CustomerOffersMobilePanel[] = ['pending', 'history'];
  readonly mobilePanel = signal<CustomerOffersMobilePanel>('pending');
  readonly pendingSearch = signal('');
  readonly historySearch = signal('');
  readonly pendingSearch$ = toObservable(this.pendingSearch);
  readonly historySearch$ = toObservable(this.historySearch);

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

  pendingDeclineOfferId: string | null = null;

  ngOnInit(): void {
    this.offersFacade.loadOffersSummary();
    this.offersFacade.loadPendingOffers();
    this.offersFacade.loadHistoryOffers();

    this.pendingSearch$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.offersFacade.loadPendingOffers({ search: search.trim() || undefined });
      });

    this.historySearch$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.offersFacade.loadHistoryOffers({ search: search.trim() || undefined });
      });

    watchBillingMutationModalClose({
      loading$: this.respondingOfferId$.pipe(map((id) => id !== null)),
      error$: this.offersError$,
      modal: () => this.previewOfferModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        hideBillingModal(this.previewOfferModal);
      },
    });
  }

  onPendingSearchChange(value: string): void {
    this.pendingSearch.set(value);
  }

  onHistorySearchChange(value: string): void {
    this.historySearch.set(value);
  }

  openPreview(offer: CustomerOfferListItem): void {
    this.previewOfferId$.next(offer.id);
    this.offersFacade.loadOfferDetails(offer.id);
    showBillingModal(this.previewOfferModal);
  }

  acceptOffer(offerId: string): void {
    this.offersFacade.acceptOffer(offerId);
  }

  openDeclineConfirm(offerId: string): void {
    this.pendingDeclineOfferId = offerId;
    showBillingModal(this.declineConfirmModal);
  }

  confirmDecline(): void {
    if (!this.pendingDeclineOfferId) return;

    this.offersFacade.declineOffer(this.pendingDeclineOfferId);
    this.pendingDeclineOfferId = null;
    hideBillingModal(this.declineConfirmModal);
  }

  downloadOfferPdf(offer: CustomerOfferListItem): void {
    this.downloadPdfBlob(this.offersFacade.downloadOfferPdf(offer.id), `${offer.offerNumber ?? offer.id}.pdf`);
  }

  private downloadPdfBlob(source: ReturnType<OffersFacade['downloadOfferPdf']>, filename: string): void {
    source.subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');

        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
      },
    });
  }

  offerStatusLabel(status: string | null | undefined): string {
    return getOfferStatusLabel(status);
  }

  offerStatusBadgeClass(status: string | null | undefined): string {
    return getOfferStatusBadgeClass(status);
  }

  canRespond(status: string | null | undefined): boolean {
    return canCustomerRespondToOffer(status);
  }

  offerDisplayTitle(offer: CustomerOfferListItem): string {
    return offer.offerNumber?.trim() || getOfferStatusLabel(offer.status);
  }

  formatDate(value?: string | null): string {
    if (!value) return '—';

    return this.datePipe.transform(value, 'mediumDate') ?? '—';
  }

  mobilePanelLabel(panel: CustomerOffersMobilePanel): string {
    return panel === 'pending'
      ? $localize`:@@featureOffers-mobilePending:Pending`
      : $localize`:@@featureOffers-mobileHistory:History`;
  }

  previewCanRespond(detail: CustomerOfferDetailResponse | null): boolean {
    return !!detail && this.canRespond(detail.status);
  }
}
