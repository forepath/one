import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminOffersFacade,
  AdminOffersService,
  fillPeriodSeriesPoints,
  type AdminOfferListItem,
  type BillingAuditLogResponse,
  type CreateAdminOfferDto,
  type OfferStatisticsSeriesPoint,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcListToolbarComponent,
  fpcListQueryState,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  fpcRunBulk,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  FPC_CHART_AREA_FILL,
  FPC_CHART_GRID,
  FPC_CHART_LEGEND,
  fpcChart,
  fpcChartCountAxis,
  type FpcMenuItem,
  type FpcTableColumn,
  FpcMoneyPipe,
} from '@forepath/shared/frontend/ui-components';
import type {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexFill,
  ApexLegend,
  ApexStroke,
  ApexXAxis,
  ApexYAxis,
} from 'ng-apexcharts';
import { NgApexchartsModule } from 'ng-apexcharts';
import { firstValueFrom, of, switchMap } from 'rxjs';

import { BillingAdminUserSelectComponent } from '../billing-admin-user-select/billing-admin-user-select.component';
import { getUnavailableLabel } from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { PricingTotalsSummaryComponent } from '../pricing-totals-summary/pricing-totals-summary.component';
import { DB_DL_CANCEL, DB_DL_DELETE, dbBulkSummary, dbCopyIdItem, type DbBulkResult } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';
import { offerState } from '../shared/table-states';
import { AdminOfferLineEditorComponent } from './admin-offer-line-editor.component';
import {
  createEmptyOfferFormLine,
  isOfferFormValid,
  mapOfferDetailLinesToForm,
  mapOfferFormLinesToDto,
  type OfferFormLineItem,
} from './admin-offer-form.util';
import {
  getCustomerLabel,
  getCustomerSecondaryLabel,
  getUnnumberedOfferLabel,
  type CustomerLabelSource,
} from '../named-label.util';
import { BILLING_CHART_RESPONSIVE, billingChartTimeAxis } from '../billing-chart';
import { formatBillingDateTime, formatBillingMoney } from '../billing-format';

type AdminOffersTab = 'offers' | 'statistics';

@Component({
  selector: 'framework-admin-offers-page',
  standalone: true,
  imports: [
    FpcMoneyPipe,
    CommonModule,
    FormsModule,
    NgApexchartsModule,
    BillingAdminUserSelectComponent,
    AdminOfferLineEditorComponent,
    PricingTotalsSummaryComponent,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormCheckComponent,
    FpcEmptyStateComponent,
    FpcListToolbarComponent,
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
    FpcTableCellDirective,
  ],
  providers: [DatePipe],
  templateUrl: './admin-offers-page.component.html',
  styleUrls: ['./admin-offers-page.component.scss'],
})
export class AdminOffersPageComponent implements OnInit {
  @ViewChild('createOfferUserSelect', { static: false })
  private createOfferUserSelect?: BillingAdminUserSelectComponent;
  @ViewChild('createLineEditor', { static: false })
  createLineEditor?: AdminOfferLineEditorComponent;
  @ViewChild('editLineEditor', { static: false })
  editLineEditor?: AdminOfferLineEditorComponent;

  readonly createModalOpen = signal(false);
  readonly editModalOpen = signal(false);
  readonly deleteModalOpen = signal(false);
  readonly auditHistoryModalOpen = signal(false);

  private readonly facade = inject(AdminOffersFacade);
  private readonly adminOffersService = inject(AdminOffersService);
  private readonly datePipe = inject(DatePipe);
  private readonly destroyRef = inject(DestroyRef);

  readonly activeTab = signal<AdminOffersTab>('offers');
  readonly filtersCollapsed = signal(true);
  readonly filtersPanelTitle = $localize`:@@featureAdminOffers-filters:Filters`;
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly groupBy = signal<'day' | 'month'>('day');
  readonly filtersOpen = computed(() => !this.filtersCollapsed());
  /** Applied range / grouping (+ party) in the URL (`?f=`); the drawer edits a draft until Apply (3.38 R12). */
  readonly filterState = fpcListQueryState({
    filters: { from: this.fromDate, to: this.toDate, groupBy: this.groupBy },
    open: this.filtersOpen,
    changed: () => this.onApplyFilters(),
  });
  /** Defaults of the date range (set with the page), so a custom range counts as one applied filter. */
  private readonly defaultDates = signal({ from: '', to: '' });
  readonly activeFilterCount = computed(() => {
    const f = this.filterState.applied();
    const d = this.defaultDates();

    return [f.from !== d.from || f.to !== d.to, f.groupBy !== 'day'].filter(Boolean).length;
  });
  filterUserId = '';
  readonly pageTitle = $localize`:@@featureAdminOffers-title:Offers`;
  readonly createOfferAriaLabel = $localize`:@@featureAdminOffers-create:Create offer`;

  readonly searchPlaceholder = $localize`:@@featureAdminOffers-searchPlaceholder:Search offers`;
  readonly auditOfferId = signal<string | null>(null);

  readonly offers$ = this.facade.offers$;
  readonly loading$ = this.facade.loading$;
  readonly mutating$ = this.facade.mutating$;
  readonly error$ = this.facade.error$;
  readonly statistics$ = this.facade.statistics$;
  readonly statisticsLoading$ = this.facade.statisticsLoading$;
  readonly draftCountLabel = $localize`:@@featureAdminOffers-draftCount:Draft`;
  readonly pendingCountLabel = $localize`:@@featureAdminOffers-pendingCount:Pending`;
  readonly acceptedCountLabel = $localize`:@@featureAdminOffers-acceptedCount:Accepted`;
  readonly pendingGrossLabel = $localize`:@@featureAdminOffers-pendingGross:Pending gross`;
  readonly statisticsError$ = this.facade.statisticsError$;
  readonly auditLogsLoading$ = this.facade.auditLogsLoading$;
  readonly auditLogsError$ = this.facade.auditLogsError$;

  readonly statistics = toSignal(this.statistics$, { initialValue: null });
  readonly offers = toSignal(this.offers$, { initialValue: [] as AdminOfferListItem[] });
  readonly total = toSignal(this.facade.total$, { initialValue: 0 });

  readonly selectedAuditLogs = toSignal(
    toObservable(this.auditOfferId).pipe(
      switchMap((offerId) => (offerId ? this.facade.getAuditLogsForOffer$(offerId) : of([]))),
    ),
    { initialValue: [] as BillingAuditLogResponse[] },
  );

  readonly auditLogsTotal = toSignal(
    toObservable(this.auditOfferId).pipe(
      switchMap((offerId) => (offerId ? this.facade.getAuditLogsTotal$(offerId) : of(0))),
    ),
    { initialValue: 0 },
  );
  /** Audit log paging (built-in pager of the nested table; replace-page). */
  readonly auditPage = signal(1);
  readonly auditPageSize = signal(25);
  private readonly auditOpenCount = signal(0);
  readonly auditHistoryLabel = $localize`:@@featureAdminOffers-auditTitle:Audit history`;
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

  /** Customer filter of the offers table (drawer draft → applied on Apply). */
  readonly offerFiltersOpen = signal(false);
  readonly offersUserId = signal('');
  offersUserIdDraft = '';

  /** Search + page + size + customer → `GET /admin/billing/offers?limit&offset&search&userId` (replace-page). */
  readonly paging = dbServerPaging(
    (query) =>
      this.facade.loadOffers({
        search: query.search,
        userId: untracked(this.offersUserId) || undefined,
        page: query.page,
        pageSize: query.pageSize,
      }),
    { filters: () => this.offersUserId() },
  );

  readonly columns: FpcTableColumn<AdminOfferListItem>[] = [
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
      id: 'customer',
      label: $localize`:@@featureAdminOffers-customer:Customer`,
      value: (offer) => getCustomerLabel(offer),
      priority: 1,
    },
    {
      id: 'total',
      label: $localize`:@@featureOffers-colTotal:Total (gross)`,
      value: (offer) => offer.totalGross,
      align: 'end',
      priority: 2,
    },
    {
      id: 'created',
      label: $localize`:@@featureAdminOffers-colCreated:Created`,
      value: (offer) => offer.createdAt,
      priority: 2,
    },
    {
      id: 'expires',
      label: $localize`:@@featureOffers-colExpires:Expires`,
      value: (offer) => (offer.expiresAt ? this.formatDate(offer.expiresAt) : ''),
      priority: 3,
    },
  ];

  readonly editLabel = $localize`:@@featureAdminOffers-edit:Edit`;
  readonly auditLabel = $localize`:@@featureAdminOffers-audit:Audit log`;
  readonly sendLabel = $localize`:@@featureAdminOffers-archive:Send to customer`;
  readonly revokeLabel = $localize`:@@featureAdminOffers-revoke:Revoke`;
  readonly deleteLabel = DB_DL_DELETE;
  readonly deleteDraftsLabel = $localize`:@@featureAdminOffers-bulkDeleteDrafts:Delete drafts`;
  readonly cancelLabel = DB_DL_CANCEL;

  readonly selected = signal<readonly string[]>([]);
  readonly bulkResult = signal<DbBulkResult | null>(null);
  readonly pendingBulk = signal<'revoke' | 'delete' | null>(null);
  readonly selectedOffers = computed(() => {
    const ids = new Set(this.selected());

    return this.offers().filter((offer) => ids.has(offer.id));
  });
  readonly selectedDrafts = computed(() => this.selectedOffers().filter((offer) => this.canDeleteOffer(offer)));
  readonly selectedPendingResponse = computed(() =>
    this.selectedOffers().filter((offer) => this.canRevokeOffer(offer)),
  );
  readonly bulkConfirmTitle = computed(() =>
    this.pendingBulk() === 'revoke'
      ? $localize`:@@featureAdminOffers-bulkRevokeTitle:Revoke offers?`
      : $localize`:@@featureAdminOffers-bulkDeleteTitle:Delete draft offers?`,
  );
  readonly bulkConfirmLabel = computed(() => (this.pendingBulk() === 'revoke' ? this.revokeLabel : this.deleteLabel));
  readonly bulkConfirmMessage = computed(() =>
    this.pendingBulk() === 'revoke'
      ? $localize`:@@featureAdminOffers-bulkRevokeMessage:${this.selectedPendingResponse().length}:count: offers awaiting a response will be revoked. Customers can no longer accept them.`
      : $localize`:@@featureAdminOffers-bulkDeleteMessage:${this.selectedDrafts().length}:count: draft offers will be deleted. This action cannot be undone.`,
  );
  readonly rowMenu = (offer: AdminOfferListItem): FpcMenuItem[] => [
    ...(this.canEditOffer(offer) ? [{ id: 'edit', label: this.editLabel, icon: 'pencil' }] : []),
    { id: 'audit', label: this.auditLabel, icon: 'clock-history' },
    ...(this.canArchiveOffer(offer) ? [{ id: 'send', label: this.sendLabel, icon: 'send' }] : []),
    ...(this.canRevokeOffer(offer) ? [{ id: 'revoke', label: this.revokeLabel, icon: 'slash-circle' }] : []),
    ...(this.canDeleteOffer(offer)
      ? [{ id: 'delete', label: this.deleteLabel, icon: 'trash', danger: true, dividerBefore: true }]
      : []),
    dbCopyIdItem(),
  ];

  constructor() {
    effect(() => {
      const offerId = this.auditOfferId();
      const page = this.auditPage();
      const pageSize = this.auditPageSize();

      this.auditOpenCount();

      if (offerId) untracked(() => this.facade.loadAuditLogs(offerId, page, pageSize));
    });
  }

  readonly offersChartTitle = $localize`:@@featureAdminOffers-chartTitle:Offer activity over time`;

  readonly seriesChartOptions = computed(() => this.buildSeriesChart(this.statistics()?.series ?? []));

  createForm: CreateAdminOfferDto = this.emptyForm();
  createUserId = '';
  createLineItems: OfferFormLineItem[] = [createEmptyOfferFormLine()];
  editForm: CreateAdminOfferDto & { id: string } = { ...this.emptyForm(), id: '' };
  editLineItems: OfferFormLineItem[] = [createEmptyOfferFormLine()];
  editDetailLoading = false;
  selectedOffer: AdminOfferListItem | null = null;

  customerLabel(row: CustomerLabelSource): string {
    return getCustomerLabel(row);
  }

  customerTitle(row: CustomerLabelSource): string | null {
    return getCustomerSecondaryLabel(row);
  }

  ngOnInit(): void {
    this.setDefaultDates(false);
    this.loadStatistics();

    watchBillingMutationModalClose({
      loading$: this.facade.creating$,
      error$: this.error$,
      open: this.createModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.createForm = this.emptyForm();
        this.createLineItems = [createEmptyOfferFormLine()];
      },
    });
    watchBillingMutationModalClose({
      loading$: this.facade.updating$,
      error$: this.error$,
      open: this.editModalOpen,
      destroyRef: this.destroyRef,
    });
    watchBillingMutationModalClose({
      loading$: this.facade.deleting$,
      error$: this.error$,
      open: this.deleteModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.selectedOffer = null;
      },
    });
  }

  onFiltersOpenChange(open: boolean): void {
    this.filtersCollapsed.set(!open);
  }

  onApplyFilters(): void {
    this.filtersCollapsed.set(true);
    this.loadStatistics();
  }

  applyOfferFilters(): void {
    this.offersUserId.set(this.offersUserIdDraft.trim());
    this.offerFiltersOpen.set(false);
  }

  clearOfferFilters(): void {
    this.offersUserIdDraft = '';
    this.offersUserId.set('');
  }

  onRowActivate(offer: AdminOfferListItem): void {
    if (this.canEditOffer(offer)) this.openEditModal(offer);
    else this.openAuditHistory(offer);
  }

  onRowAction(offer: AdminOfferListItem, action: string): void {
    if (action === 'edit') this.openEditModal(offer);
    else if (action === 'audit') this.openAuditHistory(offer);
    else if (action === 'send') this.archiveOffer(offer);
    else if (action === 'revoke') this.revokeOffer(offer);
    else if (action === 'delete') this.openDeleteModal(offer);
    else if (action === 'copy-id') fpcCopyText(offer.id);
  }

  /** Bulk Send to customer: one `POST /admin/billing/offers/:id/archive` per draft. */
  async sendSelected(): Promise<void> {
    const drafts = this.selectedDrafts();

    if (drafts.length === 0) return;

    const result = await fpcRunBulk(drafts, (offer) => firstValueFrom(this.adminOffersService.archive(offer.id)));

    this.finishBulk(dbBulkSummary(result, (offer) => this.offerDisplayTitle(offer)));
  }

  /** Bulk Revoke (`POST …/:id/revoke`) / Delete drafts (`DELETE …/:id`), after the confirm dialog. */
  async runPendingBulk(): Promise<void> {
    const pending = this.pendingBulk();

    this.pendingBulk.set(null);

    if (pending === 'revoke') {
      const offers = this.selectedPendingResponse();

      if (offers.length === 0) return;

      const result = await fpcRunBulk(offers, (offer) => firstValueFrom(this.adminOffersService.revoke(offer.id)));

      this.finishBulk(dbBulkSummary(result, (offer) => this.offerDisplayTitle(offer)));
    } else if (pending === 'delete') {
      const drafts = this.selectedDrafts();

      if (drafts.length === 0) return;

      const result = await fpcRunBulk(drafts, (offer) => firstValueFrom(this.adminOffersService.delete(offer.id)));

      this.finishBulk(dbBulkSummary(result, (offer) => this.offerDisplayTitle(offer)));
    }
  }

  private finishBulk(result: DbBulkResult): void {
    this.bulkResult.set(result);
    this.selected.set([]);
    this.paging.reload();
    this.loadStatistics();
  }

  offerDisplayTitle(offer: AdminOfferListItem): string {
    return offer.offerNumber?.trim() || getUnnumberedOfferLabel();
  }

  offerTotal(offer: AdminOfferListItem): string {
    return formatBillingMoney(offer.totalGross, offer.currency);
  }

  offerCreatedAt(offer: AdminOfferListItem): string {
    return offer.createdAt;
  }

  auditTime(log: BillingAuditLogResponse): string {
    return log.createdAt;
  }

  onResetFilters(): void {
    this.setDefaultDates();
    this.groupBy.set('day');
    this.filterUserId = '';
    this.onApplyFilters();
  }

  openCreateModal(): void {
    this.createForm = this.emptyForm();
    this.createUserId = '';
    this.createLineItems = [createEmptyOfferFormLine()];
    showBillingModal(this.createModalOpen);
    queueMicrotask(() => this.createOfferUserSelect?.reset());
  }

  openEditModal(offer: AdminOfferListItem): void {
    this.editDetailLoading = true;
    this.editForm = {
      id: offer.id,
      userId: offer.userId,
      currency: offer.currency,
      expiresAt: offer.expiresAt?.slice(0, 16) ?? '',
      billToOpenPositions: false,
      lineItems: [],
    };
    this.editLineItems = [createEmptyOfferFormLine()];
    showBillingModal(this.editModalOpen);

    this.adminOffersService
      .get(offer.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.editForm = {
            id: detail.id,
            userId: detail.userId,
            currency: detail.currency,
            expiresAt: detail.expiresAt ? detail.expiresAt.slice(0, 16) : '',
            billToOpenPositions: detail.billToOpenPositions,
            lineItems: [],
          };
          this.editLineItems =
            detail.lineItems.length > 0 ? mapOfferDetailLinesToForm(detail.lineItems) : [createEmptyOfferFormLine()];
          this.editDetailLoading = false;
        },
        error: () => {
          this.editDetailLoading = false;
        },
      });
  }

  openDeleteModal(offer: AdminOfferListItem): void {
    this.selectedOffer = offer;
    showBillingModal(this.deleteModalOpen);
  }

  openAuditHistory(offer: AdminOfferListItem): void {
    this.auditPage.set(1);
    this.auditOfferId.set(offer.id);
    this.auditOpenCount.update((count) => count + 1);
    showBillingModal(this.auditHistoryModalOpen);
  }

  submitCreate(): void {
    if (!this.createUserId || !isOfferFormValid(this.createLineItems)) {
      return;
    }

    this.facade.createOffer({
      userId: this.createUserId,
      expiresAt: this.createForm.expiresAt || undefined,
      billToOpenPositions: this.createForm.billToOpenPositions,
      lineItems: mapOfferFormLinesToDto(this.createLineItems),
    });
  }

  submitEdit(): void {
    if (!isOfferFormValid(this.editLineItems)) {
      return;
    }

    this.facade.updateOffer(this.editForm.id, {
      userId: this.editForm.userId,
      expiresAt: this.editForm.expiresAt || undefined,
      billToOpenPositions: this.editForm.billToOpenPositions,
      lineItems: mapOfferFormLinesToDto(this.editLineItems),
    });
  }

  canSubmitCreate(): boolean {
    return Boolean(this.createUserId) && isOfferFormValid(this.createLineItems);
  }

  canSubmitEdit(): boolean {
    return isOfferFormValid(this.editLineItems) && !this.editDetailLoading;
  }

  confirmDelete(): void {
    if (!this.selectedOffer) return;

    this.facade.deleteOffer(this.selectedOffer.id);
  }

  archiveOffer(offer: AdminOfferListItem): void {
    this.facade.archiveOffer(offer.id);
  }

  revokeOffer(offer: AdminOfferListItem): void {
    this.facade.revokeOffer(offer.id);
  }

  formatDate(value?: string | null): string {
    if (!value) return getUnavailableLabel();

    return formatBillingDateTime(value, value ?? '-');
  }

  onTabChange(tabId: string | null): void {
    if (tabId === 'offers' || tabId === 'statistics') {
      this.activeTab.set(tabId);
    }
  }

  tabLabel(tab: AdminOffersTab): string {
    return tab === 'statistics'
      ? $localize`:@@featureAdminOffers-statisticsTitle:Statistics`
      : $localize`:@@featureAdminOffers-mobileOffers:Offers`;
  }

  canEditOffer(offer: AdminOfferListItem): boolean {
    return offer.status === 'draft';
  }

  canDeleteOffer(offer: AdminOfferListItem): boolean {
    return offer.status === 'draft';
  }

  canArchiveOffer(offer: AdminOfferListItem): boolean {
    return offer.status === 'draft';
  }

  canRevokeOffer(offer: AdminOfferListItem): boolean {
    return offer.status === 'archived';
  }

  private loadStatistics(): void {
    this.facade.loadStatistics({
      from: this.fromDate(),
      to: this.toDate(),
      groupBy: this.groupBy(),
      userId: this.filterUserId.trim() || undefined,
    });
  }

  private setDefaultDates(force = true): void {
    const to = new Date();
    const from = new Date(to);

    from.setDate(from.getDate() - 30);
    const defaults = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };

    this.defaultDates.set(defaults);

    if (!force && this.fromDate() && this.toDate()) return;

    this.toDate.set(defaults.to);
    this.fromDate.set(defaults.from);
  }

  private emptyForm(): CreateAdminOfferDto {
    return {
      userId: '',
      billToOpenPositions: false,
      lineItems: [],
    };
  }

  private buildSeriesChart(series: OfferStatisticsSeriesPoint[]) {
    const filled = fillPeriodSeriesPoints(series, this.fromDate(), this.toDate(), this.groupBy(), (period) => ({
      period,
      archivedCount: 0,
      acceptedCount: 0,
      declinedCount: 0,
    }));

    if (filled.length === 0) {
      return null;
    }

    return {
      series: [
        { name: $localize`:@@featureAdminOffers-chartArchived:Archived`, data: filled.map((p) => p.archivedCount) },
        { name: $localize`:@@featureAdminOffers-chartAccepted:Accepted`, data: filled.map((p) => p.acceptedCount) },
        { name: $localize`:@@featureAdminOffers-chartDeclined:Declined`, data: filled.map((p) => p.declinedCount) },
      ] as ApexAxisChartSeries,
      chart: fpcChart('area', 240) as ApexChart,
      // Semantic series: archived (neutral), accepted (success), declined (danger).
      colors: ['var(--bs-secondary)', 'var(--bs-success)', 'var(--bs-danger)'],
      // Counts: straight segments and whole-number ticks (DB-17 f).
      stroke: { curve: 'straight', width: 2 } as ApexStroke,
      fill: FPC_CHART_AREA_FILL as ApexFill,
      dataLabels: { enabled: false } as ApexDataLabels,
      legend: { ...FPC_CHART_LEGEND, position: 'top' } as ApexLegend,
      xaxis: billingChartTimeAxis(filled.map((p) => this.formatChartPeriodLabel(p.period))) as ApexXAxis,
      yaxis: fpcChartCountAxis() as ApexYAxis,
      responsive: BILLING_CHART_RESPONSIVE,
      grid: FPC_CHART_GRID,
    };
  }

  private formatChartPeriodLabel(period: string): string {
    // Short axis labels (DB-17 a): the year sits in the range filter; days / weeks read "Oct 29".
    const format = this.groupBy() === 'month' ? 'MMM y' : 'MMM d';

    return this.datePipe.transform(`${period}T12:00:00.000Z`, format, 'UTC') ?? period;
  }
}
