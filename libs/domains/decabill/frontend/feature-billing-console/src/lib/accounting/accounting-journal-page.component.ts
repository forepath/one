import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  type AccountingAccount,
  type AccountingEntryLink,
  AccountingFacade,
  type AccountingJournalEntry,
  type AccountingJournalFilters,
  type AccountingJournalLine,
  type AccountingJournalStatistics,
  type AccountingLinkType,
  type AccountingManualEntryInput,
  type AccountingPage,
  type AccountingTaxCode,
  AdminAccountingService,
  BillingCapabilitiesFacade,
  billingTenantDisplayName,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBoardLaneComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcKeyValueListComponent,
  FpcLaneHeaderComponent,
  FpcListToolbarComponent,
  fpcListQueryState,
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
  FpcTabComponent,
  FpcTabGroupComponent,
  type FpcKeyValueItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { NgApexchartsModule } from 'ng-apexcharts';
import { catchError, combineLatest, firstValueFrom, map, of, switchMap } from 'rxjs';

import { formatBillingDate, formatBillingDateRange } from '../billing-format';
import { BILLING_MODAL_TRANSITION_MS, showBillingModal } from '../billing-modal';
import { dbServerPaging } from '../shared/server-paging';
import { ThemeService } from '../theme.service';

import { AccountingNavComponent } from './accounting-nav.component';
import { AccountingTenantSwitchComponent } from './accounting-tenant-switch.component';
import {
  ACCOUNTING_ENTRY_KINDS,
  ACCOUNTING_LINK_TYPES,
  ACCOUNTING_SOURCE_TYPES,
  accountingDonutChart,
  accountingMoney,
  accountingMonthLabel,
  accountingNumber,
  accountingPercent,
  accountingSeriesChart,
  accountingTenantParam,
  accountingToday,
  accountingYearStart,
  emptyAccountingResource,
  entryKindLabel,
  linkTypeLabel,
  saveAccountingBlob,
  sourceTypeLabel,
} from './accounting-ui';

type JournalTab = 'statistics' | 'journal';

/** One editable line of the manual entry dialog (amounts as typed; lines with a tax code are gross). */
export interface ManualEntryLineForm {
  accountNumber: string;
  debit: number | string | null;
  credit: number | string | null;
  taxCode: string;
  description: string;
  costCenter: string;
}

/** Document whose bookings are shown (`?linkType=&targetId=` from invoices, open items …). */
export interface JournalLinkContext {
  linkType: AccountingLinkType;
  targetId: string;
}

function emptyLine(): ManualEntryLineForm {
  return { accountNumber: '', debit: null, credit: null, taxCode: '', description: '', costCenter: '' };
}

function toAmount(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;

  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;

  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/**
 * Journal (Buchungsjournal): statistics lane (KPIs, monthly bookings / volume, revenue vs expenses, sources) next to
 * the server-paged journal; entry detail with lines, links, receipts and reversal; manual bookings; and the
 * bookings of one document (`?linkType=&targetId=`).
 */
@Component({
  selector: 'framework-accounting-journal-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgApexchartsModule,
    AccountingNavComponent,
    AccountingTenantSwitchComponent,
    FpcAlertComponent,
    FpcBoardLaneComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcKeyValueListComponent,
    FpcLaneHeaderComponent,
    FpcListToolbarComponent,
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
    FpcTabComponent,
    FpcTabGroupComponent,
  ],
  templateUrl: './accounting-journal-page.component.html',
  styleUrl: './accounting-section.scss',
})
export class AccountingJournalPageComponent implements OnInit {
  private readonly facade = inject(AccountingFacade);
  private readonly capabilities = inject(BillingCapabilitiesFacade);
  private readonly service = inject(AdminAccountingService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly theme = inject(ThemeService);

  readonly pageTitle = $localize`:@@featureAccountingJournal-title:Journal`;
  readonly statisticsTitle = $localize`:@@featureAccountingJournal-statistics:Statistics`;
  readonly journalTitle = $localize`:@@featureAccountingJournal-journal:Bookings`;
  readonly filtersPanelTitle = $localize`:@@featureAccountingJournal-filters:Filters`;
  readonly searchPlaceholder = $localize`:@@featureAccountingJournal-search:Search description, document, number`;
  readonly createEntryLabel = $localize`:@@featureAccountingJournal-createEntry:Manual booking`;
  readonly entriesLabel = $localize`:@@featureAccountingJournal-kpiEntries:Entries`;
  readonly volumeLabel = $localize`:@@featureAccountingJournal-kpiVolume:Volume`;
  readonly manualShareLabel = $localize`:@@featureAccountingJournal-kpiManualShare:Manual share`;
  readonly revenueLabel = $localize`:@@featureAccountingJournal-kpiRevenue:Revenue`;
  readonly expensesLabel = $localize`:@@featureAccountingJournal-kpiExpenses:Expenses`;
  readonly resultLabel = $localize`:@@featureAccountingJournal-kpiResult:Result`;
  readonly bookingsChartTitle = $localize`:@@featureAccountingJournal-chartBookings:Bookings per month`;
  readonly volumeChartTitle = $localize`:@@featureAccountingJournal-chartVolume:Volume per month`;
  readonly resultChartTitle = $localize`:@@featureAccountingJournal-chartResult:Revenue vs expenses`;
  readonly sourceChartTitle = $localize`:@@featureAccountingJournal-chartSources:Volume by source`;
  readonly entryTitle = $localize`:@@featureAccountingJournal-entryTitle:Journal entry`;

  readonly entryKinds = ACCOUNTING_ENTRY_KINDS;
  readonly sourceTypes = ACCOUNTING_SOURCE_TYPES;
  readonly linkTypes = ACCOUNTING_LINK_TYPES;
  readonly entryKindLabel = entryKindLabel;
  readonly sourceTypeLabel = sourceTypeLabel;
  readonly linkTypeLabel = linkTypeLabel;
  readonly money = accountingMoney;
  readonly formatDate = (value: string | null | undefined): string => formatBillingDate(value ?? null);

  // ---- Statistics lane ----

  /** Phone column switch (md and up show both lanes side by side). */
  readonly activeTab = signal<JournalTab>('statistics');
  readonly filtersCollapsed = signal(true);
  readonly fromDate = signal(accountingYearStart());
  readonly toDate = signal(accountingToday());
  readonly statsFiltersOpen = computed(() => !this.filtersCollapsed());
  readonly filterState = fpcListQueryState({
    filters: { from: this.fromDate, to: this.toDate },
    open: this.statsFiltersOpen,
    changed: () => this.onApplyStatisticsFilters(),
    defaults: () => ({ from: accountingYearStart(), to: accountingToday() }),
  });
  readonly activeStatisticsFilterCount = computed(() => {
    const f = this.filterState.applied();

    return f.from !== accountingYearStart() || f.to !== accountingToday() ? 1 : 0;
  });
  readonly statisticsScopeLabel = computed(() => formatBillingDateRange(this.fromDate(), this.toDate(), ''));

  readonly statistics = toSignal(this.facade.journalStatistics$, {
    initialValue: emptyAccountingResource<AccountingJournalStatistics>(),
  });
  readonly kpis = computed(() => this.statistics().data?.kpis ?? null);
  readonly bookingsChart = computed(() => {
    const series = this.statistics().data?.series ?? [];

    return accountingSeriesChart(
      'bar',
      series.map((p) => accountingMonthLabel(p.bucket)),
      [
        { name: this.entriesLabel, data: series.map((p) => p.entries) },
        {
          name: $localize`:@@featureAccountingJournal-chartManual:Manual`,
          data: series.map((p) => p.manual),
        },
      ],
      { colors: ['var(--bs-primary)', 'var(--bs-warning)'] },
    );
  });
  readonly volumeChart = computed(() => {
    const series = this.statistics().data?.series ?? [];

    return accountingSeriesChart(
      'area',
      series.map((p) => accountingMonthLabel(p.bucket)),
      [{ name: this.volumeLabel, data: series.map((p) => accountingNumber(p.volume)) }],
      { money: true },
    );
  });
  readonly resultChart = computed(() => {
    const result = this.statistics().data?.result ?? [];

    return accountingSeriesChart(
      'bar',
      result.map((p) => accountingMonthLabel(p.month)),
      [
        { name: this.revenueLabel, data: result.map((p) => accountingNumber(p.revenue)) },
        { name: this.expensesLabel, data: result.map((p) => accountingNumber(p.expenses)) },
      ],
      { money: true, colors: ['var(--bs-success)', 'var(--bs-danger)'] },
    );
  });
  readonly sourceChart = computed(() => {
    const bySource = this.statistics().data?.bySource ?? [];

    return accountingDonutChart(
      bySource.map((s) => sourceTypeLabel(s.source)),
      bySource.map((s) => accountingNumber(s.volume)),
      { money: true, dark: this.theme.isDarkMode() },
    );
  });

  // ---- Journal list ----

  readonly listFilters = signal<AccountingJournalFilters>({});
  readonly listFiltersOpen = signal(false);
  readonly listFiltersActive = computed(
    () => Object.values(this.listFilters()).filter((v) => typeof v === 'string' && v !== '').length,
  );
  filterKindDraft = '';
  filterSourceDraft = '';
  filterAccountDraft = '';
  filterFromDraft = '';
  filterToDraft = '';

  /** Search + page + filters → `GET /journal?…&limit&offset` (replace-page, URL `j-q` / `j-p` / `j-n`). */
  readonly paging = dbServerPaging(
    (query) => {
      const filters = untracked(this.listFilters);

      this.facade.load({
        key: 'journal',
        params: {
          ...filters,
          search: query.search,
          limit: query.pageSize,
          offset: (query.page - 1) * query.pageSize,
        },
      });
    },
    { url: 'j-', filters: () => this.listFilters() },
  );
  readonly journal = toSignal(this.facade.journal$, {
    initialValue: emptyAccountingResource<AccountingPage<AccountingJournalEntry>>(),
  });
  readonly rows = computed(() => this.journal().data?.items ?? []);
  readonly total = computed(() => this.journal().data?.total ?? 0);

  readonly columns: FpcTableColumn<AccountingJournalEntry>[] = [
    {
      id: 'entryNumber',
      label: $localize`:@@featureAccountingJournal-colNumber:No.`,
      value: (row) => row.entryNumber,
      mono: true,
      required: true,
      priority: 1,
    },
    {
      id: 'postingDate',
      label: $localize`:@@featureAccountingJournal-colPostingDate:Posting date`,
      value: (row) => formatBillingDate(row.postingDate),
      priority: 1,
    },
    {
      id: 'documentNumber',
      label: $localize`:@@featureAccountingJournal-colDocument:Document`,
      value: (row) => row.documentNumber ?? '',
      priority: 2,
    },
    {
      id: 'description',
      label: $localize`:@@featureAccountingJournal-colDescription:Description`,
      value: (row) => row.description,
      required: true,
      priority: 1,
    },
    {
      id: 'kind',
      label: $localize`:@@featureAccountingJournal-colKind:Kind`,
      value: (row) => entryKindLabel(row.kind),
      priority: 3,
    },
    {
      id: 'source',
      label: $localize`:@@featureAccountingJournal-colSource:Source`,
      value: (row) => sourceTypeLabel(row.sourceType),
      priority: 2,
    },
    {
      id: 'total',
      label: $localize`:@@featureAccountingJournal-colTotal:Amount`,
      value: (row) => accountingMoney(row.total, row.currency),
      align: 'end',
      priority: 1,
    },
    {
      id: 'tenant',
      label: $localize`:@@featureAccountingJournal-colTenant:Tenant`,
      value: (row) => (row.tenantId ? billingTenantDisplayName(row.tenantId) : '-'),
      priority: 3,
    },
  ];

  // ---- Shared state ----

  readonly globalAccess = toSignal(this.capabilities.accountingGlobalAccess$, { initialValue: false });
  readonly viewTenantId = toSignal(this.facade.viewTenantId$, { initialValue: null as string | null });
  readonly accountIndex = toSignal(this.facade.accountIndex$, {
    initialValue: new Map<string, { number: string; name: string }>(),
  });
  readonly accountDirectory = toSignal(this.facade.accountDirectory$, {
    initialValue: emptyAccountingResource<AccountingAccount[]>(),
  });
  readonly currentFiscalYear = toSignal(this.facade.currentFiscalYear$, { initialValue: null });
  readonly taxCodes = toSignal(this.facade.taxCodes$, {
    initialValue: emptyAccountingResource<AccountingTaxCode[]>(),
  });
  readonly mutating = toSignal(this.facade.mutating$, { initialValue: false });
  readonly mutationError = toSignal(this.facade.mutationError$, { initialValue: null as string | null });
  private readonly lastMutation = toSignal(this.facade.lastMutation$, { initialValue: null });

  /** Accounts for filters: all charts, sorted by number. */
  readonly filterAccounts = computed(() =>
    [...(this.accountDirectory().data ?? [])].sort((a, b) => a.number.localeCompare(b.number)),
  );
  /** Bookable accounts of the current fiscal year's chart (manual entry). */
  readonly bookableAccounts = computed(() => {
    const chartId = this.currentFiscalYear()?.chartId;

    return this.filterAccounts().filter((a) => a.isActive && (!chartId || a.chartId === chartId));
  });
  readonly activeTaxCodes = computed(() => (this.taxCodes().data ?? []).filter((t) => t.isActive));

  // ---- Document link mode ----

  readonly linkContext = toSignal(
    this.route.queryParamMap.pipe(
      map((params): JournalLinkContext | null => {
        const linkType = params.get('linkType') as AccountingLinkType | null;
        const targetId = params.get('targetId')?.trim();

        return linkType && targetId && ACCOUNTING_LINK_TYPES.includes(linkType) ? { linkType, targetId } : null;
      }),
    ),
    { initialValue: null },
  );
  /** Document number of the link context (the banner shows it instead of the raw id); `undefined` while loading. */
  readonly linkContextLabel = toSignal<string | null | undefined, undefined>(
    combineLatest([toObservable(this.linkContext), this.facade.viewTenantId$]).pipe(
      switchMap(([context, viewTenantId]) =>
        context
          ? this.service
              .getReferenceLabel(context.linkType, context.targetId, accountingTenantParam(viewTenantId))
              .pipe(
                map((result) => result.label),
                catchError(() => of(null)),
              )
          : of(null),
      ),
    ),
    { initialValue: undefined },
  );
  readonly byLink = toSignal(this.facade.byLink$, {
    initialValue: emptyAccountingResource<AccountingJournalEntry[]>(),
  });

  // ---- Entry detail ----

  readonly entryOpen = signal(false);
  readonly entry = toSignal(this.facade.entry$, { initialValue: emptyAccountingResource<AccountingJournalEntry>() });
  readonly entryItems = computed<FpcKeyValueItem[]>(() => {
    const entry = this.entry().data;

    if (!entry) return [];

    return [
      {
        key: 'number',
        label: $localize`:@@featureAccountingJournal-entryNumber:Entry number`,
        value: entry.entryNumber,
        mono: true,
      },
      {
        key: 'posting',
        label: $localize`:@@featureAccountingJournal-entryPosting:Posting date`,
        value: formatBillingDate(entry.postingDate),
      },
      {
        key: 'document',
        label: $localize`:@@featureAccountingJournal-entryDocumentDate:Document date`,
        value: formatBillingDate(entry.documentDate),
      },
      {
        key: 'documentNumber',
        label: $localize`:@@featureAccountingJournal-entryDocumentNumber:Document number`,
        value: entry.documentNumber ?? '-',
      },
      {
        key: 'kind',
        label: $localize`:@@featureAccountingJournal-entryKind:Kind`,
        value: entryKindLabel(entry.kind),
      },
      {
        key: 'source',
        label: $localize`:@@featureAccountingJournal-entrySource:Source`,
        value: sourceTypeLabel(entry.sourceType),
      },
      {
        key: 'total',
        label: $localize`:@@featureAccountingJournal-entryTotal:Amount`,
        value: accountingMoney(entry.total, entry.currency),
      },
      {
        key: 'tenant',
        label: $localize`:@@featureAccountingJournal-entryTenant:Tenant`,
        value: entry.tenantId ? billingTenantDisplayName(entry.tenantId) : '-',
      },
    ];
  });
  readonly entryLines = computed(() => this.entry().data?.lines ?? []);
  readonly entryLinks = computed(() => this.entry().data?.links ?? []);
  readonly canReverse = computed(() => {
    const entry = this.entry().data;

    return Boolean(entry) && !entry?.reversedByEntryId && entry?.kind !== 'reversal';
  });
  readonly reverseOpen = signal(false);
  reverseDate = accountingToday();
  reverseReason = '';
  linkTypeDraft: AccountingLinkType = 'invoice';
  linkTargetDraft = '';
  linkRoleDraft: 'related' | 'settles' | 'receipt' = 'related';
  linkLabelDraft = '';
  readonly downloadError = signal<string | null>(null);

  // ---- Manual entry ----

  readonly manualOpen = signal(false);
  manualDocumentDate = accountingToday();
  manualDocumentNumber = '';
  manualDescription = '';
  manualTenantId = '';
  manualLines: ManualEntryLineForm[] = [emptyLine(), emptyLine()];
  private pendingManual = false;

  constructor() {
    effect(() => {
      const chartId = this.currentFiscalYear()?.chartId;

      if (chartId) untracked(() => this.facade.load({ key: 'taxCodes', chartId }));
    });

    effect(() => {
      const context = this.linkContext();

      if (context) untracked(() => this.facade.load({ key: 'byLink', ...context }));
    });

    effect(() => {
      const last = this.lastMutation();

      if (last) untracked(() => this.onMutationDone(last.kind));
    });
  }

  ngOnInit(): void {
    this.capabilities.loadCapabilities();
    this.facade.clearMutation();
    this.facade.load({ key: 'overview' });
    this.facade.load({ key: 'accountDirectory' });
    this.loadStatistics();
  }

  // ---- Statistics ----

  loadStatistics(): void {
    this.facade.load({ key: 'journalStatistics', range: { from: this.fromDate(), to: this.toDate() } });
  }

  onFiltersOpenChange(open: boolean): void {
    this.filtersCollapsed.set(!open);
  }

  onApplyStatisticsFilters(): void {
    this.filtersCollapsed.set(true);
    this.loadStatistics();
  }

  onResetStatisticsFilters(): void {
    this.fromDate.set(accountingYearStart());
    this.toDate.set(accountingToday());
    this.onApplyStatisticsFilters();
  }

  onTabChange(tabId: string | null): void {
    if (tabId === 'statistics' || tabId === 'journal') this.activeTab.set(tabId);
  }

  tabLabel(tab: JournalTab): string {
    return tab === 'statistics' ? this.statisticsTitle : this.journalTitle;
  }

  formatShare(value: number | null | undefined): string {
    return accountingPercent(value);
  }

  // ---- Journal filters ----

  applyListFilters(): void {
    this.listFilters.set({
      kind: this.filterKindDraft || undefined,
      sourceType: this.filterSourceDraft || undefined,
      accountId: this.filterAccountDraft || undefined,
      from: this.filterFromDraft || undefined,
      to: this.filterToDraft || undefined,
    });
    this.listFiltersOpen.set(false);
  }

  clearListFilters(): void {
    this.filterKindDraft = '';
    this.filterSourceDraft = '';
    this.filterAccountDraft = '';
    this.filterFromDraft = '';
    this.filterToDraft = '';
    this.listFilters.set({});
  }

  // ---- Entry detail ----

  openEntry(entryOrId: AccountingJournalEntry | string): void {
    const entryId = typeof entryOrId === 'string' ? entryOrId : entryOrId.id;

    this.facade.clearMutation();
    this.facade.load({ key: 'entry', entryId });
    this.reverseOpen.set(false);
    this.downloadError.set(null);
    this.resetLinkForm();
    showBillingModal(this.entryOpen);
  }

  accountLabel(line: AccountingJournalLine): string {
    const account = line.account ?? this.accountIndex().get(line.accountId);

    return account ? `${account.number} ${account.name}` : line.accountId;
  }

  lineAmount(value: number | string | null | undefined): string {
    const n = accountingNumber(value);

    return n === 0 ? '' : accountingMoney(n, this.entry().data?.currency);
  }

  lineTaxRate(line: AccountingJournalLine): string {
    return line.taxRate === null || line.taxRate === undefined ? '' : `${accountingNumber(line.taxRate)} %`;
  }

  lineCounterparty(line: AccountingJournalLine): string {
    return line.counterpartyLabel?.trim() || '';
  }

  linkLabel(link: AccountingEntryLink): string {
    // Processor transactions have no document of their own: their external id is the reference people know.
    return link.label?.trim() || link.targetLabel?.trim() || link.targetId;
  }

  isReceipt(link: AccountingEntryLink): boolean {
    return link.linkType === 'stored_file';
  }

  submitReverse(): void {
    const entry = this.entry().data;

    if (!entry || !this.canReverse()) return;

    this.facade.mutate({
      kind: 'reverseEntry',
      entryId: entry.id,
      dto: { documentDate: this.reverseDate || undefined, reason: this.reverseReason.trim() || undefined },
    });
  }

  submitLink(): void {
    const entry = this.entry().data;
    const targetId = this.linkTargetDraft.trim();

    if (!entry || !targetId) return;

    this.facade.mutate({
      kind: 'addLink',
      entryId: entry.id,
      dto: {
        linkType: this.linkTypeDraft,
        targetId,
        role: this.linkRoleDraft,
        label: this.linkLabelDraft.trim() || undefined,
      },
    });
  }

  removeLink(link: AccountingEntryLink): void {
    this.facade.mutate({ kind: 'removeLink', entryId: link.entryId, linkId: link.id });
  }

  onReceiptSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    const entry = this.entry().data;

    if (!file || !entry) return;

    this.facade.mutate({ kind: 'attachReceipt', entryId: entry.id, file });

    if (input) input.value = '';
  }

  async downloadReceipt(link: AccountingEntryLink): Promise<void> {
    this.downloadError.set(null);

    try {
      const blob = await firstValueFrom(
        this.service.downloadReceipt(link.targetId, accountingTenantParam(this.viewTenantId())),
      );

      saveAccountingBlob(blob, link.label?.trim() || 'receipt');
    } catch {
      this.downloadError.set(
        $localize`:@@featureAccountingJournal-receiptDownloadFailed:The receipt could not be downloaded.`,
      );
    }
  }

  // ---- Manual entry ----

  openManualEntry(): void {
    this.facade.clearMutation();
    this.manualDocumentDate = accountingToday();
    this.manualDocumentNumber = '';
    this.manualDescription = '';
    this.manualTenantId = '';
    this.manualLines = [emptyLine(), emptyLine()];
    showBillingModal(this.manualOpen);
  }

  addLine(): void {
    this.manualLines = [...this.manualLines, emptyLine()];
  }

  removeLine(index: number): void {
    if (this.manualLines.length <= 2) return;

    this.manualLines = this.manualLines.filter((_, i) => i !== index);
  }

  debitTotal(): number {
    return Math.round(this.manualLines.reduce((s, l) => s + toAmount(l.debit), 0) * 100) / 100;
  }

  creditTotal(): number {
    return Math.round(this.manualLines.reduce((s, l) => s + toAmount(l.credit), 0) * 100) / 100;
  }

  isBalanced(): boolean {
    return this.debitTotal() > 0 && this.debitTotal() === this.creditTotal();
  }

  /** At least two lines with an account and exactly one of debit / credit, plus date and description. */
  manualValid(): boolean {
    const lines = this.manualLines.filter((l) => l.accountNumber.trim());

    return (
      Boolean(this.manualDocumentDate) &&
      Boolean(this.manualDescription.trim()) &&
      lines.length >= 2 &&
      lines.every((l) => toAmount(l.debit) > 0 !== toAmount(l.credit) > 0)
    );
  }

  buildManualEntry(): AccountingManualEntryInput {
    const context = this.linkContext();

    return {
      documentDate: this.manualDocumentDate,
      documentNumber: this.manualDocumentNumber.trim() || undefined,
      description: this.manualDescription.trim(),
      tenantId: this.globalAccess() ? this.manualTenantId.trim() || undefined : undefined,
      lines: this.manualLines
        .filter((l) => l.accountNumber.trim())
        .map((l) => ({
          accountNumber: l.accountNumber.trim(),
          debit: toAmount(l.debit) || undefined,
          credit: toAmount(l.credit) || undefined,
          taxCode: l.taxCode || undefined,
          description: l.description.trim() || undefined,
          costCenter: l.costCenter.trim() || undefined,
        })),
      links: context ? [{ linkType: context.linkType, targetId: context.targetId, role: 'related' }] : undefined,
    };
  }

  submitManualEntry(): void {
    if (!this.manualValid()) return;

    this.pendingManual = true;
    this.facade.mutate({ kind: 'createManualEntry', dto: this.buildManualEntry() });
  }

  // ---- Document link mode ----

  clearLinkContext(): void {
    void this.router.navigate(['/administration/accounting/journal']);
  }

  private resetLinkForm(): void {
    this.linkTypeDraft = 'invoice';
    this.linkTargetDraft = '';
    this.linkRoleDraft = 'related';
    this.linkLabelDraft = '';
  }

  private onMutationDone(kind: string): void {
    if (kind === 'createManualEntry' && this.pendingManual) {
      this.pendingManual = false;
      this.manualOpen.set(false);
      // The reducer already shows the created entry; open it once the dialog has closed.
      this.reverseOpen.set(false);
      this.resetLinkForm();
      setTimeout(() => showBillingModal(this.entryOpen), BILLING_MODAL_TRANSITION_MS);
    } else if (kind === 'reverseEntry') {
      this.reverseOpen.set(false);
      this.reverseReason = '';
    } else if (kind === 'addLink') {
      this.resetLinkForm();
    }
  }
}
