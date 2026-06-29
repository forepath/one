import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import {
  InvoicesFacade,
  ServicePlansFacade,
  SubscriptionsFacade,
  type CreateInvoiceDto,
  type InvoiceDetailResponse,
  type InvoiceResponse,
  type ServicePlanResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { BehaviorSubject, combineLatest, map, Observable, of, switchMap } from 'rxjs';

import {
  getInvoiceStatusBadgeClass,
  getInvoiceStatusLabel,
  getSubscriptionStatusLabel,
} from '../billing-status-labels';
import { filterItemsBySearch } from '../billing-list-search';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { NextBillingDayPipe } from '../pipes/next-billing-day.pipe';

type CustomerBillingMobilePanel = 'openOverdue' | 'subscription';

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
  private readonly invoicesFacade = inject(InvoicesFacade);
  private readonly subscriptionsFacade = inject(SubscriptionsFacade);
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly datePipe = inject(DatePipe);

  readonly mobilePanels: CustomerBillingMobilePanel[] = ['openOverdue', 'subscription'];
  readonly mobilePanel = signal<CustomerBillingMobilePanel>('openOverdue');
  readonly openOverdueSearch = signal('');
  readonly subscriptionInvoicesSearch = signal('');

  readonly isAdmin$ = this.authFacade.canAccessBillingAdministration$;

  readonly subscriptions$ = this.subscriptionsFacade.getSubscriptions$();
  readonly servicePlans$ = this.servicePlansFacade.getServicePlans$();

  readonly selectedSubscriptionId$ = new BehaviorSubject<string>('');
  readonly previewInvoiceRefId$ = new BehaviorSubject<string | null>(null);
  readonly previewSubscriptionId$ = new BehaviorSubject<string | null>(null);

  readonly previewDetail$ = this.previewInvoiceRefId$.pipe(
    switchMap((refId) =>
      refId ? this.invoicesFacade.getInvoiceDetail$(refId) : of(null as InvoiceDetailResponse | null),
    ),
  );

  readonly allInvoices = toSignal(
    this.selectedSubscriptionId$.pipe(
      switchMap((id) => (id ? this.invoicesFacade.getInvoicesBySubscriptionId$(id) : of([]))),
    ),
    { initialValue: [] as InvoiceResponse[] },
  );

  readonly openOverdueList = toSignal(this.invoicesFacade.getOpenOverdueList$(), {
    initialValue: [] as InvoiceResponse[],
  });

  readonly filteredOpenOverdueList = computed(() =>
    filterItemsBySearch(this.openOverdueList(), this.openOverdueSearch(), (invoice) =>
      this.invoiceSearchHaystack(invoice),
    ),
  );

  readonly filteredAllInvoices = computed(() =>
    filterItemsBySearch(this.allInvoices(), this.subscriptionInvoicesSearch(), (invoice) =>
      this.invoiceSearchHaystack(invoice),
    ),
  );

  readonly invoicesLoading$ = this.invoicesFacade.getInvoicesLoading$();
  readonly invoicesCreating$ = this.invoicesFacade.getInvoicesCreating$();
  readonly invoicesError$ = this.invoicesFacade.getInvoicesError$();
  readonly payingInvoiceRefId$ = this.invoicesFacade.getPayingInvoiceRefId$();
  readonly invoiceDetailsLoading$ = this.invoicesFacade.getInvoiceDetailsLoading$();
  readonly invoicesSummary$ = this.invoicesFacade.getInvoicesSummary$();
  readonly invoicesSummaryLoading$ = this.invoicesFacade.getInvoicesSummaryLoading$();
  readonly openOverdueList$ = this.invoicesFacade.getOpenOverdueList$();
  readonly openOverdueListLoading$ = this.invoicesFacade.getOpenOverdueListLoading$();
  readonly openOverdueListError$ = this.invoicesFacade.getOpenOverdueListError$();

  readonly selectedSubscription$ = combineLatest([this.subscriptions$, this.selectedSubscriptionId$]).pipe(
    map(([subscriptions, id]) => subscriptions.find((s) => s.id === id) ?? null),
  );

  readonly isCreateInvoiceDisabled$ = combineLatest([this.invoicesCreating$, this.selectedSubscription$]).pipe(
    map(([creating, sub]) => creating === true || (sub?.status === 'canceled' && sub?.nextBillingAt !== null)),
  );

  createInvoiceDescription = '';

  readonly createInvoiceDisabledTitle = $localize`:@@featureInvoices-createInvoiceDisabledFinalized:Subscription is finalized; no further invoices can be created.`;

  planNameByPlanId(planId: string, plans: ServicePlanResponse[] | null): string {
    if (!plans) return planId;

    const plan = plans.find((p) => p.id === planId);

    return plan?.name ?? planId;
  }

  subscriptionStatusLabel(status: string | null | undefined): string {
    return getSubscriptionStatusLabel(status);
  }

  ngOnInit(): void {
    this.subscriptionsFacade.loadSubscriptions();
    this.servicePlansFacade.loadServicePlans();
    this.invoicesFacade.loadInvoicesSummary();
    this.invoicesFacade.loadOpenOverdueInvoices();
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

  onSelectSubscription(subscriptionId: string): void {
    const id = subscriptionId || '';

    this.selectedSubscriptionId$.next(id);
    this.subscriptionInvoicesSearch.set('');

    if (id) {
      this.invoicesFacade.loadInvoices(id);
    }
  }

  onOpenOverdueSearchChange(value: string): void {
    this.openOverdueSearch.set(value);
  }

  onSubscriptionInvoicesSearchChange(value: string): void {
    this.subscriptionInvoicesSearch.set(value);
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
    if (!inv.canPay) return;

    const resolvedSubscriptionId = subscriptionId ?? inv.subscriptionId ?? undefined;

    this.invoicesFacade.initiatePayment(resolvedSubscriptionId, inv.id);
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

  invoiceSearchHaystack(invoice: InvoiceResponse): string {
    return [
      invoice.invoiceNumber,
      invoice.subscriptionNumber,
      invoice.status,
      getInvoiceStatusLabel(invoice.status),
      invoice.balance,
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
      : $localize`:@@featureInvoices-mobileSubscription:By subscription`;
  }
}
