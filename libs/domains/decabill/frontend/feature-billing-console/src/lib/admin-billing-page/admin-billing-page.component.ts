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
  AdminSupplierInvoiceManagerFacade,
  AdminSupplierInvoicesService,
  AdminSupplierProfilesService,
  InvoicesFacade,
  computeLineTotalsFromRate,
  fillPeriodSeriesPoints,
  rateForTaxCategory,
  type AdminInvoiceListItem,
  type AdminSupplierInvoiceListItem,
  type AdminSupplierProfileListItem,
  type BillingAuditLogResponse,
  type BillingStatisticsSeriesPoint,
  type ManualInvoiceDetailResponse,
  type ManualInvoiceLineItemDto,
  type SubscriptionResponse,
  type SupplierInvoiceDetailResponse,
  type SupplierInvoiceLineItemDto,
  type TaxPreviewRates,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { AuthenticationFacade, type UserResponseDto } from '@forepath/identity/frontend';
import { InfiniteScrollDirective, ListAppendFooterComponent } from '@forepath/shared/frontend/ui-lists';
import type {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexNonAxisChartSeries,
  ApexTitleSubtitle,
  ApexTooltip,
  ApexXAxis,
} from 'ng-apexcharts';
import { NgApexchartsModule } from 'ng-apexcharts';
import { debounceTime, distinctUntilChanged, filter, finalize, Observable, pairwise, skip, Subscription } from 'rxjs';

import { BillingAdminSubscriptionSelectComponent } from '../billing-admin-subscription-select/billing-admin-subscription-select.component';
import { BillingAdminSupplierContractSelectComponent } from '../billing-admin-supplier-contract-select/billing-admin-supplier-contract-select.component';
import { BillingAdminSupplierSelectComponent } from '../billing-admin-supplier-select/billing-admin-supplier-select.component';
import { BillingAdminUserSelectComponent } from '../billing-admin-user-select/billing-admin-user-select.component';
import { getInvoiceStatusBadgeClass, getInvoiceStatusLabel, getUnavailableLabel } from '../billing-status-labels';
import { hideBillingModal, showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { PricingTotalsSummaryComponent } from '../pricing-totals-summary/pricing-totals-summary.component';
import {
  aggregatePricingTotalsSummaries,
  buildPricingTotalsSummary,
  type PricingTotalsSummary,
} from '../pricing-totals-summary/pricing-totals.util';

const FILTERS_STORAGE_KEY = 'billing-console-admin-billing-filters';

interface AdminBillingFiltersStorage {
  fromDate: string;
  toDate: string;
  groupBy: 'day' | 'month';
  userId: string | null;
  supplierId: string | null;
  filtersCollapsed: boolean;
}

interface InvoiceFormLineItem extends ManualInvoiceLineItemDto {
  taxCategory: 'standard' | 'reduced' | 'custom';
  taxRate?: number;
}

interface SupplierInvoiceFormLineItem extends SupplierInvoiceLineItemDto {
  taxCategory: 'standard' | 'reduced' | 'custom';
  taxRate?: number;
}

type AdminBillingTab = 'customer' | 'supplier';
type CreateInvoiceType = 'customer' | 'supplier';
type ActionInvoiceKind = 'customer' | 'supplier';

interface InvoicePreviewLineItem {
  description: string;
  quantity: number;
  unitPriceNet: number;
  lineNet: number;
  lineTax: number;
  taxRate: number;
  lineGross: number;
}

interface InvoicePreviewTaxBreakdown {
  taxRate: number;
  taxAmount: number;
}

interface InvoicePreviewView {
  title: string;
  status: string;
  issueDate?: string | Date | null;
  dueDate?: string | Date | null;
  currency: string;
  lineItems: InvoicePreviewLineItem[];
  taxBreakdown: InvoicePreviewTaxBreakdown[];
  subtotalNet: number;
  taxTotal: number;
  totalGross: number;
  balanceDue: number;
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
type AdminBillingPerspective = 'customer' | 'supplier';

@Component({
  selector: 'framework-admin-billing-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgApexchartsModule,
    BillingAdminUserSelectComponent,
    BillingAdminSubscriptionSelectComponent,
    BillingAdminSupplierSelectComponent,
    BillingAdminSupplierContractSelectComponent,
    InfiniteScrollDirective,
    ListAppendFooterComponent,
    PricingTotalsSummaryComponent,
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
  @ViewChild('previewInvoiceModal', { static: false }) private previewInvoiceModal!: ElementRef<HTMLDivElement>;
  @ViewChild('createInvoiceUserSelect') private createInvoiceUserSelect?: BillingAdminUserSelectComponent;
  @ViewChild('createInvoiceSubscriptionSelect')
  private createInvoiceSubscriptionSelect?: BillingAdminSubscriptionSelectComponent;
  @ViewChild('createInvoiceSupplierSelect') private createInvoiceSupplierSelect?: BillingAdminSupplierSelectComponent;
  @ViewChild('createInvoiceContractSelect')
  private createInvoiceContractSelect?: BillingAdminSupplierContractSelectComponent;
  @ViewChild('billNowUserSelect') private billNowUserSelect?: BillingAdminUserSelectComponent;

  private createInvoiceSubscriptionsRequest?: Subscription;

  private readonly adminBillingFacade = inject(AdminBillingFacade);
  readonly invoiceManagerFacade = inject(AdminInvoiceManagerFacade);
  readonly supplierInvoiceManagerFacade = inject(AdminSupplierInvoiceManagerFacade);
  private readonly adminBillingService = inject(AdminBillingService);
  private readonly supplierInvoicesService = inject(AdminSupplierInvoicesService);
  private readonly supplierProfilesService = inject(AdminSupplierProfilesService);
  private readonly invoicesFacade = inject(InvoicesFacade);
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly datePipe = inject(DatePipe);
  private readonly destroyRef = inject(DestroyRef);

  readonly billingPerspective = signal<AdminBillingPerspective>('customer');
  readonly filtersCollapsed = signal(true);
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly groupBy = signal<'day' | 'month'>('day');
  readonly selectedUserId = signal<string | null>(null);
  readonly selectedSupplierId = signal<string | null>(null);
  readonly supplierFilterOptions = signal<AdminSupplierProfileListItem[]>([]);
  readonly invoiceSearch = signal('');
  readonly supplierInvoiceSearch = signal('');
  readonly invoiceSearch$ = toObservable(this.invoiceSearch);
  readonly supplierInvoiceSearch$ = toObservable(this.supplierInvoiceSearch);

  readonly mobilePanels: AdminBillingMobilePanel[] = ['overview', 'invoices'];
  readonly mobilePanel = signal<AdminBillingMobilePanel>('overview');
  readonly taxRates = signal<TaxPreviewRates>({ standard: 19, reduced: 7 });
  readonly taxCategoryOptions = computed(() => {
    const rates = this.taxRates();

    return [
      { value: 'standard' as const, label: `Standard (${rates.standard}%)` },
      { value: 'reduced' as const, label: `Reduced (${rates.reduced}%)` },
    ];
  });
  readonly supplierTaxCategoryOptions = computed(() => [
    ...this.taxCategoryOptions(),
    {
      value: 'custom' as const,
      label: $localize`:@@featureAdminInvoices-lineTaxCategoryCustom:Custom`,
    },
  ]);

  readonly billNowScope = signal<'all' | 'user'>('all');
  billNowUserId = '';

  readonly pendingAction = signal<'void' | 'markPaid' | 'markUnpaid' | null>(null);
  readonly actionReason = signal('');
  readonly actionPaidAt = signal('');
  readonly pendingInvoice = signal<AdminInvoiceListItem | null>(null);
  readonly pendingSupplierInvoice = signal<AdminSupplierInvoiceListItem | null>(null);
  readonly auditInvoiceId = signal<string | null>(null);
  readonly supplierAuditInvoiceId = signal<string | null>(null);
  readonly supplierAuditLogs = signal<BillingAuditLogResponse[]>([]);
  readonly supplierAuditLogsLoading = signal(false);
  readonly previewLoading = signal(false);
  readonly previewDetail = signal<InvoicePreviewView | null>(null);

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
  readonly statisticsByCountry$ = this.adminBillingFacade.statisticsByCountry$;
  readonly statisticsByCountryLoading$ = this.adminBillingFacade.statisticsByCountryLoading$;
  readonly statisticsError$ = this.adminBillingFacade.statisticsError$;
  readonly auditLogsByInvoice$ = this.adminBillingFacade.auditLogsByInvoice$;
  readonly auditLogsLoading$ = this.adminBillingFacade.auditLogsLoading$;

  readonly invoicesLoading$ = this.invoiceManagerFacade.loading$;
  readonly invoicesCreating$ = this.invoiceManagerFacade.creating$;
  readonly invoicesUpdating$ = this.invoiceManagerFacade.updating$;
  readonly invoicesIssuing$ = this.invoiceManagerFacade.issuing$;
  readonly invoicesDeleting$ = this.invoiceManagerFacade.deleting$;
  readonly invoicesError$ = this.invoiceManagerFacade.error$;
  readonly invoicesHasMore$ = this.invoiceManagerFacade.hasMore$;
  readonly invoicesAppendLoading$ = this.invoiceManagerFacade.appendLoading$;
  readonly invoicesAppendError$ = this.invoiceManagerFacade.appendError$;

  readonly invoices$ = this.invoiceManagerFacade.invoices$;

  readonly supplierSummary$ = this.supplierInvoiceManagerFacade.summary$;
  readonly supplierSummaryLoading$ = this.supplierInvoiceManagerFacade.summaryLoading$;
  readonly supplierSummaryError$ = this.supplierInvoiceManagerFacade.summaryError$;
  readonly supplierInvoicesLoading$ = this.supplierInvoiceManagerFacade.loading$;
  readonly supplierInvoicesCreating$ = this.supplierInvoiceManagerFacade.creating$;
  readonly supplierInvoicesUpdating$ = this.supplierInvoiceManagerFacade.updating$;
  readonly supplierInvoicesIssuing$ = this.supplierInvoiceManagerFacade.issuing$;
  readonly supplierInvoicesDeleting$ = this.supplierInvoiceManagerFacade.deleting$;
  readonly supplierInvoicesParsing$ = this.supplierInvoiceManagerFacade.parsing$;
  readonly supplierParsePreview$ = this.supplierInvoiceManagerFacade.parsePreview$;
  readonly supplierParseError$ = this.supplierInvoiceManagerFacade.parseError$;
  readonly supplierActionLoading$ = this.supplierInvoiceManagerFacade.actionLoading$;
  readonly supplierInvoicesError$ = this.supplierInvoiceManagerFacade.error$;
  readonly supplierInvoicesHasMore$ = this.supplierInvoiceManagerFacade.hasMore$;
  readonly supplierInvoicesAppendLoading$ = this.supplierInvoiceManagerFacade.appendLoading$;
  readonly supplierInvoicesAppendError$ = this.supplierInvoiceManagerFacade.appendError$;
  readonly supplierInvoices$ = this.supplierInvoiceManagerFacade.invoices$;

  readonly users = toSignal(this.authFacade.users$, { initialValue: [] as UserResponseDto[] });
  readonly statisticsSummary = toSignal(this.statisticsSummary$, { initialValue: null });
  readonly statisticsByProduct = toSignal(this.statisticsByProduct$, { initialValue: null });
  readonly statisticsByCountry = toSignal(this.statisticsByCountry$, { initialValue: null });
  readonly auditLogsByInvoice = toSignal(this.auditLogsByInvoice$, {
    initialValue: {} as Record<string, BillingAuditLogResponse[]>,
  });
  readonly invoices = toSignal(this.invoices$, { initialValue: [] as AdminInvoiceListItem[] });
  readonly supplierInvoices = toSignal(this.supplierInvoices$, { initialValue: [] as AdminSupplierInvoiceListItem[] });
  readonly supplierSummary = toSignal(this.supplierSummary$, { initialValue: null });

  readonly createInvoiceSubscriptions = signal<SubscriptionResponse[]>([]);
  readonly createInvoiceSubscriptionsLoading = signal(false);

  readonly selectedAuditLogs = computed(() => {
    const supplierId = this.supplierAuditInvoiceId();

    if (supplierId) {
      return this.supplierAuditLogs();
    }

    const id = this.auditInvoiceId();

    if (!id) return [] as BillingAuditLogResponse[];

    return this.auditLogsByInvoice()[id] ?? [];
  });

  readonly seriesChartOptions = computed(() => this.buildSeriesChart(this.statisticsSummary()?.series ?? []));
  readonly expenseSeriesChartOptions = computed(() =>
    this.buildSeriesChart(this.supplierSummary()?.series ?? [], {
      seriesName: $localize`:@@featureAdminBilling-chartExpensesSeries:Expenses`,
      title: $localize`:@@featureAdminBilling-chartExpensesTitle:Expenses over time`,
    }),
  );
  readonly donutChartOptions = computed(() => this.buildDonutChart(this.statisticsByProduct()?.items ?? []));
  readonly countryDonutChartOptions = computed(() =>
    this.buildCountryDonutChart(this.statisticsByCountry()?.items ?? []),
  );

  createUserId = '';
  createSubscriptionId = '';
  createInvoiceType: AdminBillingPerspective = 'customer';
  createSupplierId = '';
  createContractNumber = '';
  createInvoiceNumber = '';
  createIssueDate = '';
  createDueDate = '';
  createSupplierFile: File | null = null;
  createSupplierLineItems: SupplierInvoiceFormLineItem[] = [this.emptySupplierLineItem()];
  editSupplierInvoiceId = '';
  editSupplierLineItems: SupplierInvoiceFormLineItem[] = [this.emptySupplierLineItem()];
  editSupplierContractNumber = '';
  editSupplierInvoiceNumber = '';
  editSupplierIssueDate = '';
  editSupplierDueDate = '';
  issueSupplierInvoiceId = '';
  issueSupplierInvoiceNumber = '';
  issueSupplierIssueDate = '';
  issueSupplierDueDate = '';
  deleteSupplierInvoice: AdminSupplierInvoiceListItem | null = null;
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
    this.refreshTaxRates();

    this.invoiceSearch$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.invoiceManagerFacade.loadInvoices({ search: search.trim() || undefined });
      });

    this.supplierInvoiceSearch$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.supplierInvoiceManagerFacade.loadInvoices({ search: search.trim() || undefined });
      });

    this.supplierParsePreview$
      .pipe(
        filter((preview) => !!preview),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((preview) => {
        if (!preview) return;

        if (preview.issueDate) this.createIssueDate = preview.issueDate.slice(0, 10);

        if (preview.dueDate) this.createDueDate = preview.dueDate.slice(0, 10);

        if (preview.lineItems.length > 0) {
          this.createSupplierLineItems = preview.lineItems.map((line) => this.mapParsedSupplierLine(line));
        }
      });

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
    this.reloadActiveStatistics();
  }

  onResetFilters(): void {
    this.setDefaultDates();
    this.groupBy.set('day');
    this.selectedUserId.set(null);
    this.selectedSupplierId.set(null);
    this.persistFilters();
    this.reloadActiveStatistics();
  }

  openBillNowModal(): void {
    this.billNowScope.set('all');
    this.billNowUserId = '';
    showBillingModal(this.billNowModal);
    queueMicrotask(() => this.billNowUserSelect?.reset());
  }

  onBillingPerspectiveChange(perspective: AdminBillingPerspective): void {
    this.billingPerspective.set(perspective);

    if (perspective === 'supplier') {
      this.loadSupplierDashboard();
    }
  }

  openCreateModal(): void {
    this.resetCreateForm();
    this.createInvoiceType = this.billingPerspective();
    this.refreshTaxRates();
    showBillingModal(this.createModal);
    queueMicrotask(() => {
      this.createInvoiceUserSelect?.reset();
      this.createInvoiceSubscriptionSelect?.reset();
      this.createInvoiceSupplierSelect?.reset();
      this.createInvoiceContractSelect?.reset();
    });
  }

  onCreateInvoiceUserChanged(userId: string): void {
    this.createSubscriptionId = '';
    this.createInvoiceSubscriptionSelect?.reset();
    this.loadCreateInvoiceSubscriptions(userId);
    this.refreshTaxRates(userId || undefined);
  }

  openEditModal(invoice: AdminInvoiceListItem): void {
    this.editSupplierInvoiceId = '';
    this.editInvoiceId = invoice.id;
    this.refreshTaxRates(invoice.userId);
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
    this.deleteSupplierInvoice = null;
    this.deleteInvoice = invoice;
    showBillingModal(this.deleteModal);
  }

  submitBillNow(): void {
    const dto = this.billNowScope() === 'user' && this.billNowUserId ? { userId: this.billNowUserId } : {};

    this.adminBillingFacade.billNow(dto);
  }

  submitCreate(): void {
    if (this.createInvoiceType === 'supplier') {
      if (!this.createSupplierId || !this.hasValidSupplierLineItems(this.createSupplierLineItems)) return;

      const formData = new FormData();

      formData.append('supplierId', this.createSupplierId);

      if (this.createContractNumber.trim()) {
        formData.append('contractNumber', this.createContractNumber.trim());
      }

      if (this.createInvoiceNumber.trim()) {
        formData.append('invoiceNumber', this.createInvoiceNumber.trim());
      }

      if (this.createIssueDate) formData.append('issueDate', this.createIssueDate);

      if (this.createDueDate) formData.append('dueDate', this.createDueDate);

      formData.append('lineItems', JSON.stringify(this.mapSupplierLineItemsForSubmit(this.createSupplierLineItems)));

      if (this.createSupplierFile) {
        formData.append('document', this.createSupplierFile);
      }

      this.supplierInvoiceManagerFacade.createInvoice(formData);
      return;
    }

    if (!this.createUserId || !this.hasValidLineItems(this.createLineItems)) return;

    this.invoiceManagerFacade.createManualInvoice({
      userId: this.createUserId,
      subscriptionId: this.createSubscriptionId.trim() || undefined,
      lineItems: this.mapLineItemsForSubmit(this.createLineItems),
    });
  }

  onCreateSupplierFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    this.createSupplierFile = file;

    if (file) {
      this.supplierInvoiceManagerFacade.parseDocument(file);
    } else {
      this.supplierInvoiceManagerFacade.clearParsePreview();
    }
  }

  openEditSupplierModal(invoice: AdminSupplierInvoiceListItem): void {
    this.editInvoiceId = '';
    this.editSupplierInvoiceId = invoice.id;
    this.supplierInvoicesService.getById(invoice.id).subscribe({
      next: (detail) => {
        this.editSupplierContractNumber = detail.contractNumber ?? '';
        this.editSupplierInvoiceNumber = detail.invoiceNumber ?? '';
        this.editSupplierIssueDate = detail.issueDate?.slice(0, 10) ?? '';
        this.editSupplierDueDate = detail.dueDate?.slice(0, 10) ?? '';
        this.editSupplierLineItems =
          detail.lineItems.length > 0
            ? detail.lineItems.map((line) => this.mapSupplierDetailLine(line))
            : [this.emptySupplierLineItem()];
        showBillingModal(this.editModal);
      },
    });
  }

  submitEditSupplier(): void {
    if (!this.editSupplierInvoiceId || !this.hasValidSupplierLineItems(this.editSupplierLineItems)) return;

    this.supplierInvoiceManagerFacade.updateInvoice(this.editSupplierInvoiceId, {
      contractNumber: this.editSupplierContractNumber.trim() || null,
      invoiceNumber: this.editSupplierInvoiceNumber.trim() || null,
      issueDate: this.editSupplierIssueDate || null,
      dueDate: this.editSupplierDueDate || null,
      lineItems: this.mapSupplierLineItemsForSubmit(this.editSupplierLineItems),
    });
  }

  openIssueSupplierModal(invoice: AdminSupplierInvoiceListItem): void {
    this.issueInvoiceId = '';
    this.issueSupplierInvoiceId = invoice.id;
    this.issueSupplierInvoiceNumber = invoice.invoiceNumber ?? '';
    this.issueSupplierIssueDate = invoice.issueDate?.slice(0, 10) ?? '';
    this.issueSupplierDueDate = invoice.dueDate?.slice(0, 10) ?? '';
    showBillingModal(this.issueModal);
  }

  submitIssueSupplier(): void {
    if (!this.issueSupplierInvoiceId) return;

    this.supplierInvoiceManagerFacade.issueInvoice(this.issueSupplierInvoiceId, {
      invoiceNumber: this.issueSupplierInvoiceNumber.trim(),
      issueDate: this.issueSupplierIssueDate || undefined,
      dueDate: this.issueSupplierDueDate || undefined,
    });
  }

  openDeleteSupplierModal(invoice: AdminSupplierInvoiceListItem): void {
    this.deleteInvoice = null;
    this.deleteSupplierInvoice = invoice;
    showBillingModal(this.deleteModal);
  }

  confirmDeleteSupplier(): void {
    if (!this.deleteSupplierInvoice) return;

    this.supplierInvoiceManagerFacade.deleteInvoice(this.deleteSupplierInvoice.id);
  }

  openSupplierActionModal(action: 'void' | 'markPaid' | 'markUnpaid', invoice: AdminSupplierInvoiceListItem): void {
    this.pendingAction.set(action);
    this.pendingSupplierInvoice.set(invoice);
    this.pendingInvoice.set(null);
    this.actionReason.set('');
    this.actionPaidAt.set(action === 'markPaid' ? this.defaultPaidAtLocalInput() : '');
    showBillingModal(this.actionConfirmModal);
  }

  confirmSupplierAction(): void {
    const invoice = this.pendingSupplierInvoice();
    const action = this.pendingAction();

    if (!invoice || !action) return;

    const reason = this.actionReason().trim() || undefined;

    if (action === 'void') {
      this.supplierInvoiceManagerFacade.voidInvoice(invoice.id);
    } else if (action === 'markPaid') {
      this.supplierInvoiceManagerFacade.markPaid(invoice.id, {
        reason,
        paidAt: this.toPaidAtIso(this.actionPaidAt()),
      });
    } else {
      this.supplierInvoiceManagerFacade.markUnpaid(invoice.id, { reason });
    }
  }

  openSupplierAuditHistory(invoice: AdminSupplierInvoiceListItem): void {
    this.supplierAuditInvoiceId.set(invoice.id);
    this.supplierAuditLogsLoading.set(true);
    this.supplierAuditLogs.set([]);
    showBillingModal(this.auditHistoryModal);
    this.supplierInvoicesService.listAuditLogs(invoice.id).subscribe({
      next: (response) => {
        this.supplierAuditLogs.set(response.items);
        this.supplierAuditLogsLoading.set(false);
      },
      error: () => {
        this.supplierAuditLogsLoading.set(false);
      },
    });
  }

  downloadSupplierInvoice(invoice: AdminSupplierInvoiceListItem): void {
    if (!invoice.canDownload) return;

    this.downloadPdfBlob(
      this.supplierInvoicesService.downloadDocument(invoice.id),
      `${invoice.invoiceNumber ?? invoice.id}.pdf`,
    );
  }

  canDownloadSupplierInvoice(invoice: AdminSupplierInvoiceListItem): boolean {
    return invoice.canDownload === true;
  }

  canPreviewInvoice(invoice: AdminInvoiceListItem): boolean {
    return !this.isDraft(invoice);
  }

  canPreviewSupplierInvoice(invoice: AdminSupplierInvoiceListItem): boolean {
    return !this.isDraft(invoice);
  }

  openPreview(invoice: AdminInvoiceListItem): void {
    if (!this.canPreviewInvoice(invoice)) return;

    this.previewLoading.set(true);
    this.previewDetail.set(null);
    showBillingModal(this.previewInvoiceModal);
    this.adminBillingService
      .getManualInvoiceDetail(invoice.id)
      .pipe(finalize(() => this.previewLoading.set(false)))
      .subscribe({
        next: (detail) => this.previewDetail.set(this.mapCustomerPreview(detail)),
        error: () => this.previewDetail.set(null),
      });
  }

  openSupplierPreview(invoice: AdminSupplierInvoiceListItem): void {
    if (!this.canPreviewSupplierInvoice(invoice)) return;

    this.previewLoading.set(true);
    this.previewDetail.set(null);
    showBillingModal(this.previewInvoiceModal);
    this.supplierInvoicesService
      .getById(invoice.id)
      .pipe(finalize(() => this.previewLoading.set(false)))
      .subscribe({
        next: (detail) => this.previewDetail.set(this.mapSupplierPreview(detail)),
        error: () => this.previewDetail.set(null),
      });
  }

  taxOptionsForTarget(target: string) {
    return target === 'createSupplier' || target === 'editSupplier'
      ? this.supplierTaxCategoryOptions()
      : this.taxCategoryOptions();
  }

  isCustomTaxLine(line: InvoiceFormLineItem | SupplierInvoiceFormLineItem): boolean {
    return line.taxCategory === 'custom';
  }

  onTaxCategoryChange(
    line: InvoiceFormLineItem | SupplierInvoiceFormLineItem,
    value: 'standard' | 'reduced' | 'custom',
  ): void {
    line.taxCategory = value;

    if (value !== 'custom') {
      line.taxRate = undefined;
    } else if (line.taxRate == null) {
      line.taxRate = 0;
    }
  }

  supplierInvoiceDisplayTitle(invoice: AdminSupplierInvoiceListItem): string {
    if (invoice.invoiceNumber) return invoice.invoiceNumber;

    return getInvoiceStatusLabel('draft');
  }

  supplierInvoiceLabel(invoice: AdminSupplierInvoiceListItem): string {
    return invoice.supplierName?.trim() || invoice.supplierNumber?.trim() || getUnavailableLabel();
  }

  supplierFilterOptionLabel(supplier: AdminSupplierProfileListItem): string {
    const name = supplier.company?.trim() || [supplier.firstName, supplier.lastName].filter(Boolean).join(' ').trim();

    return name ? `${name} (${supplier.supplierNumber})` : supplier.supplierNumber;
  }

  submitEdit(): void {
    if (this.editSupplierInvoiceId) {
      this.submitEditSupplier();
      return;
    }

    if (!this.editInvoiceId || !this.hasValidLineItems(this.editLineItems)) return;

    this.invoiceManagerFacade.updateManualInvoice(this.editInvoiceId, {
      lineItems: this.mapLineItemsForSubmit(this.editLineItems),
    });
  }

  submitIssue(): void {
    if (this.issueSupplierInvoiceId) {
      this.submitIssueSupplier();
      return;
    }

    if (!this.issueInvoiceId) return;

    this.invoiceManagerFacade.issueManualInvoice(this.issueInvoiceId, { dueInDays: this.issueDueInDays });
  }

  confirmDelete(): void {
    if (this.deleteSupplierInvoice) {
      this.confirmDeleteSupplier();
      return;
    }

    if (!this.deleteInvoice) return;

    this.invoiceManagerFacade.deleteManualInvoice(this.deleteInvoice.id);
  }

  openActionModal(action: 'void' | 'markPaid' | 'markUnpaid', invoice: AdminInvoiceListItem): void {
    this.pendingAction.set(action);
    this.pendingInvoice.set(invoice);
    this.pendingSupplierInvoice.set(null);
    this.actionReason.set('');
    this.actionPaidAt.set(action === 'markPaid' ? this.defaultPaidAtLocalInput() : '');
    showBillingModal(this.actionConfirmModal);
  }

  confirmAction(): void {
    if (this.pendingSupplierInvoice()) {
      this.confirmSupplierAction();
      return;
    }

    const invoice = this.pendingInvoice();
    const action = this.pendingAction();

    if (!invoice || !action) return;

    const reason = this.actionReason().trim() || undefined;

    if (action === 'void') {
      this.invoiceManagerFacade.voidInvoice(invoice.id);
    } else if (action === 'markPaid') {
      this.invoiceManagerFacade.markPaid(invoice.id, {
        reason,
        paidAt: this.toPaidAtIso(this.actionPaidAt()),
      });
    } else {
      this.invoiceManagerFacade.markUnpaid(invoice.id, { reason });
    }
  }

  openAuditHistory(invoice: AdminInvoiceListItem): void {
    this.supplierAuditInvoiceId.set(null);
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

  addLineItem(target: 'create' | 'edit' | 'createSupplier' | 'editSupplier'): void {
    if (target === 'create') {
      this.createLineItems = [...this.createLineItems, this.emptyLineItem()];
    } else if (target === 'createSupplier') {
      this.createSupplierLineItems = [...this.createSupplierLineItems, this.emptySupplierLineItem()];
    } else if (target === 'editSupplier') {
      this.editSupplierLineItems = [...this.editSupplierLineItems, this.emptySupplierLineItem()];
    } else {
      this.editLineItems = [...this.editLineItems, this.emptyLineItem()];
    }
  }

  removeLineItem(target: 'create' | 'edit' | 'createSupplier' | 'editSupplier', index: number): void {
    if (target === 'create' && this.createLineItems.length > 1) {
      this.createLineItems = this.createLineItems.filter((_, i) => i !== index);
    }

    if (target === 'createSupplier' && this.createSupplierLineItems.length > 1) {
      this.createSupplierLineItems = this.createSupplierLineItems.filter((_, i) => i !== index);
    }

    if (target === 'editSupplier' && this.editSupplierLineItems.length > 1) {
      this.editSupplierLineItems = this.editSupplierLineItems.filter((_, i) => i !== index);
    }

    if (target === 'edit' && this.editLineItems.length > 1) {
      this.editLineItems = this.editLineItems.filter((_, i) => i !== index);
    }
  }

  isDraft(invoice: Pick<AdminInvoiceListItem, 'status'> | Pick<AdminSupplierInvoiceListItem, 'status'>): boolean {
    return invoice.status === 'draft';
  }

  canMarkPaid(invoice: Pick<AdminInvoiceListItem, 'status'> | Pick<AdminSupplierInvoiceListItem, 'status'>): boolean {
    return ['issued', 'partially_paid', 'overdue'].includes(invoice.status ?? '');
  }

  canMarkUnpaid(invoice: Pick<AdminInvoiceListItem, 'status'> | Pick<AdminSupplierInvoiceListItem, 'status'>): boolean {
    return invoice.status === 'paid';
  }

  canVoid(invoice: Pick<AdminInvoiceListItem, 'status'> | Pick<AdminSupplierInvoiceListItem, 'status'>): boolean {
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
    if (this.billingPerspective() === 'supplier') {
      this.loadSupplierDashboard();
      return;
    }

    this.adminBillingFacade.loadSummary();
    this.invoiceManagerFacade.loadInvoices({ search: this.invoiceSearch().trim() || undefined });
  }

  private loadSupplierDashboard(): void {
    this.loadSupplierFilterOptions();
    this.loadSupplierStatistics();
    this.supplierInvoiceManagerFacade.loadInvoices({ search: this.supplierInvoiceSearch().trim() || undefined });
  }

  private reloadActiveStatistics(): void {
    if (this.billingPerspective() === 'supplier') {
      this.loadSupplierStatistics();
      return;
    }

    this.loadStatistics();
  }

  private loadSupplierStatistics(): void {
    this.supplierInvoiceManagerFacade.loadSummary({
      from: this.fromDate(),
      to: this.toDate(),
      groupBy: this.groupBy(),
      supplierId: this.selectedSupplierId() ?? undefined,
    });
  }

  private loadSupplierFilterOptions(): void {
    this.supplierProfilesService.list({ limit: 200, offset: 0 }).subscribe({
      next: (response) => this.supplierFilterOptions.set(response.items),
      error: () => this.supplierFilterOptions.set([]),
    });
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
    this.adminBillingFacade.loadStatisticsByCountry(params);
  }

  private setDefaultDates(): void {
    const to = new Date();
    const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

    from.setUTCDate(from.getUTCDate() - 30);
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

      if (stored.supplierId !== undefined) this.selectedSupplierId.set(stored.supplierId);

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
      supplierId: this.selectedSupplierId(),
      filtersCollapsed: this.filtersCollapsed(),
    };

    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(payload));
  }

  lineItemSummary(line: InvoiceFormLineItem | SupplierInvoiceFormLineItem): PricingTotalsSummary | null {
    const totals = this.computeLineItemTotals(line);

    if (!totals) {
      return null;
    }

    return buildPricingTotalsSummary({
      net: totals.net,
      tax: totals.tax,
      taxRate: totals.taxRate,
      gross: totals.gross,
    });
  }

  draftTotalsSummary(items: Array<InvoiceFormLineItem | SupplierInvoiceFormLineItem>): PricingTotalsSummary | null {
    return aggregatePricingTotalsSummaries(items.map((item) => this.lineItemSummary(item)));
  }

  private emptyLineItem(): InvoiceFormLineItem {
    return { description: '', quantity: 1, unitPriceNet: 0, taxCategory: 'standard' };
  }

  private emptySupplierLineItem(): SupplierInvoiceFormLineItem {
    return { description: '', quantity: 1, unitPriceNet: 0, taxCategory: 'standard' };
  }

  private hasValidLineItems(items: InvoiceFormLineItem[]): boolean {
    return items.every((item) => item.description.trim().length > 0 && item.quantity > 0 && item.unitPriceNet >= 0);
  }

  private hasValidSupplierLineItems(items: SupplierInvoiceFormLineItem[]): boolean {
    return items.every((item) => {
      if (!item.description.trim() || item.quantity <= 0 || item.unitPriceNet < 0) {
        return false;
      }

      if (item.taxCategory === 'custom') {
        return item.taxRate != null && Number.isFinite(Number(item.taxRate)) && Number(item.taxRate) >= 0;
      }

      return true;
    });
  }

  private mapLineItemsForSubmit(items: InvoiceFormLineItem[]): ManualInvoiceLineItemDto[] {
    return items.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unitPriceNet: Number(item.unitPriceNet),
      taxCategory: item.taxCategory === 'custom' ? 'standard' : (item.taxCategory ?? 'standard'),
    }));
  }

  private mapSupplierLineItemsForSubmit(items: SupplierInvoiceFormLineItem[]): SupplierInvoiceLineItemDto[] {
    return items.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unitPriceNet: Number(item.unitPriceNet),
      taxCategory: item.taxCategory ?? 'standard',
      taxRate: item.taxCategory === 'custom' ? Number(item.taxRate ?? 0) : undefined,
    }));
  }

  private mapParsedSupplierLine(line: {
    description: string;
    quantity: number;
    unitPriceNet: number;
    taxRate?: number;
  }): SupplierInvoiceFormLineItem {
    const rates = this.taxRates();
    const taxRate = line.taxRate;

    if (taxRate == null || !Number.isFinite(taxRate)) {
      return {
        description: line.description,
        quantity: line.quantity,
        unitPriceNet: line.unitPriceNet,
        taxCategory: 'standard',
      };
    }

    if (Math.abs(taxRate - rates.standard) < 0.001) {
      return {
        description: line.description,
        quantity: line.quantity,
        unitPriceNet: line.unitPriceNet,
        taxCategory: 'standard',
      };
    }

    if (Math.abs(taxRate - rates.reduced) < 0.001) {
      return {
        description: line.description,
        quantity: line.quantity,
        unitPriceNet: line.unitPriceNet,
        taxCategory: 'reduced',
      };
    }

    return {
      description: line.description,
      quantity: line.quantity,
      unitPriceNet: line.unitPriceNet,
      taxCategory: 'custom',
      taxRate,
    };
  }

  private mapSupplierDetailLine(line: {
    description: string;
    quantity: number;
    unitPriceNet: number;
    taxCategory: string;
    taxRate: number;
  }): SupplierInvoiceFormLineItem {
    const category = line.taxCategory === 'reduced' || line.taxCategory === 'custom' ? line.taxCategory : 'standard';

    return {
      description: line.description,
      quantity: line.quantity,
      unitPriceNet: line.unitPriceNet,
      taxCategory: category,
      ...(category === 'custom' ? { taxRate: line.taxRate } : {}),
    };
  }

  private computeLineItemTotals(
    line: InvoiceFormLineItem | SupplierInvoiceFormLineItem,
  ): { net: number; tax: number; gross: number; taxRate: number } | null {
    const quantity = Number(line.quantity);
    const unitPriceNet = Number(line.unitPriceNet);

    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPriceNet) || unitPriceNet < 0) {
      return null;
    }

    const taxRate =
      line.taxCategory === 'custom'
        ? Number(line.taxRate ?? 0)
        : rateForTaxCategory(this.taxRates(), line.taxCategory === 'reduced' ? 'reduced' : 'standard');

    if (!Number.isFinite(taxRate) || taxRate < 0) {
      return null;
    }

    return computeLineTotalsFromRate(quantity, unitPriceNet, taxRate);
  }

  private refreshTaxRates(userId?: string): void {
    this.adminBillingService
      .previewTax(userId ? { userId } : {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => this.taxRates.set(preview.rates),
        error: () => undefined,
      });
  }

  private resetCreateForm(): void {
    this.createUserId = '';
    this.createSubscriptionId = '';
    this.createSupplierId = '';
    this.createContractNumber = '';
    this.createInvoiceNumber = '';
    this.createIssueDate = '';
    this.createDueDate = '';
    this.createSupplierFile = null;
    this.createLineItems = [this.emptyLineItem()];
    this.createSupplierLineItems = [this.emptySupplierLineItem()];
    this.supplierInvoiceManagerFacade.clearParsePreview();
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
      loading$: this.supplierInvoicesCreating$,
      error$: this.supplierInvoiceManagerFacade.error$,
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
      loading$: this.supplierInvoicesUpdating$,
      error$: this.supplierInvoiceManagerFacade.error$,
      modal: () => this.editModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.editSupplierInvoiceId = '';
        this.editSupplierLineItems = [this.emptySupplierLineItem()];
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
      loading$: this.supplierInvoicesIssuing$,
      error$: this.supplierInvoiceManagerFacade.error$,
      modal: () => this.issueModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.issueSupplierInvoiceId = '';
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
      loading$: this.supplierInvoicesDeleting$,
      error$: this.supplierInvoiceManagerFacade.error$,
      modal: () => this.deleteModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.deleteSupplierInvoice = null;
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
        this.pendingSupplierInvoice.set(null);
        this.actionReason.set('');
        this.actionPaidAt.set('');
        refreshDashboard();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.supplierActionLoading$,
      error$: this.supplierInvoicesError$,
      modal: () => this.actionConfirmModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.pendingAction.set(null);
        this.pendingInvoice.set(null);
        this.pendingSupplierInvoice.set(null);
        this.actionReason.set('');
        this.actionPaidAt.set('');
        refreshDashboard();
      },
    });
  }

  private defaultPaidAtLocalInput(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');

    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  private toPaidAtIso(localValue: string): string {
    const trimmed = localValue.trim();

    if (!trimmed) {
      return new Date().toISOString();
    }

    const parsed = new Date(trimmed);

    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
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

  private buildSeriesChart(series: BillingStatisticsSeriesPoint[], labels?: { seriesName: string; title: string }) {
    const filled = fillPeriodSeriesPoints(series, this.fromDate(), this.toDate(), this.groupBy(), (period) => ({
      period,
      totalGross: 0,
    }));

    if (filled.length === 0) {
      return null;
    }

    const seriesName = labels?.seriesName ?? $localize`:@@featureAdminBilling-chartTurnoverSeries:Turnover`;
    const title = labels?.title ?? $localize`:@@featureAdminBilling-chartTurnoverTitle:Turnover over time`;

    return {
      series: [{ name: seriesName, data: filled.map((p) => p.totalGross) }] as ApexAxisChartSeries,
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
        type: 'category',
        categories: filled.map((p) => this.formatChartPeriodLabel(p.period)),
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
        text: title,
        style: { color: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
      } as ApexTitleSubtitle,
    };
  }

  /** Format YYYY-MM-DD period keys in UTC so chart labels match calendar issue/issued dates. */
  private formatChartPeriodLabel(period: string): string {
    const format = this.groupBy() === 'month' ? 'MMM y' : 'mediumDate';

    return this.datePipe.transform(`${period}T12:00:00.000Z`, format, 'UTC') ?? period;
  }

  private buildDonutChart(items: { planName: string; totalGross: number }[]) {
    return this.buildTurnoverDonutChart(
      items.map((i) => ({ label: i.planName, totalGross: i.totalGross })),
      $localize`:@@featureAdminBilling-chartProductTitle:Turnover by product`,
    );
  }

  private buildCountryDonutChart(items: { countryName: string; totalGross: number }[]) {
    return this.buildTurnoverDonutChart(
      items.map((i) => ({ label: i.countryName, totalGross: i.totalGross })),
      $localize`:@@featureAdminBilling-chartCountryTitle:Turnover by country`,
    );
  }

  private buildTurnoverDonutChart(items: { label: string; totalGross: number }[], title: string) {
    if (items.length === 0) return null;

    const series = items.map((i) => i.totalGross);
    const formatEuro = (value: number): string =>
      `€${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return {
      series: series as ApexNonAxisChartSeries,
      chart: { type: 'donut', height: 240, background: 'transparent' } as ApexChart,
      labels: items.map((i) => i.label),
      colors: BS_CHART_COLORS.slice(0, items.length),
      dataLabels: {
        enabled: true,
        formatter: (percent: number) => `${percent.toFixed(1)}%`,
        style: {
          fontSize: '10px',
          colors: ['#ffffff'],
          fontFamily: 'var(--bs-body-font-family)',
        },
      } as ApexDataLabels,
      legend: {
        labels: { colors: 'var(--bs-body-color)' },
        fontFamily: 'var(--bs-body-font-family)',
      },
      tooltip: {
        y: {
          formatter: (value: number) => formatEuro(value),
        },
      } as ApexTooltip,
      title: {
        text: title,
        style: { color: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
      } as ApexTitleSubtitle,
    };
  }

  private mapCustomerPreview(detail: ManualInvoiceDetailResponse): InvoicePreviewView {
    return {
      title: detail.invoiceNumber ?? detail.id,
      status: String(detail.status),
      issueDate: detail.issuedAt ?? detail.createdAt,
      dueDate: detail.dueDate,
      currency: detail.currency,
      lineItems: detail.lineItems.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPriceNet: line.unitPriceNet,
        lineNet: line.lineNet,
        lineTax: line.lineTax,
        taxRate: line.taxRate,
        lineGross: line.lineGross,
      })),
      taxBreakdown: (detail.taxBreakdown ?? []).map((tax) => ({
        taxRate: tax.taxRate,
        taxAmount: tax.taxAmount,
      })),
      subtotalNet: detail.subtotalNet,
      taxTotal: detail.taxTotal,
      totalGross: detail.totalGross,
      balanceDue: detail.balanceDue,
    };
  }

  private mapSupplierPreview(detail: SupplierInvoiceDetailResponse): InvoicePreviewView {
    return {
      title: detail.invoiceNumber ?? detail.id,
      status: String(detail.status),
      // Prefer calendar issue date over lifecycle issuedAt (archive timestamp).
      issueDate: detail.issueDate ?? detail.issuedAt ?? detail.createdAt,
      dueDate: detail.dueDate,
      currency: detail.currency,
      lineItems: detail.lineItems.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPriceNet: line.unitPriceNet,
        lineNet: line.lineNet,
        lineTax: line.lineTax,
        taxRate: line.taxRate,
        lineGross: line.lineGross,
      })),
      taxBreakdown: this.buildTaxBreakdownFromLines(detail.lineItems),
      subtotalNet: detail.subtotalNet,
      taxTotal: detail.taxTotal,
      totalGross: detail.totalGross,
      balanceDue: detail.balanceDue,
    };
  }

  private buildTaxBreakdownFromLines(lines: Array<{ taxRate: number; lineTax: number }>): InvoicePreviewTaxBreakdown[] {
    const byRate = new Map<number, number>();

    for (const line of lines) {
      byRate.set(line.taxRate, (byRate.get(line.taxRate) ?? 0) + line.lineTax);
    }

    return [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([taxRate, taxAmount]) => ({ taxRate, taxAmount }));
  }
}
