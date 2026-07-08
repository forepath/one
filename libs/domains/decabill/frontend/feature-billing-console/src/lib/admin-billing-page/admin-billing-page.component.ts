import { CommonModule, DatePipe } from '@angular/common';
import {
  AfterViewInit,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminBillingFacade,
  AdminBillingService,
  AdminInvoiceManagerFacade,
  InvoicesFacade,
  type AdminInvoiceListItem,
  type BillingAuditLogResponse,
  type BillingStatisticsSeriesPoint,
  type ManualInvoiceLineItemDto,
  type SubscriptionResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { AuthenticationFacade, type UserResponseDto } from '@forepath/identity/frontend';
import type {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexNonAxisChartSeries,
  ApexTitleSubtitle,
  ApexXAxis,
} from 'ng-apexcharts';
import { NgApexchartsModule } from 'ng-apexcharts';
import { combineLatestWith, filter, finalize, map, Observable, pairwise, Subscription } from 'rxjs';

import { BillingAdminSubscriptionSelectComponent } from '../billing-admin-subscription-select/billing-admin-subscription-select.component';
import { BillingAdminUserSelectComponent } from '../billing-admin-user-select/billing-admin-user-select.component';
import { getInvoiceStatusBadgeClass, getInvoiceStatusLabel, getUnavailableLabel } from '../billing-status-labels';
import { hideBillingModal, showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

const FILTERS_STORAGE_KEY = 'billing-console-admin-billing-filters';

interface AdminBillingFiltersStorage {
  fromDate: string;
  toDate: string;
  groupBy: 'day' | 'month';
  userId: string | null;
  filtersCollapsed: boolean;
}

interface InvoiceFormLineItem extends ManualInvoiceLineItemDto {
  taxCategory: 'standard' | 'reduced';
}

const BS_CHART_COLORS = [
  'var(--bs-primary)',
  'var(--bs-secondary)',
  'var(--bs-success)',
  'var(--bs-danger)',
  'var(--bs-warning)',
  'var(--bs-info)',
] as const;

type AdminBillingMobilePanel = 'overview' | 'invoices';

@Component({
  selector: 'framework-admin-billing-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgApexchartsModule,
    BillingAdminUserSelectComponent,
    BillingAdminSubscriptionSelectComponent,
  ],
  providers: [DatePipe],
  templateUrl: './admin-billing-page.component.html',
  styleUrls: ['./admin-billing-page.component.scss'],
})
export class AdminBillingPageComponent implements OnInit, AfterViewInit {
  @ViewChild('billNowModal', { static: false }) private billNowModal!: ElementRef<HTMLDivElement>;
  @ViewChild('actionConfirmModal', { static: false }) private actionConfirmModal!: ElementRef<HTMLDivElement>;
  @ViewChild('auditHistoryModal', { static: false }) private auditHistoryModal!: ElementRef<HTMLDivElement>;
  @ViewChild('createModal', { static: false }) private createModal!: ElementRef<HTMLDivElement>;
  @ViewChild('editModal', { static: false }) private editModal!: ElementRef<HTMLDivElement>;
  @ViewChild('issueModal', { static: false }) private issueModal!: ElementRef<HTMLDivElement>;
  @ViewChild('deleteModal', { static: false }) private deleteModal!: ElementRef<HTMLDivElement>;
  @ViewChild('createInvoiceUserSelect') private createInvoiceUserSelect?: BillingAdminUserSelectComponent;
  @ViewChild('createInvoiceSubscriptionSelect')
  private createInvoiceSubscriptionSelect?: BillingAdminSubscriptionSelectComponent;
  @ViewChild('billNowUserSelect') private billNowUserSelect?: BillingAdminUserSelectComponent;

  private createInvoiceSubscriptionsRequest?: Subscription;

  private readonly adminBillingFacade = inject(AdminBillingFacade);
  private readonly invoiceManagerFacade = inject(AdminInvoiceManagerFacade);
  private readonly adminBillingService = inject(AdminBillingService);
  private readonly invoicesFacade = inject(InvoicesFacade);
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly datePipe = inject(DatePipe);
  private readonly destroyRef = inject(DestroyRef);

  readonly filtersCollapsed = signal(true);
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly groupBy = signal<'day' | 'month'>('day');
  readonly selectedUserId = signal<string | null>(null);
  readonly invoiceSearch = signal('');
  readonly invoiceSearch$ = toObservable(this.invoiceSearch);

  readonly mobilePanels: AdminBillingMobilePanel[] = ['overview', 'invoices'];
  readonly mobilePanel = signal<AdminBillingMobilePanel>('overview');
  readonly taxCategoryOptions: { value: InvoiceFormLineItem['taxCategory']; label: string }[] = [
    { value: 'standard', label: 'Standard (19%)' },
    { value: 'reduced', label: 'Reduced (7%)' },
  ];

  readonly billNowScope = signal<'all' | 'user'>('all');
  billNowUserId = '';

  readonly pendingAction = signal<'void' | 'markPaid' | 'markUnpaid' | null>(null);
  readonly pendingInvoice = signal<AdminInvoiceListItem | null>(null);
  readonly actionReason = signal('');
  readonly auditInvoiceId = signal<string | null>(null);

  readonly summary$ = this.adminBillingFacade.summary$;
  readonly summaryLoading$ = this.adminBillingFacade.summaryLoading$;
  readonly summaryError$ = this.adminBillingFacade.summaryError$;
  readonly billNowLoading$ = this.adminBillingFacade.billNowLoading$;
  readonly billNowResult$ = this.adminBillingFacade.billNowResult$;
  readonly billNowError$ = this.adminBillingFacade.billNowError$;
  readonly actionLoading$ = this.invoiceManagerFacade.actionLoading$;
  readonly actionError$ = this.invoiceManagerFacade.error$;
  readonly statisticsSummary$ = this.adminBillingFacade.statisticsSummary$;
  readonly statisticsSummaryLoading$ = this.adminBillingFacade.statisticsSummaryLoading$;
  readonly statisticsByProduct$ = this.adminBillingFacade.statisticsByProduct$;
  readonly statisticsByProductLoading$ = this.adminBillingFacade.statisticsByProductLoading$;
  readonly statisticsError$ = this.adminBillingFacade.statisticsError$;
  readonly auditLogsByInvoice$ = this.adminBillingFacade.auditLogsByInvoice$;
  readonly auditLogsLoading$ = this.adminBillingFacade.auditLogsLoading$;

  readonly invoicesLoading$ = this.invoiceManagerFacade.loading$;
  readonly invoicesCreating$ = this.invoiceManagerFacade.creating$;
  readonly invoicesUpdating$ = this.invoiceManagerFacade.updating$;
  readonly invoicesIssuing$ = this.invoiceManagerFacade.issuing$;
  readonly invoicesDeleting$ = this.invoiceManagerFacade.deleting$;
  readonly invoicesError$ = this.invoiceManagerFacade.error$;

  readonly invoices$ = this.invoiceManagerFacade.invoices$.pipe(
    combineLatestWith(this.invoiceSearch$),
    map(([invoices, searchQuery]) => {
      if (!searchQuery.trim()) return invoices;

      const term = searchQuery.trim().toLowerCase();

      return invoices.filter((invoice) => JSON.stringify(invoice).toLowerCase().includes(term));
    }),
  );

  readonly users = toSignal(this.authFacade.users$, { initialValue: [] as UserResponseDto[] });
  readonly statisticsSummary = toSignal(this.statisticsSummary$, { initialValue: null });
  readonly statisticsByProduct = toSignal(this.statisticsByProduct$, { initialValue: null });
  readonly auditLogsByInvoice = toSignal(this.auditLogsByInvoice$, {
    initialValue: {} as Record<string, BillingAuditLogResponse[]>,
  });
  readonly invoices = toSignal(this.invoices$, { initialValue: [] as AdminInvoiceListItem[] });

  readonly createInvoiceSubscriptions = signal<SubscriptionResponse[]>([]);
  readonly createInvoiceSubscriptionsLoading = signal(false);

  readonly selectedAuditLogs = computed(() => {
    const id = this.auditInvoiceId();

    if (!id) return [] as BillingAuditLogResponse[];

    return this.auditLogsByInvoice()[id] ?? [];
  });

  readonly seriesChartOptions = computed(() => this.buildSeriesChart(this.statisticsSummary()?.series ?? []));
  readonly donutChartOptions = computed(() => this.buildDonutChart(this.statisticsByProduct()?.items ?? []));

  createUserId = '';
  createSubscriptionId = '';
  createLineItems: InvoiceFormLineItem[] = [this.emptyLineItem()];
  editInvoiceId = '';
  editLineItems: InvoiceFormLineItem[] = [this.emptyLineItem()];
  issueInvoiceId = '';
  issueDueInDays = 14;
  deleteInvoice: AdminInvoiceListItem | null = null;

  ngOnInit(): void {
    this.restoreFilters();
    this.setDefaultDates();
    this.adminBillingFacade.loadSummary();
    this.invoiceManagerFacade.loadInvoices();
    this.loadStatistics();
    this.authFacade.loadUsers();

    this.billNowResult$
      .pipe(
        pairwise(),
        filter(([prev, next]) => !prev && !!next),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        hideBillingModal(this.billNowModal);
        this.refreshDashboard();
      });

    this.registerModalCloseWatchers();
  }

  ngAfterViewInit(): void {
    this.adminBillingFacade.billNowError$
      .pipe(
        filter((err) => !!err),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  onToggleFilters(): void {
    this.filtersCollapsed.update((v) => !v);
    this.persistFilters();
  }

  onApplyFilters(): void {
    this.persistFilters();
    this.loadStatistics();
  }

  onResetFilters(): void {
    this.setDefaultDates();
    this.groupBy.set('day');
    this.selectedUserId.set(null);
    this.persistFilters();
    this.loadStatistics();
  }

  openBillNowModal(): void {
    this.billNowScope.set('all');
    this.billNowUserId = '';
    showBillingModal(this.billNowModal);
    queueMicrotask(() => this.billNowUserSelect?.reset());
  }

  openCreateModal(): void {
    this.resetCreateForm();
    showBillingModal(this.createModal);
    queueMicrotask(() => {
      this.createInvoiceUserSelect?.reset();
      this.createInvoiceSubscriptionSelect?.reset();
    });
  }

  onCreateInvoiceUserChanged(userId: string): void {
    this.createSubscriptionId = '';
    this.createInvoiceSubscriptionSelect?.reset();
    this.loadCreateInvoiceSubscriptions(userId);
  }

  openEditModal(invoice: AdminInvoiceListItem): void {
    this.editInvoiceId = invoice.id;
    this.adminBillingService.getManualInvoiceDetail(invoice.id).subscribe({
      next: (detail) => {
        this.editLineItems =
          detail.lineItems.length > 0
            ? detail.lineItems.map((line) => ({
                description: line.description,
                quantity: line.quantity,
                unitPriceNet: line.unitPriceNet,
                taxCategory: line.taxCategory as 'standard' | 'reduced',
              }))
            : [this.emptyLineItem()];
        showBillingModal(this.editModal);
      },
    });
  }

  openIssueModal(invoice: AdminInvoiceListItem): void {
    this.issueInvoiceId = invoice.id;
    this.issueDueInDays = 14;
    showBillingModal(this.issueModal);
  }

  openDeleteModal(invoice: AdminInvoiceListItem): void {
    this.deleteInvoice = invoice;
    showBillingModal(this.deleteModal);
  }

  submitBillNow(): void {
    const dto = this.billNowScope() === 'user' && this.billNowUserId ? { userId: this.billNowUserId } : {};

    this.adminBillingFacade.billNow(dto);
  }

  submitCreate(): void {
    if (!this.createUserId || !this.hasValidLineItems(this.createLineItems)) return;

    this.invoiceManagerFacade.createManualInvoice({
      userId: this.createUserId,
      subscriptionId: this.createSubscriptionId.trim() || undefined,
      lineItems: this.mapLineItemsForSubmit(this.createLineItems),
    });
  }

  submitEdit(): void {
    if (!this.editInvoiceId || !this.hasValidLineItems(this.editLineItems)) return;

    this.invoiceManagerFacade.updateManualInvoice(this.editInvoiceId, {
      lineItems: this.mapLineItemsForSubmit(this.editLineItems),
    });
  }

  submitIssue(): void {
    if (!this.issueInvoiceId) return;

    this.invoiceManagerFacade.issueManualInvoice(this.issueInvoiceId, { dueInDays: this.issueDueInDays });
  }

  confirmDelete(): void {
    if (!this.deleteInvoice) return;

    this.invoiceManagerFacade.deleteManualInvoice(this.deleteInvoice.id);
  }

  openActionModal(action: 'void' | 'markPaid' | 'markUnpaid', invoice: AdminInvoiceListItem): void {
    this.pendingAction.set(action);
    this.pendingInvoice.set(invoice);
    this.actionReason.set('');
    showBillingModal(this.actionConfirmModal);
  }

  confirmAction(): void {
    const invoice = this.pendingInvoice();
    const action = this.pendingAction();

    if (!invoice || !action) return;

    const reason = this.actionReason().trim() || undefined;

    if (action === 'void') {
      this.invoiceManagerFacade.voidInvoice(invoice.id);
    } else if (action === 'markPaid') {
      this.invoiceManagerFacade.markPaid(invoice.id, { reason });
    } else {
      this.invoiceManagerFacade.markUnpaid(invoice.id, { reason });
    }
  }

  openAuditHistory(invoice: AdminInvoiceListItem): void {
    this.auditInvoiceId.set(invoice.id);
    this.adminBillingFacade.loadAuditLogs(invoice.id);
    showBillingModal(this.auditHistoryModal);
  }

  downloadInvoice(invoice: AdminInvoiceListItem): void {
    if (!invoice.canDownload) return;

    const source = invoice.subscriptionId
      ? this.invoicesFacade.downloadInvoicePdf(invoice.subscriptionId, invoice.id)
      : this.adminBillingService.downloadInvoicePdf(invoice.id);

    this.downloadPdfBlob(source, `${invoice.invoiceNumber ?? invoice.id}.pdf`);
  }

  downloadVoidDocument(invoice: AdminInvoiceListItem): void {
    if (!invoice.canDownloadVoidDocument) return;

    const source = invoice.subscriptionId
      ? this.invoicesFacade.downloadVoidDocumentPdf(invoice.subscriptionId, invoice.id)
      : this.adminBillingService.downloadVoidDocumentPdf(invoice.id);

    this.downloadPdfBlob(source, `${invoice.voidDocumentNumber ?? `${invoice.invoiceNumber ?? invoice.id}-void`}.pdf`);
  }

  downloadTimeReport(invoice: AdminInvoiceListItem): void {
    if (!invoice.canDownloadTimeReport) return;

    const source = invoice.subscriptionId
      ? this.invoicesFacade.downloadTimeReportPdf(invoice.subscriptionId, invoice.id)
      : this.adminBillingService.downloadTimeReportPdf(invoice.id);

    this.downloadPdfBlob(source, `time-report-${invoice.invoiceNumber ?? invoice.id}.pdf`);
  }

  addLineItem(target: 'create' | 'edit'): void {
    if (target === 'create') {
      this.createLineItems = [...this.createLineItems, this.emptyLineItem()];
    } else {
      this.editLineItems = [...this.editLineItems, this.emptyLineItem()];
    }
  }

  removeLineItem(target: 'create' | 'edit', index: number): void {
    if (target === 'create' && this.createLineItems.length > 1) {
      this.createLineItems = this.createLineItems.filter((_, i) => i !== index);
    }

    if (target === 'edit' && this.editLineItems.length > 1) {
      this.editLineItems = this.editLineItems.filter((_, i) => i !== index);
    }
  }

  isDraft(invoice: AdminInvoiceListItem): boolean {
    return invoice.status === 'draft';
  }

  canMarkPaid(invoice: AdminInvoiceListItem): boolean {
    return ['issued', 'partially_paid', 'overdue'].includes(invoice.status ?? '');
  }

  canMarkUnpaid(invoice: AdminInvoiceListItem): boolean {
    return invoice.status === 'paid';
  }

  canVoid(invoice: AdminInvoiceListItem): boolean {
    return invoice.status !== 'void' && invoice.status !== 'paid' && invoice.status !== 'draft';
  }

  formatDate(value?: string | Date): string {
    if (!value) return '—';

    return this.datePipe.transform(value, 'mediumDate') ?? '—';
  }

  invoiceDisplayTitle(invoice: AdminInvoiceListItem): string {
    if (invoice.invoiceNumber) return invoice.invoiceNumber;

    return getInvoiceStatusLabel('draft');
  }

  invoiceUserLabel(invoice: AdminInvoiceListItem): string {
    const email = invoice.userEmail?.trim();

    if (email) return email;

    return getUnavailableLabel();
  }

  invoiceStatusLabel(status: string | null | undefined): string {
    return getInvoiceStatusLabel(status);
  }

  invoiceStatusBadgeClass(status: string | null | undefined): string {
    return getInvoiceStatusBadgeClass(status);
  }

  mobilePanelLabel(panel: AdminBillingMobilePanel): string {
    switch (panel) {
      case 'overview':
        return $localize`:@@featureAdminBilling-mobilePanelOverview:Dashboard`;
      case 'invoices':
        return $localize`:@@featureAdminBilling-mobilePanelInvoices:Invoices`;
    }
  }

  private refreshDashboard(): void {
    this.adminBillingFacade.loadSummary();
    this.invoiceManagerFacade.loadInvoices();
  }

  private loadStatistics(): void {
    const params = {
      from: this.fromDate(),
      to: this.toDate(),
      groupBy: this.groupBy(),
      userId: this.selectedUserId() ?? undefined,
    };

    this.adminBillingFacade.loadStatisticsSummary(params);
    this.adminBillingFacade.loadStatisticsByProduct(params);
  }

  private setDefaultDates(): void {
    const to = new Date();
    const from = new Date();

    from.setDate(from.getDate() - 30);
    this.toDate.set(to.toISOString().slice(0, 10));
    this.fromDate.set(from.toISOString().slice(0, 10));
  }

  private restoreFilters(): void {
    try {
      const raw = localStorage.getItem(FILTERS_STORAGE_KEY);

      if (!raw) return;

      const stored = JSON.parse(raw) as AdminBillingFiltersStorage;

      if (stored.fromDate) this.fromDate.set(stored.fromDate);

      if (stored.toDate) this.toDate.set(stored.toDate);

      if (stored.groupBy) this.groupBy.set(stored.groupBy);

      if (stored.userId !== undefined) this.selectedUserId.set(stored.userId);

      if (stored.filtersCollapsed !== undefined) this.filtersCollapsed.set(stored.filtersCollapsed);
    } catch {
      // ignore invalid storage
    }
  }

  private persistFilters(): void {
    const payload: AdminBillingFiltersStorage = {
      fromDate: this.fromDate(),
      toDate: this.toDate(),
      groupBy: this.groupBy(),
      userId: this.selectedUserId(),
      filtersCollapsed: this.filtersCollapsed(),
    };

    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(payload));
  }

  formatLineItemTotal(line: InvoiceFormLineItem): string {
    const totals = this.computeLineItemTotals(line);

    if (!totals) return '—';

    return `€${this.formatPrice(totals.net)} + €${this.formatPrice(totals.tax)} VAT (${totals.taxRate}%) = €${this.formatPrice(totals.gross)}`;
  }

  formatDraftTotals(items: InvoiceFormLineItem[]): string {
    const totals = this.computeDraftTotals(items);

    if (!totals) return '—';

    return `€${this.formatPrice(totals.net)} net + €${this.formatPrice(totals.tax)} VAT = €${this.formatPrice(totals.gross)} gross`;
  }

  private emptyLineItem(): InvoiceFormLineItem {
    return { description: '', quantity: 1, unitPriceNet: 0, taxCategory: 'standard' };
  }

  private hasValidLineItems(items: InvoiceFormLineItem[]): boolean {
    return items.every((item) => item.description.trim().length > 0 && item.quantity > 0 && item.unitPriceNet >= 0);
  }

  private mapLineItemsForSubmit(items: InvoiceFormLineItem[]): ManualInvoiceLineItemDto[] {
    return items.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unitPriceNet: Number(item.unitPriceNet),
      taxCategory: item.taxCategory ?? 'standard',
    }));
  }

  private computeLineItemTotals(
    line: InvoiceFormLineItem,
  ): { net: number; tax: number; gross: number; taxRate: number } | null {
    const quantity = Number(line.quantity);
    const unitPriceNet = Number(line.unitPriceNet);

    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPriceNet) || unitPriceNet < 0) {
      return null;
    }

    const net = Math.round(quantity * unitPriceNet * 100) / 100;
    const taxRate = line.taxCategory === 'reduced' ? 7 : 19;
    const tax = Math.round(net * (taxRate / 100) * 100) / 100;
    const gross = Math.round((net + tax) * 100) / 100;

    return { net, tax, gross, taxRate };
  }

  private computeDraftTotals(items: InvoiceFormLineItem[]): { net: number; tax: number; gross: number } | null {
    let net = 0;
    let tax = 0;

    for (const item of items) {
      const lineTotals = this.computeLineItemTotals(item);

      if (!lineTotals) {
        return null;
      }

      net += lineTotals.net;
      tax += lineTotals.tax;
    }

    return {
      net: Math.round(net * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      gross: Math.round((net + tax) * 100) / 100,
    };
  }

  private formatPrice(value: number): string {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private resetCreateForm(): void {
    this.createUserId = '';
    this.createSubscriptionId = '';
    this.createLineItems = [this.emptyLineItem()];
    this.createInvoiceSubscriptions.set([]);
    this.createInvoiceSubscriptionsLoading.set(false);
    this.createInvoiceSubscriptionsRequest?.unsubscribe();
    this.createInvoiceSubscriptionsRequest = undefined;
  }

  private loadCreateInvoiceSubscriptions(userId: string): void {
    this.createInvoiceSubscriptionsRequest?.unsubscribe();

    if (!userId) {
      this.createInvoiceSubscriptions.set([]);
      this.createInvoiceSubscriptionsLoading.set(false);
      return;
    }

    this.createInvoiceSubscriptionsLoading.set(true);
    this.createInvoiceSubscriptionsRequest = this.adminBillingService
      .listUserSubscriptions(userId, { limit: 100 })
      .pipe(finalize(() => this.createInvoiceSubscriptionsLoading.set(false)))
      .subscribe({
        next: (subscriptions) => this.createInvoiceSubscriptions.set(subscriptions),
        error: () => this.createInvoiceSubscriptions.set([]),
      });
  }

  private resetEditForm(): void {
    this.editInvoiceId = '';
    this.editLineItems = [this.emptyLineItem()];
  }

  private registerModalCloseWatchers(): void {
    const refreshDashboard = (): void => {
      this.refreshDashboard();
    };

    watchBillingMutationModalClose({
      loading$: this.invoicesCreating$,
      error$: this.invoiceManagerFacade.error$,
      modal: () => this.createModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.resetCreateForm();
        refreshDashboard();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.invoicesUpdating$,
      error$: this.invoiceManagerFacade.error$,
      modal: () => this.editModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.resetEditForm();
        refreshDashboard();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.invoicesIssuing$,
      error$: this.invoiceManagerFacade.error$,
      modal: () => this.issueModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.issueInvoiceId = '';
        refreshDashboard();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.invoicesDeleting$,
      error$: this.invoiceManagerFacade.error$,
      modal: () => this.deleteModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.deleteInvoice = null;
        refreshDashboard();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.actionLoading$,
      error$: this.actionError$,
      modal: () => this.actionConfirmModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.pendingAction.set(null);
        this.pendingInvoice.set(null);
        this.actionReason.set('');
        refreshDashboard();
      },
    });
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

  private buildSeriesChart(series: BillingStatisticsSeriesPoint[]) {
    if (series.length === 0) return null;

    const axisDateFormat = this.groupBy() === 'month' ? 'mediumDate' : 'shortDate';

    return {
      series: [{ name: 'Turnover', data: series.map((p) => p.totalGross) }] as ApexAxisChartSeries,
      chart: {
        type: 'area',
        height: 240,
        toolbar: { show: false },
        background: 'transparent',
        zoom: { enabled: false },
      } as ApexChart,
      colors: [BS_CHART_COLORS[0]],
      stroke: { colors: [BS_CHART_COLORS[0]] },
      fill: { colors: [BS_CHART_COLORS[0]] },
      dataLabels: { enabled: false } as ApexDataLabels,
      xaxis: {
        categories: series.map((p) => this.datePipe.transform(p.period, axisDateFormat) ?? p.period),
        labels: {
          style: { colors: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
        },
        axisBorder: { color: 'var(--bs-border-color)' },
      } as ApexXAxis,
      yaxis: {
        labels: {
          style: { colors: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
          formatter: (value: number) => `${value.toFixed(2)}€`,
        },
      },
      grid: { borderColor: 'var(--bs-border-color)' },
      title: {
        text: $localize`:@@featureAdminBilling-chartTurnoverTitle:Turnover over time`,
        style: { color: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
      } as ApexTitleSubtitle,
    };
  }

  private buildDonutChart(items: { planName: string; totalGross: number }[]) {
    if (items.length === 0) return null;

    return {
      series: items.map((i) => i.totalGross) as ApexNonAxisChartSeries,
      chart: { type: 'donut', height: 240, background: 'transparent' } as ApexChart,
      labels: items.map((i) => i.planName),
      colors: BS_CHART_COLORS.slice(0, items.length),
      legend: {
        labels: { colors: 'var(--bs-body-color)' },
        fontFamily: 'var(--bs-body-font-family)',
      },
      title: {
        text: $localize`:@@featureAdminBilling-chartProductTitle:Turnover by product`,
        style: { color: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
      } as ApexTitleSubtitle,
    };
  }
}
