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
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminOffersFacade,
  AdminBillingService,
  AdminOffersService,
  type EffectiveDocumentTerms,
  fillPeriodSeriesPoints,
  type AdminOfferDetailResponse,
  type AdminOfferListItem,
  type BillingAuditLogResponse,
  type CreateAdminOfferDto,
  type OfferStatisticsSeriesPoint,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcBoardLaneComponent,
  FpcButtonComponent,
  FpcListToolbarComponent,
  fpcListQueryState,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcItemCardComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcKeyValueListComponent,
  FpcLaneHeaderComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  fpcRunBulk,
  FpcSectionColumnComponent,
  FpcSectionRowComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  FPC_CHART_AREA_FILL,
  FPC_CHART_LINE_STROKE,
  FPC_CHART_GRID,
  FPC_CHART_LEGEND,
  fpcChart,
  fpcChartCountAxis,
  type FpcBadgeTone,
  fpcFormatMoney,
  type FpcKeyValueItem,
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
import { finalize, firstValueFrom, type Observable, of, switchMap } from 'rxjs';

import { BillingAdminUserSelectComponent } from '../billing-admin-user-select/billing-admin-user-select.component';
import { BILLING_CHART_RESPONSIVE, billingChartTimeAxis } from '../billing-chart';
import {
  DEFAULT_BILLING_CURRENCY,
  formatBillingDateRange,
  formatBillingDateTime,
  formatBillingMoney,
} from '../billing-format';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { getOfferStatusBadgeTone, getOfferStatusLabel, getUnavailableLabel } from '../billing-status-labels';
import { DocumentNoteFieldComponent } from '../document-note/document-note-field.component';
import { DocumentNoteSummaryComponent } from '../document-note/document-note-summary.component';
import { documentNoteToInput } from '../document-note/document-note.util';
import { DocumentTermsFieldsComponent } from '../document-terms/document-terms-fields.component';
import { DocumentTermsSummaryComponent } from '../document-terms/document-terms-summary.component';
import {
  documentTermsFormFromTerms,
  documentTermsFormToInput,
  emptyDocumentTermsForm,
  isDocumentTermsFormValid,
  type DocumentTermsFormModel,
} from '../document-terms/document-terms.util';
import {
  getCustomerLabel,
  getCustomerSecondaryLabel,
  getUnnumberedOfferLabel,
  type CustomerLabelSource,
} from '../named-label.util';
import { PricingTotalsSummaryComponent } from '../pricing-totals-summary/pricing-totals-summary.component';
import {
  DB_DL_ARCHIVE,
  DB_DL_DELETE,
  dbBulkSummary,
  dbCopyIdItem,
  type DbBulkResult,
  DB_DL_DOWNLOAD_PDF,
  DB_DL_EDIT,
  DB_DL_PREVIEW,
  DB_DL_SEND,
} from '../shared/data-list';
import { invoiceTaxItems } from '../shared/invoice-totals';
import { dbServerPaging } from '../shared/server-paging';
import { offerState } from '../shared/table-states';

import {
  createEmptyOfferFormLine,
  isOfferFormValid,
  mapOfferDetailLinesToForm,
  mapOfferFormLinesToDto,
  type OfferFormLineItem,
} from './admin-offer-form.util';
import { AdminOfferLineEditorComponent } from './admin-offer-line-editor.component';

type AdminOffersTab = 'offers' | 'statistics';

/** Archived offer that was not emailed to the customer yet. */
function isUnsentOffer(offer: Pick<AdminOfferListItem, 'status' | 'sentAt'>): boolean {
  return offer.status === 'archived' && !offer.sentAt;
}

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
    DocumentTermsFieldsComponent,
    DocumentTermsSummaryComponent,
    DocumentNoteFieldComponent,
    DocumentNoteSummaryComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcBoardLaneComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormCheckComponent,
    FpcItemCardComponent,
    FpcKeyValueListComponent,
    FpcLaneHeaderComponent,
    FpcEmptyStateComponent,
    FpcListToolbarComponent,
    FpcConfirmDialogComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSectionColumnComponent,
    FpcSectionRowComponent,
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
  readonly previewOfferModalOpen = signal(false);

  private readonly facade = inject(AdminOffersFacade);
  private readonly adminOffersService = inject(AdminOffersService);
  private readonly adminBillingService = inject(AdminBillingService);
  private readonly datePipe = inject(DatePipe);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID);

  /** Phone column switch (md and up show both columns side by side); statistics first, as billing admin. */
  readonly activeTab = signal<AdminOffersTab>('statistics');
  readonly filtersCollapsed = signal(true);
  readonly filtersPanelTitle = $localize`:@@featureAdminOffers-filters:Filters`;
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly groupBy = signal<'day' | 'month'>('day');
  readonly filtersOpen = computed(() => !this.filtersCollapsed());
  /** Applied statistics scope (period · grouping) next to the Filters toggle, as on billing admin (DB-17 e). */
  readonly statisticsScopeLabel = computed(() => {
    const range = formatBillingDateRange(this.fromDate() || null, this.toDate() || null, '');
    const grouping =
      this.groupBy() === 'month'
        ? $localize`:@@featureAdminBilling-scopeByMonth:By month`
        : $localize`:@@featureAdminBilling-scopeByDay:By day`;

    return [range, grouping].filter(Boolean).join(' · ');
  });
  /** Applied range / grouping (+ party) in the URL (`?f=`); the drawer edits a draft until Apply (3.38 R12). */
  readonly filterState = fpcListQueryState({
    filters: { from: this.fromDate, to: this.toDate, groupBy: this.groupBy },
    open: this.filtersOpen,
    changed: () => this.onApplyFilters(),
    // Clear all / chip removal restore the page's default range, not the empty initial values.
    defaults: () => this.defaultDates(),
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

  /** Offer preview (`GET /admin/billing/offers/:id`), same layout as the admin invoice preview. */
  readonly previewLoading = signal(false);
  readonly previewDetail = signal<AdminOfferDetailResponse | null>(null);
  readonly previewTaxItems = computed<FpcKeyValueItem[]>(() => {
    const detail = this.previewDetail();

    return detail
      ? invoiceTaxItems({ taxBreakdown: offerTaxBreakdown(detail), currency: detail.currency }, this.locale)
      : [];
  });
  readonly previewSummaryItems = computed<FpcKeyValueItem[]>(() => {
    const detail = this.previewDetail();

    if (!detail) return [];

    const money = (value: number) => fpcFormatMoney(value, detail.currency || DEFAULT_BILLING_CURRENCY, this.locale);

    return [
      {
        key: 'subtotal',
        label: $localize`:@@featureInvoices-subtotalNet:Subtotal (net)`,
        value: money(detail.subtotalNet),
      },
      { key: 'tax', label: $localize`:@@featureInvoices-taxTotal:Tax total`, value: money(detail.taxTotal) },
      { key: 'total', label: $localize`:@@featureInvoices-totalGross:Total`, value: money(detail.totalGross) },
    ];
  });

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
      state: (offer) => offerState(offer.status, { unsent: isUnsentOffer(offer) }),
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

  readonly auditLabel = $localize`:@@featureAdminOffers-audit:Audit log`;
  readonly sendLabel = $localize`:@@featureAdminOffers-archive:Send to customer`;
  readonly archiveLabel = DB_DL_ARCHIVE;
  readonly revokeLabel = $localize`:@@featureAdminOffers-revoke:Revoke`;
  readonly deleteLabel = DB_DL_DELETE;
  readonly deleteDraftsLabel = $localize`:@@featureAdminOffers-bulkDeleteDrafts:Delete drafts`;

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
  /** Bulk revoke: email the customers (like bulk void). */
  bulkRevokeNotifyCustomer = true;

  /** Archive dialog (row or bulk): the drafts to finalize; sending them right away is optional. */
  readonly pendingArchive = signal<readonly AdminOfferListItem[] | null>(null);
  archiveNotifyCustomer = true;
  archiveNotifyOnExpiry = true;
  readonly archiveConfirmTitle = computed(() =>
    (this.pendingArchive()?.length ?? 0) > 1
      ? $localize`:@@featureAdminOffers-archiveBulkTitle:Archive ${this.pendingArchive()?.length ?? 0}:count: draft offers?`
      : $localize`:@@featureAdminOffers-archiveTitle:Archive offer?`,
  );
  readonly archiveConfirmMessage = $localize`:@@featureAdminOffers-archiveMessage:The offer is numbered, its prices and terms are frozen and the PDF is created. It can no longer be edited afterwards.`;

  /** Send dialog for an offer that was archived without notification. */
  readonly pendingSend = signal<AdminOfferListItem | null>(null);
  readonly sendConfirmTitle = $localize`:@@featureAdminOffers-sendTitle:Send offer to the customer?`;
  readonly sendConfirmMessage = computed(() => {
    const offer = this.pendingSend();

    return offer
      ? $localize`:@@featureAdminOffers-sendMessage:Offer ${this.offerDisplayTitle(offer)}:number: is emailed to ${this.customerLabel(offer)}:customer: with the PDF attached.`
      : '';
  });

  /** Revoke dialog: like a void, the email defaults to on only when the offer itself was sent. */
  readonly pendingRevoke = signal<AdminOfferListItem | null>(null);
  revokeNotifyCustomer = true;
  readonly revokeConfirmTitle = $localize`:@@featureAdminOffers-revokeTitle:Revoke offer?`;
  readonly revokeConfirmMessage = $localize`:@@featureAdminOffers-revokeMessage:The customer can no longer accept the offer. This cannot be undone.`;
  /**
   * Accept / decline dialogs: record the customer's answer given outside the system (e.g. for an offer sent by other
   * means). Same checks and fulfillment as the customer answering in their account.
   */
  readonly acceptLabel = $localize`:@@featureAdminOffers-accept:Accept`;
  readonly declineLabel = $localize`:@@featureAdminOffers-decline:Decline`;
  readonly pendingAccept = signal<AdminOfferListItem | null>(null);
  acceptNotifyCustomer = true;
  acceptNotifyInvoices = true;
  readonly acceptConfirmTitle = $localize`:@@featureAdminOffers-acceptTitle:Accept offer for the customer?`;
  readonly acceptConfirmMessage = computed(() => {
    const offer = this.pendingAccept();

    return offer
      ? $localize`:@@featureAdminOffers-acceptMessage:Records that ${this.customerLabel(offer)}:customer: accepted offer ${this.offerDisplayTitle(offer)}:number:. Its services are fulfilled and billed as if the customer had accepted it. This cannot be undone.`
      : '';
  });
  readonly pendingDecline = signal<AdminOfferListItem | null>(null);
  declineNotifyCustomer = true;
  readonly declineConfirmTitle = $localize`:@@featureAdminOffers-declineTitle:Decline offer for the customer?`;
  readonly declineConfirmMessage = computed(() => {
    const offer = this.pendingDecline();

    return offer
      ? $localize`:@@featureAdminOffers-declineMessage:Records that ${this.customerLabel(offer)}:customer: declined offer ${this.offerDisplayTitle(offer)}:number:. It can no longer be accepted. This cannot be undone.`
      : '';
  });
  readonly bulkConfirmMessage = computed(() =>
    this.pendingBulk() === 'revoke'
      ? $localize`:@@featureAdminOffers-bulkRevokeMessage:${this.selectedPendingResponse().length}:count: offers awaiting a response will be revoked. Customers can no longer accept them.`
      : $localize`:@@featureAdminOffers-bulkDeleteMessage:${this.selectedDrafts().length}:count: draft offers will be deleted. This action cannot be undone.`,
  );
  readonly rowMenu = (offer: AdminOfferListItem): FpcMenuItem[] => [
    ...(this.canEditOffer(offer) ? [{ id: 'edit', label: DB_DL_EDIT, icon: 'pencil' }] : []),
    ...(this.canPreviewOffer(offer) ? [{ id: 'preview', label: DB_DL_PREVIEW, icon: 'eye' }] : []),
    ...(this.canDownloadOffer(offer) ? [{ id: 'download', label: DB_DL_DOWNLOAD_PDF, icon: 'file-earmark-pdf' }] : []),
    { id: 'audit', label: this.auditLabel, icon: 'clock-history' },
    ...(this.canArchiveOffer(offer) ? [{ id: 'archive', label: DB_DL_ARCHIVE, icon: 'archive' }] : []),
    ...(this.canSendOffer(offer) ? [{ id: 'send', label: DB_DL_SEND, icon: 'send' }] : []),
    ...(this.canAcceptOffer(offer) ? [{ id: 'accept', label: this.acceptLabel, icon: 'check-circle' }] : []),
    ...(this.canDeclineOffer(offer) ? [{ id: 'decline', label: this.declineLabel, icon: 'x-circle' }] : []),
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
  createTermsForm: DocumentTermsFormModel = emptyDocumentTermsForm();
  editTermsForm: DocumentTermsFormModel = emptyDocumentTermsForm();
  /** Document note printed on the offer (not carried to the resulting invoice). */
  createNote = '';
  editNote = '';
  /** Global default terms (inherited when an offer leaves its terms empty). */
  readonly documentTermsDefaults = signal<EffectiveDocumentTerms | null>(null);
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
    this.adminBillingService
      .getDocumentTermsDefaults()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (defaults) => this.documentTermsDefaults.set(defaults),
        error: () => undefined,
      });

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
    else this.openPreview(offer);
  }

  onRowAction(offer: AdminOfferListItem, action: string): void {
    if (action === 'edit') this.openEditModal(offer);
    else if (action === 'preview') this.openPreview(offer);
    else if (action === 'download') this.downloadOfferPdf(offer);
    else if (action === 'audit') this.openAuditHistory(offer);
    else if (action === 'archive') this.openArchiveDialog([offer]);
    else if (action === 'send') this.openSendDialog(offer);
    else if (action === 'accept') this.openAcceptDialog(offer);
    else if (action === 'decline') this.openDeclineDialog(offer);
    else if (action === 'revoke') this.openRevokeDialog(offer);
    else if (action === 'delete') this.openDeleteModal(offer);
    else if (action === 'copy-id') fpcCopyText(offer.id);
  }

  /** Bulk Archive: opens the archive dialog for the selected drafts. */
  archiveSelected(): void {
    this.openArchiveDialog(this.selectedDrafts());
  }

  openArchiveDialog(offers: readonly AdminOfferListItem[]): void {
    const drafts = offers.filter((offer) => this.canArchiveOffer(offer));

    if (drafts.length === 0) return;

    this.archiveNotifyCustomer = true;
    this.archiveNotifyOnExpiry = true;
    this.pendingArchive.set(drafts);
  }

  /**
   * Archives the drafts of the archive dialog: one row through the store (errors show on the page), several as a bulk
   * run (one `POST /admin/billing/offers/:id/archive` per draft, per-item result).
   */
  async confirmArchive(): Promise<void> {
    const drafts = this.pendingArchive() ?? [];
    const dto = { notifyCustomer: this.archiveNotifyCustomer, notifyOnExpiry: this.archiveNotifyOnExpiry };

    this.pendingArchive.set(null);

    if (drafts.length === 0) return;

    const [single] = drafts;

    if (drafts.length === 1 && single) {
      this.facade.archiveOffer(single.id, dto);

      return;
    }

    const result = await fpcRunBulk(drafts, (offer) => firstValueFrom(this.adminOffersService.archive(offer.id, dto)));

    this.finishBulk(dbBulkSummary(result, (offer) => this.offerDisplayTitle(offer)));
  }

  openSendDialog(offer: AdminOfferListItem): void {
    if (!this.canSendOffer(offer)) return;

    this.previewOfferModalOpen.set(false);
    this.pendingSend.set(offer);
  }

  confirmSend(): void {
    const offer = this.pendingSend();

    this.pendingSend.set(null);

    if (offer) this.facade.sendOffer(offer.id);
  }

  openRevokeDialog(offer: AdminOfferListItem): void {
    if (!this.canRevokeOffer(offer)) return;

    this.revokeNotifyCustomer = Boolean(offer.sentAt);
    this.pendingRevoke.set(offer);
  }

  confirmRevoke(): void {
    const offer = this.pendingRevoke();

    this.pendingRevoke.set(null);

    if (offer) this.facade.revokeOffer(offer.id, { notifyCustomer: this.revokeNotifyCustomer });
  }

  /** The customer accepted outside the system: both emails default to on (they gave their answer, so they expect it). */
  openAcceptDialog(offer: AdminOfferListItem): void {
    if (!this.canAcceptOffer(offer)) return;

    this.previewOfferModalOpen.set(false);
    this.acceptNotifyCustomer = true;
    this.acceptNotifyInvoices = true;
    this.pendingAccept.set(offer);
  }

  confirmAccept(): void {
    const offer = this.pendingAccept();

    this.pendingAccept.set(null);

    if (offer) {
      this.facade.acceptOffer(offer.id, {
        notifyCustomer: this.acceptNotifyCustomer,
        notifyInvoices: this.acceptNotifyInvoices,
      });
    }
  }

  openDeclineDialog(offer: AdminOfferListItem): void {
    if (!this.canDeclineOffer(offer)) return;

    this.previewOfferModalOpen.set(false);
    this.declineNotifyCustomer = true;
    this.pendingDecline.set(offer);
  }

  confirmDecline(): void {
    const offer = this.pendingDecline();

    this.pendingDecline.set(null);

    if (offer) this.facade.declineOffer(offer.id, { notifyCustomer: this.declineNotifyCustomer });
  }

  /** Opens the bulk confirm dialog; the revoke notification defaults to on. */
  openBulkConfirm(action: 'revoke' | 'delete'): void {
    this.bulkRevokeNotifyCustomer = true;
    this.pendingBulk.set(action);
  }

  /** Bulk Revoke (`POST …/:id/revoke`) / Delete drafts (`DELETE …/:id`), after the confirm dialog. */
  async runPendingBulk(): Promise<void> {
    const pending = this.pendingBulk();

    this.pendingBulk.set(null);

    if (pending === 'revoke') {
      const offers = this.selectedPendingResponse();

      if (offers.length === 0) return;

      const dto = { notifyCustomer: this.bulkRevokeNotifyCustomer };
      const result = await fpcRunBulk(offers, (offer) => firstValueFrom(this.adminOffersService.revoke(offer.id, dto)));

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
    this.createTermsForm = emptyDocumentTermsForm();
    this.createNote = '';
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
    this.editTermsForm = emptyDocumentTermsForm();
    this.editNote = '';
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
          this.editTermsForm = documentTermsFormFromTerms(detail);
          this.editNote = detail.note ?? '';
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

  openPreview(offer: AdminOfferListItem): void {
    if (!this.canPreviewOffer(offer)) return;

    this.previewLoading.set(true);
    this.previewDetail.set(null);
    showBillingModal(this.previewOfferModalOpen);
    this.adminOffersService
      .get(offer.id)
      .pipe(
        finalize(() => this.previewLoading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        // The detail carries no billing-profile name; keep the list row's so the preview matches the table.
        next: (detail) =>
          this.previewDetail.set({ ...detail, customerName: detail.customerName ?? offer.customerName }),
        error: () => this.previewDetail.set(null),
      });
  }

  downloadOfferPdf(offer: Pick<AdminOfferListItem, 'id' | 'offerNumber' | 'canDownload'>): void {
    if (!this.canDownloadOffer(offer)) return;

    this.downloadPdfBlob(this.adminOffersService.downloadPdf(offer.id), `${offer.offerNumber ?? offer.id}.pdf`);
  }

  offerStatusLabel(status: string | null | undefined): string {
    return getOfferStatusLabel(status);
  }

  offerStatusBadgeTone(status: string | null | undefined): FpcBadgeTone {
    return getOfferStatusBadgeTone(status);
  }

  submitCreate(): void {
    if (!this.canSubmitCreate()) {
      return;
    }

    this.facade.createOffer({
      userId: this.createUserId,
      expiresAt: this.createForm.expiresAt || undefined,
      billToOpenPositions: this.createForm.billToOpenPositions,
      ...documentTermsFormToInput(this.createTermsForm),
      lineItems: mapOfferFormLinesToDto(this.createLineItems),
      note: documentNoteToInput(this.createNote),
    });
  }

  submitEdit(): void {
    if (!this.canSubmitEdit()) {
      return;
    }

    this.facade.updateOffer(this.editForm.id, {
      userId: this.editForm.userId,
      expiresAt: this.editForm.expiresAt || undefined,
      billToOpenPositions: this.editForm.billToOpenPositions,
      ...documentTermsFormToInput(this.editTermsForm),
      lineItems: mapOfferFormLinesToDto(this.editLineItems),
      note: documentNoteToInput(this.editNote),
    });
  }

  canSubmitCreate(): boolean {
    return (
      Boolean(this.createUserId) &&
      isOfferFormValid(this.createLineItems) &&
      isDocumentTermsFormValid(this.createTermsForm)
    );
  }

  canSubmitEdit(): boolean {
    return (
      isOfferFormValid(this.editLineItems) && isDocumentTermsFormValid(this.editTermsForm) && !this.editDetailLoading
    );
  }

  confirmDelete(): void {
    if (!this.selectedOffer) return;

    this.facade.deleteOffer(this.selectedOffer.id);
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

  /** Server flag: archived without notification and not expired yet. */
  canSendOffer(offer: Pick<AdminOfferListItem, 'canSend'>): boolean {
    return offer.canSend === true;
  }

  /** Server flag: exactly the offers the customer could accept themselves (archived, not expired). */
  canAcceptOffer(offer: Pick<AdminOfferListItem, 'canAccept'>): boolean {
    return offer.canAccept === true;
  }

  /** Server flag: exactly the offers the customer could decline themselves (archived). */
  canDeclineOffer(offer: Pick<AdminOfferListItem, 'canDecline'>): boolean {
    return offer.canDecline === true;
  }

  canRevokeOffer(offer: AdminOfferListItem): boolean {
    return offer.status === 'archived';
  }

  /** Server flag, like invoices: drafts have no document and are edited instead. */
  canPreviewOffer(offer: Pick<AdminOfferListItem, 'canPreview'>): boolean {
    return offer.canPreview === true;
  }

  /** Server flag: drafts have no PDF (it is rendered and stored when the offer is sent). */
  canDownloadOffer(offer: Pick<AdminOfferListItem, 'canDownload'>): boolean {
    return offer.canDownload === true;
  }

  private downloadPdfBlob(source: Observable<Blob>, filename: string): void {
    source.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
      // Counts: whole-number ticks (DB-17 f).
      stroke: FPC_CHART_LINE_STROKE as ApexStroke,
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

/** Tax per rate of an offer (offers carry no stored breakdown, unlike invoices): line taxes summed by rate. */
export function offerTaxBreakdown(
  detail: Pick<AdminOfferDetailResponse, 'lineItems'>,
): { taxRate: number; taxAmount: number }[] {
  const byRate = new Map<number, number>();

  for (const line of detail.lineItems) {
    if (!line.lineTax) continue;

    byRate.set(line.taxRate, (byRate.get(line.taxRate) ?? 0) + line.lineTax);
  }

  return [...byRate.entries()]
    .sort(([a], [b]) => b - a)
    .map(([taxRate, taxAmount]) => ({ taxRate, taxAmount: Math.round(taxAmount * 100) / 100 }));
}
