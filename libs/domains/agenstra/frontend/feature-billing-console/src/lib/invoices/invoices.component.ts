import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { AuthenticationFacade } from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  InvoicesFacade,
  ServicePlansFacade,
  SubscriptionsFacade,
  type CreateInvoiceDto,
  type InvoiceDetailResponse,
  type InvoiceResponse,
  type ServicePlanResponse,
} from '@forepath/agenstra/frontend/data-access-billing-console';
import { BehaviorSubject, combineLatest, filter, map, Observable, of, pairwise, switchMap } from 'rxjs';

import { getSubscriptionStatusLabel } from '../billing-status-labels';
import { NextBillingDayPipe } from '../pipes/next-billing-day.pipe';

const PAGE_SIZE = 10;

@Component({
  selector: 'framework-billing-invoices',
  standalone: true,
  imports: [CommonModule, FormsModule, NextBillingDayPipe],
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

  readonly isAdmin$ = this.authFacade.canAccessBillingAdministration$;

  readonly subscriptions$ = this.subscriptionsFacade.getSubscriptions$();
  readonly servicePlans$ = this.servicePlansFacade.getServicePlans$();

  readonly selectedSubscriptionId$ = new BehaviorSubject<string>('');
  readonly previewInvoiceRefId$ = new BehaviorSubject<string | null>(null);
  readonly previewSubscriptionId$ = new BehaviorSubject<string | null>(null);

  readonly previewDetail$ = combineLatest([this.previewInvoiceRefId$, this.previewSubscriptionId$]).pipe(
    switchMap(([refId, subId]) =>
      refId && subId ? this.invoicesFacade.getInvoiceDetail$(refId) : of(null as InvoiceDetailResponse | null),
    ),
  );

  readonly allInvoices = toSignal(
    this.selectedSubscriptionId$.pipe(
      switchMap((id) => (id ? this.invoicesFacade.getInvoicesBySubscriptionId$(id) : of([]))),
    ),
    { initialValue: [] as InvoiceResponse[] },
  );

  readonly invoicesPage = signal(0);
  readonly paginatedInvoices = computed(() => {
    const list = this.allInvoices();
    const page = this.invoicesPage();
    const start = page * PAGE_SIZE;

    return list.slice(start, start + PAGE_SIZE);
  });
  readonly invoicesTotalPages = computed(() => Math.max(1, Math.ceil(this.allInvoices().length / PAGE_SIZE)));

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
    this.invoicesFacade
      .getInvoicesCreating$()
      .pipe(
        pairwise(),
        filter(([prev, curr]) => prev === true && curr === false),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.hideModal(this.createInvoiceModal);
        this.createInvoiceDescription = '';
      });
  }

  onSelectSubscription(subscriptionId: string): void {
    const id = subscriptionId || '';

    this.selectedSubscriptionId$.next(id);
    this.invoicesPage.set(0);

    if (id) {
      this.invoicesFacade.loadInvoices(id);
    }
  }

  onInvoicesPageChange(page: number): void {
    this.invoicesPage.set(page);
  }

  openCreateInvoiceModal(): void {
    this.createInvoiceDescription = '';
    this.showModal(this.createInvoiceModal);
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

  openPreview(subscriptionId: string, inv: InvoiceResponse): void {
    this.previewSubscriptionId$.next(subscriptionId);
    this.previewInvoiceRefId$.next(inv.id);
    this.invoicesFacade.loadInvoiceDetails(subscriptionId, inv.id);
    this.showModal(this.previewInvoiceModal);
  }

  payInvoice(subscriptionId: string, inv: InvoiceResponse): void {
    if (!inv.canPay) return;

    this.invoicesFacade.initiatePayment(subscriptionId, inv.id);
  }

  downloadInvoice(subscriptionId: string, inv: InvoiceResponse): void {
    if (!inv.canDownload) return;

    this.downloadPdfBlob(
      this.invoicesFacade.downloadInvoicePdf(subscriptionId, inv.id),
      `${inv.invoiceNumber ?? inv.id}.pdf`,
    );
  }

  downloadVoidDocument(subscriptionId: string, inv: InvoiceResponse): void {
    if (!inv.canDownloadVoidDocument) return;

    this.downloadPdfBlob(
      this.invoicesFacade.downloadVoidDocumentPdf(subscriptionId, inv.id),
      `${inv.voidDocumentNumber ?? `${inv.invoiceNumber ?? inv.id}-void`}.pdf`,
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

  private showModal(modalElement: ElementRef<HTMLDivElement>): void {
    if (modalElement?.nativeElement) {
      const modal = (
        window as unknown as {
          bootstrap?: { Modal?: { getOrCreateInstance: (el: HTMLElement) => { show: () => void } } };
        }
      ).bootstrap?.Modal?.getOrCreateInstance(modalElement.nativeElement);

      if (modal) {
        modal.show();
      }
    }
  }

  private hideModal(modalElement: ElementRef<HTMLDivElement>): void {
    if (modalElement?.nativeElement) {
      const modal = (
        window as unknown as {
          bootstrap?: { Modal?: { getInstance: (el: HTMLElement) => { hide: () => void } | null } };
        }
      ).bootstrap?.Modal?.getInstance(modalElement.nativeElement);

      if (modal) {
        modal.hide();
      }
    }
  }

  getInvoiceStatus(status: string | null | undefined): string {
    switch (status) {
      case 'draft':
        return $localize`:@@featureInvoices-statusDraft:Draft`;
      case 'issued':
        return $localize`:@@featureInvoices-statusIssued:Issued`;
      case 'partially_paid':
        return $localize`:@@featureInvoices-statusPartiallyPaid:Partially paid`;
      case 'paid':
        return $localize`:@@featureInvoices-statusPaid:Paid`;
      case 'overdue':
        return $localize`:@@featureInvoices-statusOverdue:Overdue`;
      case 'void':
        return $localize`:@@featureInvoices-statusVoid:Void`;
      default:
        return status ?? '—';
    }
  }
}
