import { CommonModule, DatePipe } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  LOCALE_ID,
  OnInit,
  signal,
  untracked,
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
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcKeyValueListComponent,
  FpcLaneHeaderComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  fpcRunBulk,
  FpcTableCellDirective,
  type FpcKeyValueItem,
  type FpcMenuItem,
  type FpcTableColumn,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
  FpcTabComponent,
  FpcTabGroupComponent,
  type FpcBadgeTone,
  FpcMoneyPipe,
} from '@forepath/shared/frontend/ui-components';
import {
  BehaviorSubject,
  combineLatest,
  filter,
  interval,
  map,
  firstValueFrom,
  Observable,
  of,
  switchMap,
  take,
} from 'rxjs';

import { getInvoiceStatusBadgeTone, getInvoiceStatusLabel } from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { dbBulkSummary, dbCopyIdItem, type DbBulkResult } from '../shared/data-list';
import { invoiceSummaryItems, invoiceTaxItems } from '../shared/invoice-totals';
import { dbPagerTotal, dbServerPaging, type DbPageQuery } from '../shared/server-paging';
import { invoiceState } from '../shared/table-states';
import { NextBillingDayPipe } from '../pipes/next-billing-day.pipe';
import { getUnnumberedInvoiceLabel } from '../named-label.util';
import { formatBillingDate, formatBillingMoney } from '../billing-format';

type CustomerBillingMobilePanel = 'openOverdue' | 'history';

type PaymentReturnFeedback = 'waiting' | 'confirmed' | 'canceled';

@Component({
  selector: 'framework-billing-invoices',
  standalone: true,
  imports: [
    FpcMoneyPipe,
    CommonModule,
    FormsModule,
    NextBillingDayPipe,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcDataTableComponent,
    FpcKeyValueListComponent,
    FpcLaneHeaderComponent,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcSummaryCardValueDirective,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcTableCellDirective,
    FpcTabComponent,
    FpcTabGroupComponent,
  ],
  providers: [DatePipe],
  templateUrl: './invoices.component.html',
  styleUrls: ['./invoices.component.scss'],
})
export class InvoicesComponent implements OnInit {
  readonly createInvoiceModalOpen = signal(false);
  readonly previewInvoiceModalOpen = signal(false);

  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly invoicesFacade = inject(InvoicesFacade);
  private readonly subscriptionsFacade = inject(SubscriptionsFacade);
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly datePipe = inject(DatePipe);

  readonly pageTitle = $localize`:@@featureInvoices-title:Billing`;
  readonly mobilePanel = signal<CustomerBillingMobilePanel>('openOverdue');
  /** Open & overdue tab → `GET /invoices/open-overdue?limit&offset&search` (replace-page, `hasNext`). */
  readonly openPaging = dbServerPaging(
    (query) => {
      if (untracked(this.mobilePanel) === 'openOverdue') this.invoicesFacade.loadOpenOverdueInvoices(query);
    },
    { url: 'open-' },
  );
  /** History tab → `GET /invoices/history?limit&offset&search` (replace-page, `hasNext`). */
  readonly historyPaging = dbServerPaging(
    (query) => {
      if (untracked(this.mobilePanel) === 'history') this.invoicesFacade.loadHistoryInvoices(query);
    },
    { url: 'hist-' },
  );
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
  readonly openOverdueHasMore = toSignal(this.invoicesFacade.getOpenOverdueHasMore$(), { initialValue: false });
  readonly historyHasMore = toSignal(this.invoicesFacade.getHistoryHasMore$(), { initialValue: false });

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
  readonly openOverdueListError = toSignal(this.openOverdueListError$, { initialValue: null });
  readonly historyListError = toSignal(this.historyListError$, { initialValue: null });
  private readonly locale = inject(LOCALE_ID);

  readonly openOverdueListLabel = $localize`:@@featureInvoices-openOverdueList:Open and overdue invoices`;
  readonly historyListLabel = $localize`:@@featureInvoices-historyList:Invoice history`;
  readonly searchOpenOverdueLabel = $localize`:@@featureInvoices-searchOpenOverdue:Search invoices`;
  readonly searchHistoryLabel = $localize`:@@featureInvoices-searchHistory:Search invoice history`;
  readonly previewLabel = $localize`:@@featureInvoices-previewButtonTitle:Preview invoice`;
  readonly downloadPdfLabel = $localize`:@@featureInvoices-downloadButtonTitle:Download PDF`;
  readonly downloadCreditNoteLabel = $localize`:@@featureInvoices-downloadCreditNoteButtonTitle:Download credit note`;
  readonly downloadTimeReportLabel = $localize`:@@featureInvoices-downloadTimeReportButtonTitle:Download time report`;
  readonly downloadPdfsLabel = $localize`:@@featureInvoices-downloadSelected:Download PDFs`;

  /** Open / overdue: State · Invoice · subscription · balance · issued · due. */
  readonly openColumns = this.invoiceColumns(false);
  /** History: State · Invoice · subscription · total (gross) · issued · due. */
  readonly openOverdueTotal = computed(() =>
    dbPagerTotal(this.openPaging.search(), this.invoicesSummary()?.openOverdueCount),
  );
  readonly historyTotal = computed(() =>
    dbPagerTotal(this.historyPaging.search(), this.invoicesSummary()?.historyCount),
  );
  readonly historyColumns = this.invoiceColumns(true);

  readonly selectedOpen = signal<readonly string[]>([]);
  readonly selectedHistory = signal<readonly string[]>([]);
  readonly bulkResult = signal<DbBulkResult | null>(null);

  readonly invoiceMenu = (inv: InvoiceResponse): FpcMenuItem[] => {
    const menu: FpcMenuItem[] = [];

    if (inv.canPreview) menu.push({ id: 'preview', label: this.previewLabel, icon: 'eye' });

    if (this.shouldShowPayButton(inv)) {
      menu.push({
        id: 'pay',
        label: this.payInvoiceTitle,
        icon: 'credit-card',
        disabled: !inv.canPay || this.isBelowMinimumPaymentAmount(inv),
        title: this.payButtonTitle(inv),
      });
    }

    if (inv.canDownload) menu.push({ id: 'download', label: this.downloadPdfLabel, icon: 'file-earmark-pdf' });

    if (inv.canDownloadVoidDocument) {
      menu.push({ id: 'download-void', label: this.downloadCreditNoteLabel, icon: 'file-earmark-x' });
    }

    if (inv.canDownloadTimeReport) {
      menu.push({ id: 'download-time', label: this.downloadTimeReportLabel, icon: 'file-earmark-text' });
    }

    menu.push(dbCopyIdItem());

    return menu;
  };

  readonly selectedSubscription$ = combineLatest([this.subscriptions$, this.selectedSubscriptionId$]).pipe(
    map(([subscriptions, id]) => subscriptions.find((s) => s.id === id) ?? null),
  );

  readonly isCreateInvoiceDisabled$ = combineLatest([this.invoicesCreating$, this.selectedSubscription$]).pipe(
    map(([creating, sub]) => creating === true || (sub?.status === 'canceled' && sub?.nextBillingAt !== null)),
  );

  createInvoiceDescription = '';

  readonly createInvoiceDisabledTitle = $localize`:@@featureInvoices-createInvoiceDisabledFinalized:Subscription is finalized; no further invoices can be created.`;
  readonly payInvoiceTitle = $localize`:@@featureInvoices-payButtonTitle:Pay invoice`;
  readonly openOverdueCountLabel = $localize`:@@featureInvoices-openOverdueCount:Open and overdue invoices`;
  readonly openOverdueTotalLabel = $localize`:@@featureInvoices-openOverdueTotal:Open total amount`;
  readonly nextBillingDayLabel = $localize`:@@featureInvoices-nextBillingDay:Your next billing day`;
  readonly unbilledTotalLabel = $localize`:@@featureInvoices-unbilledTotal:Unbilled amount`;
  private readonly defaultMinCheckoutPaymentAmount = 1;

  constructor() {
    // A tab switch loads the shown tab's current page (the hidden tab does not query).
    let firstPanel = true;

    effect(() => {
      const panel = this.mobilePanel();

      if (firstPanel) {
        firstPanel = false;

        return;
      }
      untracked(() => (panel === 'history' ? this.historyPaging : this.openPaging).reload());
    });
  }

  ngOnInit(): void {
    this.subscriptionsFacade.loadSubscriptions();
    this.invoicesFacade.loadInvoicesSummary();
    this.handlePaymentReturnQueryParams();

    watchBillingMutationModalClose({
      loading$: this.invoicesCreating$,
      error$: this.invoicesError$,
      open: this.createInvoiceModalOpen,
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
    // The shown tab's current page, silently (no spinner, rows replaced when the answer arrives).
    if (this.mobilePanel() === 'history') {
      this.invoicesFacade.loadHistoryInvoices({ ...silent, ...this.currentQuery(this.historyPaging) });
    } else {
      this.invoicesFacade.loadOpenOverdueInvoices({ ...silent, ...this.currentQuery(this.openPaging) });
    }

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

  private currentQuery(paging: { search: () => string; page: () => number; pageSize: () => number }): DbPageQuery {
    return { search: paging.search().trim() || undefined, page: paging.page(), pageSize: paging.pageSize() };
  }

  openCreateInvoiceModal(): void {
    this.createInvoiceDescription = '';
    showBillingModal(this.createInvoiceModalOpen);
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
    showBillingModal(this.previewInvoiceModalOpen);
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
      const min = formatBillingMoney(this.resolveMinCheckoutPaymentAmount());

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

  onInvoiceActivate(inv: InvoiceResponse): void {
    if (inv.canPreview) this.openPreview(undefined, inv);
  }

  onInvoiceAction(inv: InvoiceResponse, action: string): void {
    if (action === 'preview') this.openPreview(undefined, inv);
    else if (action === 'pay') this.payInvoice(undefined, inv);
    else if (action === 'download') this.downloadInvoice(undefined, inv);
    else if (action === 'download-void') this.downloadVoidDocument(undefined, inv);
    else if (action === 'download-time') this.downloadTimeReport(undefined, inv);
    else if (action === 'copy-id') fpcCopyText(inv.id);
  }

  /** Selected invoices (of the active tab) that have a PDF. */
  downloadable(ids: readonly string[]): InvoiceResponse[] {
    const selected = new Set(ids);
    const rows = this.mobilePanel() === 'history' ? this.historyList() : this.openOverdueList();

    return rows.filter((inv) => selected.has(inv.id) && inv.canDownload);
  }

  /** Bulk "Download PDFs": one PDF request per invoice (same endpoint as the row action), per-invoice result. */
  async downloadSelected(ids: readonly string[]): Promise<void> {
    const invoices = this.downloadable(ids);

    if (invoices.length === 0) return;

    const result = await fpcRunBulk(invoices, async (inv) => {
      const blob = await firstValueFrom(
        this.invoicesFacade.downloadInvoicePdf(inv.subscriptionId ?? undefined, inv.id),
      );

      this.saveBlob(blob, `${inv.invoiceNumber ?? inv.id}.pdf`);
    });

    this.bulkResult.set(dbBulkSummary(result, (inv) => this.invoiceDisplayTitle(inv)));
    this.selectedOpen.set([]);
    this.selectedHistory.set([]);
  }

  taxItems(detail: InvoiceDetailResponse): FpcKeyValueItem[] {
    return invoiceTaxItems(detail, this.locale);
  }

  summaryItems(detail: InvoiceDetailResponse): FpcKeyValueItem[] {
    return invoiceSummaryItems(detail, this.locale);
  }

  private invoiceColumns(showTotalGross: boolean): FpcTableColumn<InvoiceResponse>[] {
    return [
      {
        id: 'status',
        label: $localize`:@@featureInvoices-colStatus:Status`,
        type: 'state',
        state: (inv) => invoiceState(inv.status),
      },
      {
        id: 'invoice',
        label: $localize`:@@featureInvoices-colInvoice:Invoice`,
        value: (inv) => this.invoiceDisplayTitle(inv),
        required: true,
        priority: 1,
      },
      {
        id: 'subscription',
        label: $localize`:@@featureInvoices-colSubscription:Subscription`,
        value: (inv) => inv.subscriptionNumber ?? '',
        priority: 2,
      },
      {
        id: 'amount',
        label: showTotalGross
          ? $localize`:@@featureInvoices-colTotal:Total`
          : $localize`:@@featureInvoices-colBalance:Balance`,
        value: (inv) => {
          const amount = this.invoiceListAmount(inv, showTotalGross);

          return amount === null ? '' : formatBillingMoney(amount);
        },
        align: 'end',
        priority: 1,
      },
      {
        id: 'issued',
        label: $localize`:@@featureInvoices-colIssued:Issued`,
        value: (inv) => inv.issuedAt ?? inv.createdAt ?? '',
        priority: 2,
      },
      {
        id: 'due',
        label: $localize`:@@featureInvoices-colDue:Due`,
        value: (inv) => inv.dueDate ?? '',
        priority: 2,
      },
    ];
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  getInvoiceStatus(status: string | null | undefined): string {
    return getInvoiceStatusLabel(status);
  }

  invoiceStatusBadgeTone(status: string | null | undefined): FpcBadgeTone {
    return getInvoiceStatusBadgeTone(status);
  }

  invoiceDisplayTitle(invoice: InvoiceResponse): string {
    return invoice.invoiceNumber?.trim() || getUnnumberedInvoiceLabel();
  }

  invoiceListAmount(invoice: InvoiceResponse, showTotalGross = false): number | null {
    const amount = showTotalGross ? invoice.totalGross : invoice.balance;

    if (amount === null || amount === undefined) {
      return null;
    }

    return Number(amount);
  }

  /** Issue date; drafts / legacy rows without one fall back to the record date. */
  invoiceIssuedAt(inv: InvoiceResponse): string {
    return this.formatDate(inv.issuedAt ?? inv.createdAt);
  }

  /** Overdue due dates are emphasised (DB-25): status `overdue`, or an open balance past its due date. */
  isInvoiceOverdue(inv: InvoiceResponse, now: Date = new Date()): boolean {
    if (inv.status === 'overdue') {
      return true;
    }

    if (inv.status !== 'issued' && inv.status !== 'partially_paid') {
      return false;
    }

    const due = inv.dueDate ? new Date(inv.dueDate) : null;

    return !!due && !Number.isNaN(due.getTime()) && due.getTime() < now.getTime();
  }

  invoiceDueDate(inv: InvoiceResponse): string {
    return this.formatDate(inv.dueDate);
  }

  formatDate(value?: string | null): string {
    if (!value) return '-';

    return formatBillingDate(value, '-');
  }

  onMobilePanelTabChange(tabId: string | null): void {
    if (tabId === 'openOverdue' || tabId === 'history') {
      this.mobilePanel.set(tabId);
    }
  }

  mobilePanelLabel(panel: CustomerBillingMobilePanel): string {
    return panel === 'openOverdue'
      ? $localize`:@@featureInvoices-mobileOpenOverdue:Open and overdue`
      : $localize`:@@featureInvoices-mobileHistory:History`;
  }
}
