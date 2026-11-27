import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AccountingFacade,
  AdminAccountingService,
  BillingCapabilitiesFacade,
  type AccountingOverview,
  type AccountingPage,
  type AccountingVatPeriod,
  type AccountingVatReturn,
  type AccountingVatReturnBox,
  type AccountingVatReturnDefinition,
  type AccountingVatStatistics,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcBoardLaneComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcLaneHeaderComponent,
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
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { NgApexchartsModule } from 'ng-apexcharts';
import { firstValueFrom } from 'rxjs';

import { formatBillingDate, formatBillingDateRange, formatBillingDateTime } from '../billing-format';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

import { AccountingNavComponent } from './accounting-nav.component';
import {
  accountingMoney,
  accountingNumber,
  accountingSeriesChart,
  accountingToday,
  emptyAccountingResource,
  saveAccountingBlob,
  vatStatusState,
} from './accounting-ui';

type VatTab = 'statistics' | 'list';
type VatListTab = 'return' | 'history';

/** First and last day of a month / quarter / year (`index`: month 1–12 or quarter 1–4). */
export function vatPeriodBounds(
  type: AccountingVatPeriod,
  year: number,
  index: number,
): { periodStart: string; periodEnd: string } {
  if (type === 'year') return { periodStart: `${year}-01-01`, periodEnd: `${year}-12-31` };

  const startMonth = type === 'quarter' ? (index - 1) * 3 + 1 : index;
  const endMonth = type === 'quarter' ? startMonth + 2 : startMonth;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    periodStart: `${year}-${pad(startMonth)}-01`,
    periodEnd: `${year}-${pad(endMonth)}-${pad(lastDay)}`,
  };
}

/** VAT returns of the country profile (computed for manual filing); entity-wide, global access only. */
@Component({
  selector: 'framework-accounting-vat-returns-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgApexchartsModule,
    AccountingNavComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcBoardLaneComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcLaneHeaderComponent,
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
  templateUrl: './accounting-vat-returns-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './accounting-section.scss',
})
export class AccountingVatReturnsPageComponent implements OnInit {
  private readonly facade = inject(AccountingFacade);
  private readonly service = inject(AdminAccountingService);
  private readonly capabilities = inject(BillingCapabilitiesFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureAccountingVat-title:VAT returns`;
  readonly chartTitle = $localize`:@@featureAccountingVat-chartTitle:Payable / refund per period`;
  readonly searchPlaceholder = $localize`:@@featureAccountingVat-search:Search VAT returns`;

  readonly overview = toSignal(this.facade.overview$, { initialValue: emptyAccountingResource<AccountingOverview>() });
  readonly definitions = toSignal(this.facade.vatDefinitions$, {
    initialValue: emptyAccountingResource<AccountingVatReturnDefinition[]>(),
  });
  readonly returns = toSignal(this.facade.vatReturns$, {
    initialValue: emptyAccountingResource<AccountingPage<AccountingVatReturn>>(),
  });
  readonly statistics = toSignal(this.facade.vatStatistics$, {
    initialValue: emptyAccountingResource<AccountingVatStatistics>(),
  });
  readonly vatReturn = toSignal(this.facade.vatReturn$, {
    initialValue: emptyAccountingResource<AccountingVatReturn>(),
  });
  readonly mutating = toSignal(this.facade.mutating$, { initialValue: false });
  readonly mutationKind = toSignal(this.facade.mutationKind$, { initialValue: null });
  readonly mutationError = toSignal(this.facade.mutationError$, { initialValue: null as string | null });

  readonly activeTab = signal<VatTab>('list');
  readonly listTab = signal<VatListTab>('return');

  // ---- Period picker ----

  readonly definitionKey = signal('');
  readonly periodType = signal<AccountingVatPeriod>('month');
  readonly year = signal(lastCompletedVatPeriod('month').year);
  readonly periodIndex = signal(lastCompletedVatPeriod('month').index);
  readonly downloadError = signal<string | null>(null);

  readonly definition = computed((): AccountingVatReturnDefinition | null => {
    const defs = this.definitions().data ?? [];

    return defs.find((d) => d.key === this.definitionKey()) ?? defs[0] ?? null;
  });
  readonly periodTypes = computed<AccountingVatPeriod[]>(
    () => this.definition()?.periods ?? ['month', 'quarter', 'year'],
  );
  readonly bounds = computed(() => vatPeriodBounds(this.periodType(), this.year(), this.periodIndex()));
  /** Feature availability of the selected definition (missing env vars disable computing). */
  readonly availability = computed(() => {
    const key = this.definition()?.key;

    return this.overview().data?.features.find((f) => f.key === key) ?? null;
  });
  readonly canCompute = computed(() => Boolean(this.definition()) && this.availability()?.available !== false);

  // ---- Result ----

  readonly resultDefinition = computed(() => {
    const row = this.vatReturn().data;

    return row ? ((this.definitions().data ?? []).find((d) => d.key === row.definitionKey) ?? null) : null;
  });
  readonly detailColumns = computed(() => {
    const first = this.vatReturn().data?.details?.[0];

    return first ? Object.keys(first) : [];
  });
  manualDraft: Record<string, number | null> = {};

  readonly submitOpen = signal(false);
  readonly payOpen = signal(false);
  filingReference = '';
  submitNote = '';
  payDate = accountingToday();
  payAmount: number | null = null;

  readonly trendChart = computed(() => {
    const series = this.statistics().data?.series ?? [];

    return accountingSeriesChart(
      'bar',
      series.map((p) => `${p.key} ${p.period}`),
      [{ name: $localize`:@@featureAccountingVat-seriesResult:Payable / refund`, data: series.map((p) => p.result) }],
      { money: true },
    );
  });

  readonly columns: FpcTableColumn<AccountingVatReturn>[] = [
    {
      id: 'status',
      label: $localize`:@@featureAccountingVat-colStatus:Status`,
      type: 'state',
      state: (row) => vatStatusState(row.status),
    },
    {
      id: 'definition',
      label: $localize`:@@featureAccountingVat-colReturn:Return`,
      value: (row) => this.definitionName(row.definitionKey),
      required: true,
      priority: 1,
    },
    {
      id: 'period',
      label: $localize`:@@featureAccountingVat-colPeriod:Period`,
      value: (row) => formatBillingDateRange(row.periodStart, row.periodEnd),
      priority: 1,
    },
    {
      id: 'result',
      label: $localize`:@@featureAccountingVat-colResult:Result`,
      value: (row) => (row.resultAmount == null ? '-' : accountingMoney(row.resultAmount)),
      align: 'end',
      priority: 2,
    },
    {
      id: 'submitted',
      label: $localize`:@@featureAccountingVat-colSubmitted:Submitted`,
      value: (row) => (row.submittedAt ? formatBillingDateTime(row.submittedAt) : '-'),
      priority: 3,
    },
    {
      id: 'reference',
      label: $localize`:@@featureAccountingVat-colReference:Filing reference`,
      value: (row) => row.filingReference ?? '',
      priority: 3,
    },
  ];

  constructor() {
    // Manual box inputs follow the shown return (row switch / recompute).
    effect(() => {
      const row = this.vatReturn().data;

      untracked(() => {
        this.manualDraft = row ? { ...(row.manualValues ?? {}) } : {};
      });
    });
    // A definition without the chosen period type falls back to its first one.
    effect(() => {
      const types = this.periodTypes();

      untracked(() => {
        if (!types.includes(this.periodType())) this.setPeriodType(types[0] ?? 'month');
      });
    });
  }

  ngOnInit(): void {
    this.capabilities.loadCapabilities();
    this.facade.load({ key: 'overview' });
    this.facade.load({ key: 'vatDefinitions' });
    this.facade.load({ key: 'vatReturns', params: { limit: 200 } });
    this.facade.load({ key: 'vatStatistics' });

    const base = { loading$: this.facade.mutating$, error$: this.facade.mutationError$, destroyRef: this.destroyRef };

    watchBillingMutationModalClose({ ...base, open: this.submitOpen });
    watchBillingMutationModalClose({ ...base, open: this.payOpen });
  }

  onTabChange(id: string | null): void {
    if (id === 'statistics' || id === 'list') this.activeTab.set(id);
  }

  onListTabChange(id: string | null): void {
    if (id === 'return' || id === 'history') this.listTab.set(id);
  }

  tabLabel(tab: VatTab): string {
    return tab === 'statistics'
      ? $localize`:@@featureAccountingVat-statistics:Statistics`
      : $localize`:@@featureAccountingVat-returns:Returns`;
  }

  setDefinition(key: string): void {
    this.definitionKey.set(key);
  }

  setPeriodType(type: AccountingVatPeriod): void {
    this.periodType.set(type);

    // Default: the last completed period (in January that is December / Q4 of the previous year).
    const last = lastCompletedVatPeriod(type);

    this.year.set(last.year);
    this.periodIndex.set(last.index);
  }

  periodOptions(): number[] {
    if (this.periodType() === 'quarter') return [1, 2, 3, 4];

    if (this.periodType() === 'month') return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    return [];
  }

  periodTypeLabel(type: AccountingVatPeriod): string {
    const labels: Record<AccountingVatPeriod, string> = {
      month: $localize`:@@featureAccountingVat-month:Month`,
      quarter: $localize`:@@featureAccountingVat-quarter:Quarter`,
      year: $localize`:@@featureAccountingVat-year:Year`,
    };

    return labels[type];
  }

  definitionName(key: string): string {
    return (this.definitions().data ?? []).find((d) => d.key === key)?.name ?? key;
  }

  compute(): void {
    const def = this.definition();

    if (!def || !this.canCompute()) return;

    const { periodStart, periodEnd } = this.bounds();

    this.facade.mutate({ kind: 'computeVatReturn', dto: { definitionKey: def.key, periodStart, periodEnd } });
    this.listTab.set('return');
  }

  /** Recomputes the shown return with the edited manual boxes. */
  recompute(): void {
    const row = this.vatReturn().data;

    if (!row || row.status !== 'draft') return;

    const manualValues: Record<string, number> = {};

    for (const [box, value] of Object.entries(this.manualDraft)) {
      if (value !== null && `${value}` !== '' && Number.isFinite(Number(value))) manualValues[box] = Number(value);
    }

    this.facade.mutate({
      kind: 'computeVatReturn',
      dto: { definitionKey: row.definitionKey, periodStart: row.periodStart, periodEnd: row.periodEnd, manualValues },
    });
  }

  boxAmount(box: AccountingVatReturnBox): number {
    return accountingNumber(this.vatReturn().data?.figures?.[box.box]);
  }

  isResultBox(box: AccountingVatReturnBox): boolean {
    return this.resultDefinition()?.resultBox === box.box;
  }

  detailValue(row: Record<string, unknown>, column: string): string {
    const value = row[column];

    if (typeof value === 'number') return accountingMoney(value);

    return value === null || value === undefined ? '' : String(value);
  }

  money(value: number | string | null | undefined): string {
    return accountingMoney(value);
  }

  date(value: string | null | undefined): string {
    return formatBillingDate(value);
  }

  stateOf(row: AccountingVatReturn) {
    return vatStatusState(row.status);
  }

  onRowActivate(row: AccountingVatReturn): void {
    this.definitionKey.set(row.definitionKey);
    this.facade.load({ key: 'vatReturn', id: row.id });
    this.listTab.set('return');
  }

  openSubmit(): void {
    this.filingReference = '';
    this.submitNote = '';
    this.facade.clearMutation();
    showBillingModal(this.submitOpen);
  }

  submit(): void {
    const row = this.vatReturn().data;

    if (!row) return;

    this.facade.mutate({
      kind: 'submitVatReturn',
      id: row.id,
      dto: {
        ...(this.filingReference.trim() ? { filingReference: this.filingReference.trim() } : {}),
        ...(this.submitNote.trim() ? { note: this.submitNote.trim() } : {}),
      },
    });
  }

  openPay(): void {
    const row = this.vatReturn().data;

    this.payDate = accountingToday();
    // Signed like the result: positive = payment to the tax office, negative = refund received.
    this.payAmount = row?.resultAmount == null ? null : accountingNumber(row.resultAmount);
    this.facade.clearMutation();
    showBillingModal(this.payOpen);
  }

  pay(): void {
    const row = this.vatReturn().data;

    if (!row || !this.payDate) return;

    this.facade.mutate({
      kind: 'payVatReturn',
      id: row.id,
      dto: {
        date: this.payDate,
        ...(this.payAmount !== null && `${this.payAmount}` !== '' ? { amount: Number(this.payAmount) } : {}),
      },
    });
  }

  async downloadCsv(): Promise<void> {
    const row = this.vatReturn().data;

    if (!row) return;

    this.downloadError.set(null);

    try {
      const blob = await firstValueFrom(this.service.downloadVatReturnCsv(row.id));

      saveAccountingBlob(blob, `${row.definitionKey}_${row.periodStart}_${row.periodEnd}.csv`);
    } catch {
      this.downloadError.set(
        $localize`:@@featureAccountingVat-downloadFailed:The CSV could not be created. Please try again.`,
      );
    }
  }
}

/** Last completed VAT period relative to today (year rolls back in January / the first quarter). */
export function lastCompletedVatPeriod(type: AccountingVatPeriod, today = new Date()): { year: number; index: number } {
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-based: the completed months of this year

  if (type === 'month') {
    return month === 0 ? { year: year - 1, index: 12 } : { year, index: month };
  }

  if (type === 'quarter') {
    const completed = Math.floor(month / 3);

    return completed === 0 ? { year: year - 1, index: 4 } : { year, index: completed };
  }

  return { year: year - 1, index: 1 };
}
