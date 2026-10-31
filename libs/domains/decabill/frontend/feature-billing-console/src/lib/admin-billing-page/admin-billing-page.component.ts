import { CommonModule, DatePipe } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  LOCALE_ID,
  OnInit,
  signal,
  untracked,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
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
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcListToolbarComponent,
  fpcListQueryState,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormCheckGroupComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcKeyValueListComponent,
  FpcLaneHeaderComponent,
  FpcListHeaderComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  fpcRunBulk,
  FpcTableCellDirective,
  type FpcKeyValueItem,
  type FpcMenuItem,
  type FpcTableColumn,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
  FpcTabComponent,
  FpcTabGroupComponent,
  FPC_CHART_AREA_FILL,
  FPC_CHART_GRID,
  FPC_CHART_SLICE_LABELS,
  FPC_CHART_SLICE_TOOLTIP,
  fpcChart,
  fpcChartCategorical,
  fpcChartValueAxis,
  FPC_CHART_LEGEND_SCROLL,
  fpcChartColor,
  type FpcBadgeTone,
  FpcBoardLaneComponent,
  FpcSectionRowComponent,
  FpcSectionColumnComponent,
  FpcDatePipe,
  FpcMoneyPipe,
} from '@forepath/shared/frontend/ui-components';
import type {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexFill,
  ApexLegend,
  ApexNonAxisChartSeries,
  ApexStroke,
  ApexTooltip,
  ApexXAxis,
  ApexYAxis,
} from 'ng-apexcharts';
import { NgApexchartsModule } from 'ng-apexcharts';
import { filter, finalize, firstValueFrom, Observable, pairwise, Subscription } from 'rxjs';

import { BillingAdminSubscriptionSelectComponent } from '../billing-admin-subscription-select/billing-admin-subscription-select.component';
import { BillingAdminSupplierContractSelectComponent } from '../billing-admin-supplier-contract-select/billing-admin-supplier-contract-select.component';
import { BillingAdminSupplierSelectComponent } from '../billing-admin-supplier-select/billing-admin-supplier-select.component';
import { BillingAdminUserSelectComponent } from '../billing-admin-user-select/billing-admin-user-select.component';
import { getInvoiceStatusBadgeTone, getInvoiceStatusLabel, getUnavailableLabel } from '../billing-status-labels';
import { hideBillingModal, showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { PricingTotalsSummaryComponent } from '../pricing-totals-summary/pricing-totals-summary.component';
import { DB_DL_CANCEL, dbBulkSummary, dbCopyIdItem, type DbBulkResult } from '../shared/data-list';
import { invoiceSummaryItems, invoiceTaxItems } from '../shared/invoice-totals';
import { dbServerPaging } from '../shared/server-paging';
import { invoiceState } from '../shared/table-states';
import {
  aggregatePricingTotalsSummaries,
  buildPricingTotalsSummary,
  type PricingTotalsSummary,
} from '../pricing-totals-summary/pricing-totals.util';
import {
  getCustomerLabel,
  getCustomerSecondaryLabel,
  getUnnumberedInvoiceLabel,
  type CustomerLabelSource,
} from '../named-label.util';
import { BILLING_CHART_RESPONSIVE, billingChartTimeAxis } from '../billing-chart';
import { formatBillingDate, formatBillingDateRange, formatBillingMoney } from '../billing-format';
import { ThemeService } from '../theme.service';

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

type AdminBillingMobilePanel = 'overview' | 'invoices';
type AdminBillingPerspective = 'customer' | 'supplier';

@Component({
  selector: 'framework-admin-billing-page',
  standalone: true,
  imports: [
    FpcMoneyPipe,
    FpcDatePipe,
    FpcBoardLaneComponent,
    FpcSectionRowComponent,
    FpcSectionColumnComponent,
    CommonModule,
    FormsModule,
    NgApexchartsModule,
    BillingAdminUserSelectComponent,
    BillingAdminSubscriptionSelectComponent,
    BillingAdminSupplierSelectComponent,
    BillingAdminSupplierContractSelectComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcListToolbarComponent,
    FpcFormCheckComponent,
    FpcFormCheckGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcDataTableComponent,
    FpcKeyValueListComponent,
    FpcLaneHeaderComponent,
    FpcListHeaderComponent,
    FpcTableCellDirective,
    FpcConfirmDialogComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcSummaryCardValueDirective,
    FpcTabComponent,
    FpcTabGroupComponent,
    PricingTotalsSummaryComponent,
  ],
  providers: [DatePipe],
  templateUrl: './admin-billing-page.component.html',
  styleUrls: ['./admin-billing-page.component.scss'],
})
export class AdminBillingPageComponent implements OnInit {
  readonly billNowModalOpen = signal(false);
  readonly actionConfirmModalOpen = signal(false);
  readonly auditHistoryModalOpen = signal(false);
  readonly previewInvoiceModalOpen = signal(false);
  readonly createModalOpen = signal(false);
  readonly editModalOpen = signal(false);
  readonly issueModalOpen = signal(false);
  readonly deleteModalOpen = signal(false);

  @ViewChild('createInvoiceUserSelect') private createInvoiceUserSelect?: BillingAdminUserSelectComponent;
  @ViewChild('createInvoiceSubscriptionSelect')
  private createInvoiceSubscriptionSelect?: BillingAdminSubscriptionSelectComponent;
  @ViewChild('createInvoiceSupplierSelect') private createInvoiceSupplierSelect?: BillingAdminSupplierSelectComponent;
  @ViewChild('createInvoiceContractSelect')
  private createInvoiceContractSelect?: BillingAdminSupplierContractSelectComponent;
  @ViewChild('billNowUserSelect') private billNowUserSelect?: BillingAdminUserSelectComponent;

  private createInvoiceSubscriptionsRequest?: Subscription;

  private readonly adminBillingFacade = inject(AdminBillingFacade);
  private readonly themeService = inject(ThemeService);
  readonly invoiceManagerFacade = inject(AdminInvoiceManagerFacade);
  readonly supplierInvoiceManagerFacade = inject(AdminSupplierInvoiceManagerFacade);
  private readonly adminBillingService = inject(AdminBillingService);
  private readonly supplierInvoicesService = inject(AdminSupplierInvoicesService);
  private readonly supplierProfilesService = inject(AdminSupplierProfilesService);
  private readonly invoicesFacade = inject(InvoicesFacade);
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly datePipe = inject(DatePipe);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureAdminBilling-title:Billing`;
  readonly perspectiveLabel = $localize`:@@featureAdminBilling-perspective:Perspective`;
  readonly customerTabLabel = $localize`:@@featureAdminBilling-customerTab:Customer`;
  readonly supplierTabLabel = $localize`:@@featureAdminBilling-supplierTab:Supplier`;
  readonly addInvoiceAriaLabel = $localize`:@@featureAdminInvoices-add:Add`;
  readonly billNowAriaLabel = $localize`:@@featureAdminBilling-billNow:Bill now`;

  readonly billingPerspective = signal<AdminBillingPerspective>('customer');
  readonly filtersCollapsed = signal(true);
  readonly filtersPanelTitle = $localize`:@@featureAdminBilling-filters:Filters`;
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly groupBy = signal<'day' | 'month'>('day');
  readonly selectedUserId = signal<string | null>(null);
  /** Applied statistics scope for the toolbar strip: "Sep 29 – Oct 29, 2026 · By day · ACME GmbH". */
  readonly statisticsScopeLabel = computed(() => {
    const parts = [formatBillingDateRange(this.fromDate() || null, this.toDate() || null, '')].filter(Boolean);

    parts.push(
      this.groupBy() === 'month'
        ? $localize`:@@featureAdminBilling-scopeByMonth:By month`
        : $localize`:@@featureAdminBilling-scopeByDay:By day`,
    );

    const userId = this.selectedUserId();

    if (userId) {
      const user = this.users().find((entry) => entry.id === userId);

      parts.push(user?.email ?? getUnavailableLabel());
    }

    return parts.join(' · ');
  });
  readonly selectedSupplierId = signal<string | null>(null);
  readonly filtersOpen = computed(() => !this.filtersCollapsed());
  /** Applied range / grouping (+ party) in the URL (`?f=`); the drawer edits a draft until Apply (3.38 R12). */
  readonly filterState = fpcListQueryState({
    filters: {
      from: this.fromDate,
      to: this.toDate,
      groupBy: this.groupBy,
      user: this.selectedUserId,
      supplier: this.selectedSupplierId,
    },
    open: this.filtersOpen,
    changed: () => this.onApplyFilters(),
  });
  /** Defaults of the date range (set with the page), so a custom range counts as one applied filter. */
  private readonly defaultDates = signal({ from: '', to: '' });
  readonly activeFilterCount = computed(() => {
    const f = this.filterState.applied();
    const d = this.defaultDates();

    return [f.from !== d.from || f.to !== d.to, f.groupBy !== 'day', !!f.user, !!f.supplier].filter(Boolean).length;
  });
  readonly supplierFilterOptions = signal<AdminSupplierProfileListItem[]>([]);
  /** Customer invoices: search + page + size → `GET /admin/billing/invoices?limit&offset&search` (replace-page). */
  readonly invoicePaging = dbServerPaging((query) => this.invoiceManagerFacade.loadInvoices(query));
  /** Supplier invoices (loaded only in the supplier perspective). */
  readonly supplierInvoicePaging = dbServerPaging(
    (query) => {
      if (this.billingPerspective() === 'supplier') this.supplierInvoiceManagerFacade.loadInvoices(query);
    },
    { filters: () => this.billingPerspective() },
  );

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
  readonly supplierAuditLogsTotal = signal(0);
  readonly supplierAuditLogsLoading = signal(false);
  /** Audit log paging (built-in pager of the nested table; replace-page) for customer and supplier invoices. */
  readonly auditPage = signal(1);
  readonly auditPageSize = signal(25);
  private readonly auditOpenCount = signal(0);
  private supplierAuditRequest?: Subscription;
  readonly previewLoading = signal(false);
  readonly previewDetail = signal<InvoicePreviewView | null>(null);

  readonly summary$ = this.adminBillingFacade.summary$;
  readonly summaryLoading$ = this.adminBillingFacade.summaryLoading$;
  readonly summaryError$ = this.adminBillingFacade.summaryError$;
  readonly activeSubscriptionsLabel = $localize`:@@featureAdminBilling-activeSubscriptions:Active subscriptions`;
  readonly openOverdueCountLabel = $localize`:@@featureAdminBilling-openOverdueCount:Open and overdue invoices`;
  readonly openOverdueTotalLabel = $localize`:@@featureAdminBilling-openOverdueTotal:Open total amount`;
  readonly unbilledTotalLabel = $localize`:@@featureAdminBilling-unbilledTotal:Unbilled amount`;
  readonly supplierInvoiceCountLabel = $localize`:@@featureAdminBilling-supplierInvoiceCount:Supplier invoices`;
  readonly supplierOpenCountLabel = $localize`:@@featureAdminBilling-supplierOpenCount:Open expenses`;
  readonly supplierOpenTotalLabel = $localize`:@@featureAdminBilling-supplierOpenTotal:Open total amount`;
  readonly supplierExpenseTotalLabel = $localize`:@@featureAdminBilling-supplierExpenseTotal:Total expenses`;
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
  readonly invoicesTotal = toSignal(this.invoiceManagerFacade.total$, { initialValue: 0 });
  readonly invoicesError = toSignal(this.invoiceManagerFacade.error$, { initialValue: null });

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
  readonly supplierInvoicesTotal = toSignal(this.supplierInvoiceManagerFacade.total$, { initialValue: 0 });
  readonly supplierInvoicesError = toSignal(this.supplierInvoiceManagerFacade.error$, { initialValue: null });
  readonly supplierInvoices$ = this.supplierInvoiceManagerFacade.invoices$;

  readonly users = toSignal(this.authFacade.users$, { initialValue: [] as UserResponseDto[] });
  readonly statisticsSummary = toSignal(this.statisticsSummary$, { initialValue: null });
  readonly statisticsByProduct = toSignal(this.statisticsByProduct$, { initialValue: null });
  readonly statisticsByCountry = toSignal(this.statisticsByCountry$, { initialValue: null });
  readonly auditLogsByInvoice = toSignal(this.auditLogsByInvoice$, {
    initialValue: {} as Record<string, BillingAuditLogResponse[]>,
  });
  private readonly auditLogsTotalByInvoice = toSignal(this.adminBillingFacade.auditLogsTotalByInvoice$, {
    initialValue: {} as Record<string, number>,
  });
  private readonly customerAuditLogsLoading = toSignal(this.auditLogsLoading$, { initialValue: false });
  /** Server total of the open audit log (customer or supplier invoice). */
  readonly auditLogsTotal = computed(() => {
    if (this.supplierAuditInvoiceId()) return this.supplierAuditLogsTotal();

    const id = this.auditInvoiceId();

    return id ? (this.auditLogsTotalByInvoice()[id] ?? 0) : 0;
  });
  readonly auditLoading = computed(() =>
    this.supplierAuditInvoiceId() ? this.supplierAuditLogsLoading() : this.customerAuditLogsLoading(),
  );
  /** Loads the requested audit page whenever the open invoice, the page or the size changes (replace-page). */
  private readonly loadAuditPage = effect(() => {
    const invoiceId = this.auditInvoiceId();
    const supplierInvoiceId = this.supplierAuditInvoiceId();
    const page = this.auditPage();
    const pageSize = this.auditPageSize();

    this.auditOpenCount();
    untracked(() => {
      if (supplierInvoiceId) this.loadSupplierAuditLogs(supplierInvoiceId, page, pageSize);
      else if (invoiceId) this.adminBillingFacade.loadAuditLogs(invoiceId, page, pageSize);
    });
  });
  readonly invoices = toSignal(this.invoices$, { initialValue: [] as AdminInvoiceListItem[] });
  readonly supplierInvoices = toSignal(this.supplierInvoices$, { initialValue: [] as AdminSupplierInvoiceListItem[] });
  readonly supplierSummary = toSignal(this.supplierSummary$, { initialValue: null });

  readonly createInvoiceSubscriptions = signal<SubscriptionResponse[]>([]);
  readonly createInvoiceSubscriptionsLoading = signal(false);

  private readonly locale = inject(LOCALE_ID);
  readonly invoicesTitle = $localize`:@@featureAdminBilling-invoicesTitle:Invoices`;
  readonly invoiceSearchPlaceholder = $localize`:@@featureAdminInvoices-searchPlaceholder:Search invoices`;
  readonly supplierInvoiceSearchPlaceholder = $localize`:@@featureAdminSupplierInvoices-searchPlaceholder:Search supplier invoices`;
  readonly auditHistoryLabel = $localize`:@@featureAdminBilling-auditHistoryTitle:Audit history`;
  readonly editDraftLabel = $localize`:@@featureAdminInvoices-editButtonTitle:Edit draft`;
  readonly issueLabel = $localize`:@@featureAdminInvoices-issueButtonTitle:Issue invoice`;
  readonly deleteDraftLabel = $localize`:@@featureAdminInvoices-deleteButtonTitle:Delete draft`;
  readonly previewLabel = $localize`:@@featureInvoices-previewButtonTitle:Preview invoice`;
  readonly voidLabel = $localize`:@@featureAdminInvoices-voidButtonTitle:Void invoice`;
  readonly markPaidLabel = $localize`:@@featureAdminInvoices-markPaidButtonTitle:Mark as paid`;
  readonly markUnpaidLabel = $localize`:@@featureAdminInvoices-markUnpaidButtonTitle:Mark as unpaid`;
  readonly downloadPdfLabel = $localize`:@@featureAdminInvoices-downloadPdfButtonTitle:Download PDF`;
  readonly downloadVoidPdfLabel = $localize`:@@featureAdminInvoices-downloadVoidPdfButtonTitle:Download void PDF`;
  readonly downloadTimeReportLabel = $localize`:@@featureAdminInvoices-downloadTimeReportButtonTitle:Download time report`;
  readonly historyLabel = $localize`:@@featureAdminInvoices-historyButtonTitle:View history`;
  readonly archiveExpenseLabel = $localize`:@@featureAdminSupplierInvoices-archiveButtonTitle:Archive expense`;
  readonly downloadDocumentLabel = $localize`:@@featureAdminSupplierInvoices-downloadButtonTitle:Download document`;
  readonly deleteDraftsLabel = $localize`:@@featureAdminBilling-deleteDraftsSelected:Delete drafts`;
  readonly cancelLabel = DB_DL_CANCEL;

  /** Customer invoices: State · Invoice · customer · amount · created. */
  readonly invoiceColumns: FpcTableColumn<AdminInvoiceListItem>[] = [
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
      id: 'customer',
      label: $localize`:@@featureAdminBilling-colCustomer:Customer`,
      value: (inv) => getCustomerLabel(inv),
      priority: 1,
    },
    {
      id: 'amount',
      label: $localize`:@@featureInvoices-colTotal:Total`,
      value: (inv) => formatBillingMoney(Number(inv.totalGross ?? inv.balance ?? 0)),
      align: 'end',
      priority: 2,
    },
    {
      id: 'created',
      label: $localize`:@@featureInvoices-colCreated:Created`,
      value: (inv) => this.formatDate(inv.createdAt),
      priority: 2,
    },
  ];

  /** Supplier invoices: State · Invoice · supplier · amount · issue date · due date. */
  readonly supplierInvoiceColumns: FpcTableColumn<AdminSupplierInvoiceListItem>[] = [
    {
      id: 'status',
      label: $localize`:@@featureInvoices-colStatus:Status`,
      type: 'state',
      state: (inv) => invoiceState(inv.status),
    },
    {
      id: 'invoice',
      label: $localize`:@@featureInvoices-colInvoice:Invoice`,
      value: (inv) => this.supplierInvoiceDisplayTitle(inv),
      required: true,
      priority: 1,
    },
    {
      id: 'supplier',
      label: $localize`:@@featureAdminBilling-colSupplier:Supplier`,
      value: (inv) => this.supplierInvoiceLabel(inv),
      priority: 1,
    },
    {
      id: 'amount',
      label: $localize`:@@featureInvoices-colTotal:Total`,
      value: (inv) => formatBillingMoney(Number(inv.totalGross ?? 0), inv.currency),
      align: 'end',
      priority: 2,
    },
    {
      id: 'issued',
      label: $localize`:@@featureAdminSupplierInvoices-issueDate:Issue date`,
      value: (inv) => (inv.issueDate ? this.formatDate(inv.issueDate) : ''),
      priority: 2,
    },
    {
      id: 'due',
      label: $localize`:@@featureAdminSupplierInvoices-dueDate:Due date`,
      value: (inv) => (inv.dueDate ? this.formatDate(inv.dueDate) : ''),
      priority: 3,
    },
  ];

  /** Audit history (modal): Process · Time · Message. */
  readonly auditColumns: FpcTableColumn<BillingAuditLogResponse>[] = [
    {
      id: 'process',
      label: $localize`:@@featureAdminBilling-colProcess:Process`,
      value: (log) => log.process,
      required: true,
      priority: 1,
    },
    { id: 'time', label: $localize`:@@featureProjectDetail-colTime:Time`, value: (log) => log.createdAt, priority: 1 },
    {
      id: 'message',
      label: $localize`:@@featureAdminBilling-colMessage:Message`,
      value: (log) => log.message,
      priority: 2,
    },
  ];

  readonly selectedInvoices = signal<readonly string[]>([]);
  readonly selectedSupplierInvoices = signal<readonly string[]>([]);
  readonly bulkResult = signal<DbBulkResult | null>(null);
  readonly pendingBulk = signal<'void' | 'delete' | 'supplier-delete' | null>(null);
  readonly bulkConfirmTitle = computed(() =>
    this.pendingBulk() === 'void'
      ? $localize`:@@featureAdminBilling-bulkVoidTitle:Void invoices?`
      : $localize`:@@featureAdminBilling-bulkDeleteTitle:Delete drafts?`,
  );
  readonly bulkConfirmLabel = computed(() => (this.pendingBulk() === 'void' ? this.voidLabel : this.deleteDraftsLabel));
  readonly bulkConfirmMessage = computed(() => {
    const pending = this.pendingBulk();
    const count =
      pending === 'void'
        ? this.invoiceBulkTargets('void').length
        : pending === 'delete'
          ? this.invoiceBulkTargets('delete').length
          : this.supplierBulkTargets('delete').length;

    return pending === 'void'
      ? $localize`:@@featureAdminBilling-bulkVoidMessage:${count}:count: selected invoices will be voided (a credit note is issued for each). This cannot be undone.`
      : $localize`:@@featureAdminBilling-bulkDeleteMessage:${count}:count: selected drafts will be deleted. This cannot be undone.`;
  });

  readonly invoiceMenu = (inv: AdminInvoiceListItem): FpcMenuItem[] => {
    const menu: FpcMenuItem[] = [];

    if (this.isDraft(inv)) {
      menu.push(
        { id: 'edit', label: this.editDraftLabel, icon: 'pencil' },
        { id: 'issue', label: this.issueLabel, icon: 'send' },
        { id: 'delete', label: this.deleteDraftLabel, icon: 'trash', danger: true },
      );
    } else {
      if (this.canPreviewInvoice(inv)) menu.push({ id: 'preview', label: this.previewLabel, icon: 'eye' });
      if (this.canMarkPaid(inv)) menu.push({ id: 'markPaid', label: this.markPaidLabel, icon: 'check2-circle' });
      if (this.canMarkUnpaid(inv))
        menu.push({ id: 'markUnpaid', label: this.markUnpaidLabel, icon: 'arrow-counterclockwise' });
      if (inv.canDownload) menu.push({ id: 'download', label: this.downloadPdfLabel, icon: 'file-earmark-pdf' });
      if (inv.canDownloadVoidDocument) {
        menu.push({ id: 'download-void', label: this.downloadVoidPdfLabel, icon: 'file-earmark-x' });
      }
      if (inv.canDownloadTimeReport) {
        menu.push({ id: 'download-time', label: this.downloadTimeReportLabel, icon: 'file-earmark-text' });
      }
      if (this.canVoid(inv))
        menu.push({ id: 'void', label: this.voidLabel, icon: 'x-octagon', danger: true, dividerBefore: true });
      menu.push({ id: 'history', label: this.historyLabel, icon: 'clock-history', dividerBefore: true });
    }

    menu.push(dbCopyIdItem());

    return menu;
  };

  readonly supplierInvoiceMenu = (inv: AdminSupplierInvoiceListItem): FpcMenuItem[] => {
    const menu: FpcMenuItem[] = [];

    if (this.isDraft(inv)) {
      menu.push(
        { id: 'edit', label: this.editDraftLabel, icon: 'pencil' },
        { id: 'issue', label: this.archiveExpenseLabel, icon: 'archive' },
      );
      if (this.canDownloadSupplierInvoice(inv)) {
        menu.push({ id: 'download', label: this.downloadDocumentLabel, icon: 'file-earmark-arrow-down' });
      }
      menu.push({ id: 'delete', label: this.deleteDraftLabel, icon: 'trash', danger: true, dividerBefore: true });
    } else {
      if (this.canPreviewSupplierInvoice(inv)) menu.push({ id: 'preview', label: this.previewLabel, icon: 'eye' });
      if (this.canMarkPaid(inv)) menu.push({ id: 'markPaid', label: this.markPaidLabel, icon: 'check2-circle' });
      if (this.canMarkUnpaid(inv))
        menu.push({ id: 'markUnpaid', label: this.markUnpaidLabel, icon: 'arrow-counterclockwise' });
      if (this.canDownloadSupplierInvoice(inv)) {
        menu.push({ id: 'download', label: this.downloadDocumentLabel, icon: 'file-earmark-arrow-down' });
      }
      if (this.canVoid(inv))
        menu.push({ id: 'void', label: this.voidLabel, icon: 'x-octagon', danger: true, dividerBefore: true });
      menu.push({ id: 'history', label: this.historyLabel, icon: 'clock-history', dividerBefore: true });
    }

    menu.push(dbCopyIdItem());

    return menu;
  };

  readonly selectedAuditLogs = computed(() => {
    const supplierId = this.supplierAuditInvoiceId();

    if (supplierId) {
      return this.supplierAuditLogs();
    }

    const id = this.auditInvoiceId();

    if (!id) return [] as BillingAuditLogResponse[];

    return this.auditLogsByInvoice()[id] ?? [];
  });

  readonly turnoverChartTitle = $localize`:@@featureAdminBilling-chartTurnoverTitle:Turnover over time`;
  readonly expensesChartTitle = $localize`:@@featureAdminBilling-chartExpensesTitle:Expenses over time`;
  readonly productChartTitle = $localize`:@@featureAdminBilling-chartProductTitle:Turnover by product`;
  readonly countryChartTitle = $localize`:@@featureAdminBilling-chartCountryTitle:Turnover by country`;

  readonly seriesChartOptions = computed(() => this.buildSeriesChart(this.statisticsSummary()?.series ?? []));
  readonly expenseSeriesChartOptions = computed(() =>
    this.buildSeriesChart(
      this.supplierSummary()?.series ?? [],
      $localize`:@@featureAdminBilling-chartExpensesSeries:Expenses`,
    ),
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
  /** Scopes the contract typeahead in the edit modal. */
  editSupplierId = '';
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

  customerLabel(row: CustomerLabelSource): string {
    return getCustomerLabel(row);
  }

  customerTitle(row: CustomerLabelSource): string | null {
    return getCustomerSecondaryLabel(row);
  }

  ngOnInit(): void {
    this.restoreFilters();
    this.setDefaultDates(false);
    this.adminBillingFacade.loadSummary();
    this.loadStatistics();
    this.authFacade.loadUsers();
    this.refreshTaxRates();

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
        hideBillingModal(this.billNowModalOpen);
        this.refreshDashboard();
      });

    this.registerModalCloseWatchers();
  }

  onFiltersOpenChange(open: boolean): void {
    this.filtersCollapsed.set(!open);
    this.persistFilters();
  }

  onApplyFilters(): void {
    this.filtersCollapsed.set(true);
    this.persistFilters();
    this.reloadActiveStatistics();
  }

  onResetFilters(): void {
    this.setDefaultDates();
    this.groupBy.set('day');
    this.selectedUserId.set(null);
    this.selectedSupplierId.set(null);
    this.filtersCollapsed.set(true);
    this.persistFilters();
    this.reloadActiveStatistics();
  }

  openBillNowModal(): void {
    this.billNowScope.set('all');
    this.billNowUserId = '';
    showBillingModal(this.billNowModalOpen);
    queueMicrotask(() => this.billNowUserSelect?.reset());
  }

  onBillingPerspectiveChange(perspective: AdminBillingPerspective): void {
    this.billingPerspective.set(perspective);

    if (perspective === 'supplier') {
      this.loadSupplierDashboard();
    }
  }

  onBillingPerspectiveTabChange(perspective: string | null): void {
    if (perspective !== 'customer' && perspective !== 'supplier') {
      return;
    }

    this.onBillingPerspectiveChange(perspective);
  }

  onMobilePanelTabChange(tabId: string | null): void {
    if (tabId === 'overview' || tabId === 'invoices') {
      this.mobilePanel.set(tabId);
    }
  }

  openCreateModal(): void {
    this.resetCreateForm();
    this.createInvoiceType = this.billingPerspective();
    this.refreshTaxRates();
    showBillingModal(this.createModalOpen);
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
        showBillingModal(this.editModalOpen);
      },
    });
  }

  openIssueModal(invoice: AdminInvoiceListItem): void {
    this.issueInvoiceId = invoice.id;
    this.issueDueInDays = 14;
    showBillingModal(this.issueModalOpen);
  }

  openDeleteModal(invoice: AdminInvoiceListItem): void {
    this.deleteSupplierInvoice = null;
    this.deleteInvoice = invoice;
    showBillingModal(this.deleteModalOpen);
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

  onCreateSupplierFileSelected(files: FileList | null): void {
    const file = files?.[0] ?? null;

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
    this.editSupplierId = invoice.supplierId;
    this.supplierInvoicesService.getById(invoice.id).subscribe({
      next: (detail) => {
        this.editSupplierId = detail.supplierId || invoice.supplierId;
        this.editSupplierContractNumber = detail.contractNumber ?? '';
        this.editSupplierInvoiceNumber = detail.invoiceNumber ?? '';
        this.editSupplierIssueDate = detail.issueDate?.slice(0, 10) ?? '';
        this.editSupplierDueDate = detail.dueDate?.slice(0, 10) ?? '';
        this.editSupplierLineItems =
          detail.lineItems.length > 0
            ? detail.lineItems.map((line) => this.mapSupplierDetailLine(line))
            : [this.emptySupplierLineItem()];
        showBillingModal(this.editModalOpen);
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
    showBillingModal(this.issueModalOpen);
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
    showBillingModal(this.deleteModalOpen);
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
    showBillingModal(this.actionConfirmModalOpen);
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
    this.auditInvoiceId.set(null);
    this.supplierAuditInvoiceId.set(invoice.id);
    this.supplierAuditLogs.set([]);
    this.supplierAuditLogsTotal.set(0);
    this.auditPage.set(1);
    this.auditOpenCount.update((count) => count + 1);
    showBillingModal(this.auditHistoryModalOpen);
  }

  /** One page of a supplier invoice's audit log (`GET …/supplier-invoices/:id/audit-logs?limit&offset`). */
  private loadSupplierAuditLogs(invoiceId: string, page: number, pageSize: number): void {
    this.supplierAuditRequest?.unsubscribe();
    this.supplierAuditLogsLoading.set(true);
    this.supplierAuditRequest = this.supplierInvoicesService
      .listAuditLogs(invoiceId, pageSize, (page - 1) * pageSize)
      .subscribe({
        next: (response) => {
          this.supplierAuditLogs.set(response.items);
          this.supplierAuditLogsTotal.set(response.total);
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
    showBillingModal(this.previewInvoiceModalOpen);
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
    showBillingModal(this.previewInvoiceModalOpen);
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

    return getUnnumberedInvoiceLabel();
  }

  supplierInvoiceLabel(invoice: AdminSupplierInvoiceListItem): string {
    return invoice.supplierName?.trim() || invoice.supplierNumber?.trim() || getUnavailableLabel();
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
    showBillingModal(this.actionConfirmModalOpen);
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
    this.auditPage.set(1);
    this.auditOpenCount.update((count) => count + 1);
    showBillingModal(this.auditHistoryModalOpen);
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

  onInvoiceAction(inv: AdminInvoiceListItem, action: string): void {
    if (action === 'edit') this.openEditModal(inv);
    else if (action === 'issue') this.openIssueModal(inv);
    else if (action === 'delete') this.openDeleteModal(inv);
    else if (action === 'preview') this.openPreview(inv);
    else if (action === 'void' || action === 'markPaid' || action === 'markUnpaid') this.openActionModal(action, inv);
    else if (action === 'download') this.downloadInvoice(inv);
    else if (action === 'download-void') this.downloadVoidDocument(inv);
    else if (action === 'download-time') this.downloadTimeReport(inv);
    else if (action === 'history') this.openAuditHistory(inv);
    else if (action === 'copy-id') fpcCopyText(inv.id);
  }

  onSupplierInvoiceAction(inv: AdminSupplierInvoiceListItem, action: string): void {
    if (action === 'edit') this.openEditSupplierModal(inv);
    else if (action === 'issue') this.openIssueSupplierModal(inv);
    else if (action === 'delete') this.openDeleteSupplierModal(inv);
    else if (action === 'preview') this.openSupplierPreview(inv);
    else if (action === 'void' || action === 'markPaid' || action === 'markUnpaid')
      this.openSupplierActionModal(action, inv);
    else if (action === 'download') this.downloadSupplierInvoice(inv);
    else if (action === 'history') this.openSupplierAuditHistory(inv);
    else if (action === 'copy-id') fpcCopyText(inv.id);
  }

  /** Selected customer invoices a bulk action applies to (same rules as the row menu). */
  invoiceBulkTargets(action: 'markPaid' | 'void' | 'delete'): AdminInvoiceListItem[] {
    const ids = new Set(this.selectedInvoices());

    return this.invoices().filter(
      (inv) =>
        ids.has(inv.id) &&
        (action === 'delete'
          ? this.isDraft(inv)
          : !this.isDraft(inv) && (action === 'void' ? this.canVoid(inv) : this.canMarkPaid(inv))),
    );
  }

  supplierBulkTargets(action: 'markPaid' | 'delete'): AdminSupplierInvoiceListItem[] {
    const ids = new Set(this.selectedSupplierInvoices());

    return this.supplierInvoices().filter(
      (inv) =>
        ids.has(inv.id) && (action === 'delete' ? this.isDraft(inv) : !this.isDraft(inv) && this.canMarkPaid(inv)),
    );
  }

  /** Bulk on customer invoices: one call per invoice (mark-paid / void / delete draft), per-item result. */
  async runInvoiceBulk(action: 'markPaid' | 'void' | 'delete'): Promise<void> {
    const targets = this.invoiceBulkTargets(action);

    if (targets.length === 0) return;

    const result = await fpcRunBulk(targets, (inv) =>
      firstValueFrom<unknown>(
        action === 'markPaid'
          ? this.adminBillingService.markPaid(inv.id, {})
          : action === 'void'
            ? this.adminBillingService.voidInvoice(inv.id)
            : this.adminBillingService.deleteManualInvoice(inv.id),
      ),
    );

    this.bulkResult.set(dbBulkSummary(result, (inv) => this.invoiceDisplayTitle(inv)));
    this.selectedInvoices.set([]);
    this.invoicePaging.reload();
  }

  /** Bulk on supplier invoices: one call per invoice (mark-paid / delete draft), per-item result. */
  async runSupplierBulk(action: 'markPaid' | 'delete'): Promise<void> {
    const targets = this.supplierBulkTargets(action);

    if (targets.length === 0) return;

    const result = await fpcRunBulk(targets, (inv) =>
      firstValueFrom<unknown>(
        action === 'markPaid'
          ? this.supplierInvoicesService.markPaid(inv.id, {})
          : this.supplierInvoicesService.delete(inv.id),
      ),
    );

    this.bulkResult.set(dbBulkSummary(result, (inv) => this.supplierInvoiceDisplayTitle(inv)));
    this.selectedSupplierInvoices.set([]);
    this.supplierInvoicePaging.reload();
  }

  confirmPendingBulk(): void {
    const pending = this.pendingBulk();

    this.pendingBulk.set(null);

    if (pending === 'void' || pending === 'delete') void this.runInvoiceBulk(pending);
    else if (pending === 'supplier-delete') void this.runSupplierBulk('delete');
  }

  auditTime(log: BillingAuditLogResponse): string {
    return log.createdAt;
  }

  taxItems(detail: Parameters<typeof invoiceTaxItems>[0]): FpcKeyValueItem[] {
    return invoiceTaxItems(detail, this.locale);
  }

  summaryItems(detail: Parameters<typeof invoiceSummaryItems>[0]): FpcKeyValueItem[] {
    return invoiceSummaryItems(detail, this.locale);
  }

  formatDate(value?: string | Date): string {
    if (!value) return '-';

    return formatBillingDate(value, '-');
  }

  invoiceDisplayTitle(invoice: AdminInvoiceListItem): string {
    if (invoice.invoiceNumber) return invoice.invoiceNumber;

    return getUnnumberedInvoiceLabel();
  }

  invoiceUserLabel(invoice: AdminInvoiceListItem): string {
    const email = invoice.userEmail?.trim();

    if (email) return email;

    return getUnavailableLabel();
  }

  invoiceStatusLabel(status: string | null | undefined): string {
    return getInvoiceStatusLabel(status);
  }

  invoiceStatusBadgeTone(status: string | null | undefined): FpcBadgeTone {
    return getInvoiceStatusBadgeTone(status);
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
    this.invoicePaging.reload();
  }

  private loadSupplierDashboard(): void {
    this.loadSupplierFilterOptions();
    this.loadSupplierStatistics();
    this.supplierInvoicePaging.reload();
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

  private setDefaultDates(force = true): void {
    const to = new Date();
    const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

    from.setUTCDate(from.getUTCDate() - 30);
    const defaults = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };

    this.defaultDates.set(defaults);

    if (!force && this.fromDate() && this.toDate()) return;

    this.toDate.set(defaults.to);
    this.fromDate.set(defaults.from);
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

  lineTitle(lineIndex: number): string {
    return $localize`:@@featureAdminOffers-lineTitle:Line ${lineIndex + 1}:position:`;
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
      open: this.createModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.resetCreateForm();
        refreshDashboard();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.supplierInvoicesCreating$,
      error$: this.supplierInvoiceManagerFacade.error$,
      open: this.createModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.resetCreateForm();
        refreshDashboard();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.invoicesUpdating$,
      error$: this.invoiceManagerFacade.error$,
      open: this.editModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.resetEditForm();
        refreshDashboard();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.supplierInvoicesUpdating$,
      error$: this.supplierInvoiceManagerFacade.error$,
      open: this.editModalOpen,
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
      open: this.issueModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.issueInvoiceId = '';
        refreshDashboard();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.supplierInvoicesIssuing$,
      error$: this.supplierInvoiceManagerFacade.error$,
      open: this.issueModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.issueSupplierInvoiceId = '';
        refreshDashboard();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.invoicesDeleting$,
      error$: this.invoiceManagerFacade.error$,
      open: this.deleteModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.deleteInvoice = null;
        refreshDashboard();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.supplierInvoicesDeleting$,
      error$: this.supplierInvoiceManagerFacade.error$,
      open: this.deleteModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.deleteSupplierInvoice = null;
        refreshDashboard();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.actionLoading$,
      error$: this.actionError$,
      open: this.actionConfirmModalOpen,
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
      open: this.actionConfirmModalOpen,
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

  private buildSeriesChart(series: BillingStatisticsSeriesPoint[], seriesLabel?: string) {
    const filled = fillPeriodSeriesPoints(series, this.fromDate(), this.toDate(), this.groupBy(), (period) => ({
      period,
      totalGross: 0,
    }));

    if (filled.length === 0) {
      return null;
    }

    const seriesName = seriesLabel ?? $localize`:@@featureAdminBilling-chartTurnoverSeries:Turnover`;

    return {
      series: [{ name: seriesName, data: filled.map((p) => p.totalGross) }] as ApexAxisChartSeries,
      chart: fpcChart('area', 240) as ApexChart,
      colors: [fpcChartColor(0)],
      stroke: { curve: 'smooth', width: 2 } as ApexStroke,
      fill: FPC_CHART_AREA_FILL as ApexFill,
      dataLabels: { enabled: false } as ApexDataLabels,
      // DB-17: thinned unrotated date ticks, compact currency ticks (`€25K`).
      xaxis: billingChartTimeAxis(filled.map((p) => this.formatChartPeriodLabel(p.period))) as ApexXAxis,
      yaxis: fpcChartValueAxis((value) => formatBillingMoney(value, undefined, { compact: true })) as ApexYAxis,
      grid: FPC_CHART_GRID,
      responsive: BILLING_CHART_RESPONSIVE,
    };
  }

  /** Format YYYY-MM-DD period keys in UTC so chart labels match calendar issue/issued dates. */
  private formatChartPeriodLabel(period: string): string {
    // Short axis labels (DB-17 a): the year sits in the range filter; days / weeks read "Oct 29".
    const format = this.groupBy() === 'month' ? 'MMM y' : 'MMM d';

    return this.datePipe.transform(`${period}T12:00:00.000Z`, format, 'UTC') ?? period;
  }

  private buildDonutChart(items: { planName: string; totalGross: number }[]) {
    return this.buildTurnoverDonutChart(items.map((i) => ({ label: i.planName, totalGross: i.totalGross })));
  }

  private buildCountryDonutChart(items: { countryName: string; totalGross: number }[]) {
    return this.buildTurnoverDonutChart(items.map((i) => ({ label: i.countryName, totalGross: i.totalGross })));
  }

  private buildTurnoverDonutChart(items: { label: string; totalGross: number }[]) {
    if (items.length === 0) return null;

    const series = items.map((i) => i.totalGross);
    const formatEuro = (value: number): string => formatBillingMoney(value);

    return {
      series: series as ApexNonAxisChartSeries,
      chart: fpcChart('donut', 240) as ApexChart,
      labels: items.map((i) => i.label),
      // Distinct categorical hues (the brand palette repeats green: primary = success).
      colors: fpcChartCategorical(items.length, this.themeService.isDarkMode()),
      dataLabels: {
        ...FPC_CHART_SLICE_LABELS,
        enabled: true,
        formatter: (percent: number) => `${percent.toFixed(1)}%`,
        style: { ...FPC_CHART_SLICE_LABELS.style, fontSize: '10px' },
      } as ApexDataLabels,
      legend: FPC_CHART_LEGEND_SCROLL as ApexLegend,
      responsive: BILLING_CHART_RESPONSIVE,
      tooltip: {
        ...FPC_CHART_SLICE_TOOLTIP,
        y: {
          formatter: (value: number) => formatEuro(value),
        },
      } as ApexTooltip,
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
