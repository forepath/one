import { CommonModule, DatePipe } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import {
  InvoicesFacade,
  SubscriptionsFacade,
  type CreateInvoiceDto,
  type InvoiceDetailResponse,
  type InvoiceResponse,
  type InvoicesSummaryResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { BehaviorSubject, combineLatest, filter, interval, map, Observable, of, switchMap, take } from 'rxjs';

import { getInvoiceStatusBadgeClass, getInvoiceStatusLabel } from '../billing-status-labels';
import { filterItemsBySearch } from '../billing-list-search';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { NextBillingDayPipe } from '../pipes/next-billing-day.pipe';

type CustomerBillingMobilePanel = 'openOverdue' | 'history';

type PaymentReturnFeedback = 'waiting' | 'confirmed' | 'canceled';

@Component({
  selector: 'framework-billing-invoices',
  standalone: true,
  imports: [CommonModule, FormsModule, NextBillingDayPipe],
  providers: [DatePipe],
  templateUrl: './invoices.component.html',
  styleUrls: ['./invoices.component.scss'],
})
export class InvoicesComponent implements OnInit {
  @ViewChild('createInvoiceModal', { static: false }) private createInvoiceModal!: ElementRef<HTMLDivElement>;
  @ViewChild('previewInvoiceModal', { static: false }) private previewInvoiceModal!: ElementRef<HTMLDivElement>;

  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly invoicesFacade = inject(InvoicesFacade);
  private readonly subscriptionsFacade = inject(SubscriptionsFacade);
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly datePipe = inject(DatePipe);

  readonly mobilePanels: CustomerBillingMobilePanel[] = ['openOverdue', 'history'];
  readonly mobilePanel = signal<CustomerBillingMobilePanel>('openOverdue');
  readonly openOverdueSearch = signal('');
  readonly historyInvoicesSearch = signal('');
  paymentReturnFeedback: PaymentReturnFeedback | null = null;

  readonly isAdmin$ = this.authFacade.canAccessBillingAdministration$;

  readonly subscriptions$ = this.subscriptionsFacade.getSubscriptions$();

  readonly selectedSubscriptionId$ = new BehaviorSubject<string>('');
  readonly previewInvoiceRefId$ = new BehaviorSubject<string | null>(null);
  readonly previewSubscriptionId$ = new BehaviorSubject<string | null>(null);

  readonly previewDetail$ = this.previewInvoiceRefId$.pipe(
    switchMap((refId) =>
      refId ? this.invoicesFacade.getInvoiceDetail$(refId) : of(null as InvoiceDetailResponse | null),
    ),
  );

  readonly openOverdueList = toSignal(this.invoicesFacade.getOpenOverdueList$(), {
    initialValue: [] as InvoiceResponse[],
  });

  readonly historyList = toSignal(this.invoicesFacade.getHistoryList$(), {
    initialValue: [] as InvoiceResponse[],
  });

  readonly filteredOpenOverdueList = computed(() =>
    filterItemsBySearch(this.openOverdueList(), this.openOverdueSearch(), (invoice) =>
      this.invoiceSearchHaystack(invoice),
    ),
  );

  readonly filteredHistoryList = computed(() =>
    filterItemsBySearch(this.historyList(), this.historyInvoicesSearch(), (invoice) =>
      this.invoiceSearchHaystack(invoice),
    ),
  );

  readonly invoicesCreating$ = this.invoicesFacade.getInvoicesCreating$();
  readonly invoicesError$ = this.invoicesFacade.getInvoicesError$();
  readonly payingInvoiceRefId$ = this.invoicesFacade.getPayingInvoiceRefId$();
  readonly invoiceDetailsLoading$ = this.invoicesFacade.getInvoiceDetailsLoading$();
  readonly invoicesSummary$ = this.invoicesFacade.getInvoicesSummary$();
  readonly invoicesSummary = toSignal(this.invoicesFacade.getInvoicesSummary$(), {
    initialValue: null as InvoicesSummaryResponse | null,
  });
  readonly invoicesSummaryLoading$ = this.invoicesFacade.getInvoicesSummaryLoading$();
  readonly openOverdueListLoading$ = this.invoicesFacade.getOpenOverdueListLoading$();
  readonly openOverdueListError$ = this.invoicesFacade.getOpenOverdueListError$();
  readonly historyListLoading$ = this.invoicesFacade.getHistoryListLoading$();
  readonly historyListError$ = this.invoicesFacade.getHistoryListError$();

  readonly selectedSubscription$ = combineLatest([this.subscriptions$, this.selectedSubscriptionId$]).pipe(
    map(([subscriptions, id]) => subscriptions.find((s) => s.id === id) ?? null),
  );

  readonly isCreateInvoiceDisabled$ = combineLatest([this.invoicesCreating$, this.selectedSubscription$]).pipe(
    map(([creating, sub]) => creating === true || (sub?.status === 'canceled' && sub?.nextBillingAt !== null)),
  );

  createInvoiceDescription = '';

  readonly createInvoiceDisabledTitle = $localize`:@@featureInvoices-createInvoiceDisabledFinalized:Subscription is finalized; no further invoices can be created.`;
  readonly payInvoiceTitle = $localize`:@@featureInvoices-payButtonTitle:Pay invoice`;
  private readonly defaultMinCheckoutPaymentAmount = 1;

  ngOnInit(): void {
    this.subscriptionsFacade.loadSubscriptions();
    this.invoicesFacade.loadInvoicesSummary();
    this.invoicesFacade.loadOpenOverdueInvoices();
    this.invoicesFacade.loadHistoryInvoices();
    this.handlePaymentReturnQueryParams();
    watchBillingMutationModalClose({
      loading$: this.invoicesCreating$,
      error$: this.invoicesError$,
      modal: () => this.createInvoiceModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.createInvoiceDescription = '';
      },
    });
  }

  private handlePaymentReturnQueryParams(): void {
    const queryParamMap = this.route.snapshot.queryParamMap;
    const paymentParam = queryParamMap.get('payment');
    const invoiceRefId = queryParamMap.get('invoiceRefId')?.trim() || null;
    const subscriptionId = queryParamMap.get('subscriptionId')?.trim() || undefined;

    if (paymentParam === 'success') {
      this.paymentReturnFeedback = 'waiting';
      this.startPaymentConfirmationPoll(subscriptionId, invoiceRefId);
    } else if (paymentParam === 'cancel') {
      this.paymentReturnFeedback = 'canceled';
    }

    if (paymentParam) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { payment: null, subscriptionId: null, invoiceRefId: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  private startPaymentConfirmationPoll(subscriptionId: string | undefined, invoiceRefId: string | null): void {
    this.refreshPaymentReturnData(subscriptionId, invoiceRefId);

    interval(3000)
      .pipe(
        take(20),
        filter(() => this.paymentReturnFeedback === 'waiting'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.refreshPaymentReturnData(subscriptionId, invoiceRefId);
      });

    if (!invoiceRefId) {
      return;
    }

    this.invoicesFacade
      .getInvoiceDetail$(invoiceRefId)
      .pipe(
        filter((detail) => this.isInvoicePaymentConfirmed(detail)),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        if (this.paymentReturnFeedback === 'waiting') {
          this.paymentReturnFeedback = 'confirmed';
          this.cdr.detectChanges();
        }
      });
  }

  private refreshPaymentReturnData(subscriptionId: string | undefined, invoiceRefId: string | null): void {
    const silent = { silent: true } as const;

    this.invoicesFacade.loadInvoicesSummary(silent);
    this.invoicesFacade.loadOpenOverdueInvoices(silent);
    this.invoicesFacade.loadHistoryInvoices(silent);

    if (invoiceRefId) {
      this.invoicesFacade.loadInvoiceDetails(subscriptionId, invoiceRefId, silent);
    }
  }

  private isInvoicePaymentConfirmed(detail: InvoiceDetailResponse | null): boolean {
    if (!detail) {
      return false;
    }

    return detail.status === 'paid' || Number(detail.balanceDue) <= 0;
  }

  onSelectSubscription(subscriptionId: string): void {
    const id = subscriptionId || '';

    this.selectedSubscriptionId$.next(id);

    if (id) {
      this.invoicesFacade.loadInvoices(id);
    }
  }

  onOpenOverdueSearchChange(value: string): void {
    this.openOverdueSearch.set(value);
  }

  onHistoryInvoicesSearchChange(value: string): void {
    this.historyInvoicesSearch.set(value);
  }

  openCreateInvoiceModal(): void {
    this.createInvoiceDescription = '';
    showBillingModal(this.createInvoiceModal);
  }

  onSubmitCreateInvoice(): void {
    const id = this.selectedSubscriptionId$.value;

    if (!id) return;

    const dto: CreateInvoiceDto | undefined = this.createInvoiceDescription?.trim()
      ? { description: this.createInvoiceDescription.trim() }
      : undefined;

    this.invoicesFacade.createInvoice(id, dto);
  }

  get selectedSubscriptionId(): string {
    return this.selectedSubscriptionId$.value;
  }
  set selectedSubscriptionId(value: string) {
    this.onSelectSubscription(value ?? '');
  }

  openPreview(subscriptionId: string | undefined, inv: InvoiceResponse): void {
    const resolvedSubscriptionId = subscriptionId ?? inv.subscriptionId ?? undefined;

    this.previewSubscriptionId$.next(resolvedSubscriptionId ?? null);
    this.previewInvoiceRefId$.next(inv.id);
    this.invoicesFacade.loadInvoiceDetails(resolvedSubscriptionId, inv.id);
    showBillingModal(this.previewInvoiceModal);
  }

  payInvoice(subscriptionId: string | undefined, inv: InvoiceResponse): void {
    if (!inv.canPay || this.isBelowMinimumPaymentAmount(inv)) return;

    const resolvedSubscriptionId = subscriptionId ?? inv.subscriptionId ?? undefined;

    this.invoicesFacade.initiatePayment(resolvedSubscriptionId, inv.id);
  }

  shouldShowPayButton(inv: InvoiceResponse): boolean {
    return inv.canPay || this.isBelowMinimumPaymentAmount(inv);
  }

  isPayButtonDisabled(inv: InvoiceResponse, payingInvoiceRefId: string | null): boolean {
    return !inv.canPay || payingInvoiceRefId === inv.id || this.isBelowMinimumPaymentAmount(inv);
  }

  isBelowMinimumPaymentAmount(inv: InvoiceResponse): boolean {
    const balance = Number(inv.balance ?? 0);

    return balance > 0 && balance < this.resolveMinCheckoutPaymentAmount();
  }

  payButtonTitle(inv: InvoiceResponse): string {
    if (this.isBelowMinimumPaymentAmount(inv)) {
      const min = this.resolveMinCheckoutPaymentAmount().toFixed(2);

      return $localize`:@@featureInvoices-payBelowMinimumTitle:Payment is only available for amounts of ${min}:min: or more.`;
    }

    return this.payInvoiceTitle;
  }

  private resolveMinCheckoutPaymentAmount(): number {
    const fromSummary = this.invoicesSummary()?.minCheckoutPaymentAmount;

    if (typeof fromSummary === 'number' && Number.isFinite(fromSummary) && fromSummary > 0) {
      return fromSummary;
    }

    return this.defaultMinCheckoutPaymentAmount;
  }

  downloadInvoice(subscriptionId: string | undefined, inv: InvoiceResponse): void {
    if (!inv.canDownload) return;

    const resolvedSubscriptionId = subscriptionId ?? inv.subscriptionId ?? undefined;

    this.downloadPdfBlob(
      this.invoicesFacade.downloadInvoicePdf(resolvedSubscriptionId, inv.id),
      `${inv.invoiceNumber ?? inv.id}.pdf`,
    );
  }

  downloadVoidDocument(subscriptionId: string | undefined, inv: InvoiceResponse): void {
    if (!inv.canDownloadVoidDocument) return;

    const resolvedSubscriptionId = subscriptionId ?? inv.subscriptionId ?? undefined;

    this.downloadPdfBlob(
      this.invoicesFacade.downloadVoidDocumentPdf(resolvedSubscriptionId, inv.id),
      `${inv.voidDocumentNumber ?? `${inv.invoiceNumber ?? inv.id}-void`}.pdf`,
    );
  }

  downloadTimeReport(subscriptionId: string | undefined, inv: InvoiceResponse): void {
    if (!inv.canDownloadTimeReport) return;

    const resolvedSubscriptionId = subscriptionId ?? inv.subscriptionId ?? undefined;

    this.downloadPdfBlob(
      this.invoicesFacade.downloadTimeReportPdf(resolvedSubscriptionId, inv.id),
      `time-report-${inv.invoiceNumber ?? inv.id}.pdf`,
    );
  }

  private downloadPdfBlob(source: Observable<Blob>, filename: string): void {
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

  getInvoiceStatus(status: string | null | undefined): string {
    return getInvoiceStatusLabel(status);
  }

  invoiceStatusBadgeClass(status: string | null | undefined): string {
    return getInvoiceStatusBadgeClass(status);
  }

  invoiceDisplayTitle(invoice: InvoiceResponse): string {
    return invoice.invoiceNumber?.trim() || getInvoiceStatusLabel('draft');
  }

  invoiceListAmount(invoice: InvoiceResponse, showTotalGross = false): number | null {
    const amount = showTotalGross ? invoice.totalGross : invoice.balance;

    if (amount === null || amount === undefined) {
      return null;
    }

    return Number(amount);
  }

  invoiceSearchHaystack(invoice: InvoiceResponse): string {
    return [
      invoice.invoiceNumber,
      invoice.subscriptionNumber,
      invoice.status,
      getInvoiceStatusLabel(invoice.status),
      invoice.balance,
      invoice.totalGross,
      invoice.createdAt,
      invoice.dueDate,
    ]
      .filter((value) => value !== null && value !== undefined && value !== '')
      .join(' ');
  }

  formatDate(value?: string | null): string {
    if (!value) return '—';

    return this.datePipe.transform(value, 'mediumDate') ?? '—';
  }

  mobilePanelLabel(panel: CustomerBillingMobilePanel): string {
    return panel === 'openOverdue'
      ? $localize`:@@featureInvoices-mobileOpenOverdue:Open & overdue`
      : $localize`:@@featureInvoices-mobileHistory:History`;
  }
}
