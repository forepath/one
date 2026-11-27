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
  BillingCapabilitiesFacade,
  type AccountingCatchUpResult,
  type AccountingChart,
  type AccountingChartTemplate,
  type AccountingClosePreview,
  type AccountingFiscalYear,
  type AccountingFxRate,
  type AccountingOverview,
  type AccountingPage,
  type AccountingPeriod,
  type AccountingPostingIssue,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcKeyValueListComponent,
  FpcLaneHeaderComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  type FpcKeyValueItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { formatBillingDate, formatBillingDateTime } from '../billing-format';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

import { AccountingNavComponent } from './accounting-nav.component';
import { AccountingTenantSwitchComponent } from './accounting-tenant-switch.component';
import {
  accountingMoney,
  accountingNumber,
  accountingToday,
  emptyAccountingResource,
  exportKindLabel,
  sourceTypeLabel,
} from './accounting-ui';

type OverviewSection = 'setup' | 'years' | 'charts' | 'issues' | 'fx';

interface ChartForm {
  mode: 'template' | 'empty';
  templateKey: string;
  code: string;
  name: string;
  country: string;
  accountLength: number | null;
}

interface FxForm {
  currency: string;
  rateDate: string;
  rate: number | null;
}

/**
 * Accounting overview: country profile, feature availability, fiscal years / periods (locking, closing), charts of
 * accounts, posting issues + catch-up and exchange rates. Entity-wide actions need accounting global access.
 */
@Component({
  selector: 'framework-accounting-overview-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcKeyValueListComponent,
    FpcLaneHeaderComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    AccountingNavComponent,
    AccountingTenantSwitchComponent,
  ],
  templateUrl: './accounting-overview-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './accounting-section.scss',
})
export class AccountingOverviewPageComponent implements OnInit {
  private readonly facade = inject(AccountingFacade);
  private readonly capabilities = inject(BillingCapabilitiesFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureAccountingOverview-title:Accounting`;

  readonly globalAccess = toSignal(this.capabilities.accountingGlobalAccess$, { initialValue: false });
  readonly overview = toSignal(this.facade.overview$, { initialValue: emptyAccountingResource<AccountingOverview>() });
  readonly fiscalYears = toSignal(this.facade.fiscalYears$, {
    initialValue: emptyAccountingResource<AccountingFiscalYear[]>(),
  });
  readonly charts = toSignal(this.facade.charts$, { initialValue: emptyAccountingResource<AccountingChart[]>() });
  readonly templates = toSignal(this.facade.templates$, {
    initialValue: emptyAccountingResource<AccountingChartTemplate[]>(),
  });
  readonly postingIssues = toSignal(this.facade.postingIssues$, {
    initialValue: emptyAccountingResource<AccountingPage<AccountingPostingIssue>>(),
  });
  readonly fxRates = toSignal(this.facade.fxRates$, {
    initialValue: emptyAccountingResource<AccountingPage<AccountingFxRate>>(),
  });
  readonly closePreview = toSignal(this.facade.closePreview$, {
    initialValue: emptyAccountingResource<AccountingClosePreview>(),
  });
  readonly mutating = toSignal(this.facade.mutating$, { initialValue: false });
  readonly mutationError = toSignal(this.facade.mutationError$, { initialValue: null as string | null });
  readonly lastMutation = toSignal(this.facade.lastMutation$, {
    initialValue: null,
  });

  readonly activeSection = signal<OverviewSection>('setup');

  // ---- KPIs ----

  readonly openYearCount = computed(() => this.years().filter((y) => y.status === 'open').length);
  readonly openIssueCount = computed(() => this.overview().data?.openPostingIssues ?? 0);
  readonly chartCount = computed(() => this.charts().data?.length ?? 0);
  readonly methodLabel = computed(() => this.methodText(this.overview().data?.method));

  /** Fiscal years with periods (`GET /fiscal-years`), else the overview's years. */
  readonly years = computed<AccountingFiscalYear[]>(() => {
    const list = this.fiscalYears().data ?? this.overview().data?.fiscalYears ?? [];

    return [...list].sort((a, b) => b.startDate.localeCompare(a.startDate));
  });

  readonly profileItems = computed<FpcKeyValueItem[]>(() => {
    const o = this.overview().data;

    if (!o) return [];

    const yes = $localize`:@@featureAccountingOverview-yes:Yes`;
    const no = $localize`:@@featureAccountingOverview-no:No`;

    return [
      { key: 'profile', label: $localize`:@@featureAccountingOverview-profile:Country profile`, value: o.profile.name },
      { key: 'country', label: $localize`:@@featureAccountingOverview-country:Country`, value: o.country },
      { key: 'method', label: $localize`:@@featureAccountingOverview-method:Method`, value: this.methodText(o.method) },
      {
        key: 'vatBasis',
        label: $localize`:@@featureAccountingOverview-vatBasis:VAT basis`,
        value:
          o.vatBasis === 'payment'
            ? $localize`:@@featureAccountingOverview-vatBasisPayment:When paid (cash basis)`
            : $localize`:@@featureAccountingOverview-vatBasisInvoice:When invoiced (accrual basis)`,
      },
      {
        key: 'startDate',
        label: $localize`:@@featureAccountingOverview-startDate:Bookkeeping start`,
        value: formatBillingDate(o.startDate),
      },
      {
        key: 'fyStart',
        label: $localize`:@@featureAccountingOverview-fiscalYearStart:Fiscal year starts in month`,
        value: o.fiscalYearStartMonth,
      },
      {
        key: 'currency',
        label: $localize`:@@featureAccountingOverview-currency:Functional currency`,
        value: o.functionalCurrency,
      },
      {
        key: 'vatPeriod',
        label: $localize`:@@featureAccountingOverview-vatPeriod:VAT return period`,
        value: o.vatReturnPeriod ?? '-',
      },
      {
        key: 'retention',
        label: $localize`:@@featureAccountingOverview-retention:Retention (books / vouchers)`,
        value: $localize`:@@featureAccountingOverview-retentionYears:${o.profile.retention.booksYears}:books: / ${o.profile.retention.vouchersYears}:vouchers: years`,
      },
      {
        key: 'defaultTemplate',
        label: $localize`:@@featureAccountingOverview-defaultTemplate:Default chart template`,
        value: o.profile.defaultTemplate,
        mono: true,
      },
      {
        key: 'mandatoryChart',
        label: $localize`:@@featureAccountingOverview-mandatoryChart:Chart legally mandatory`,
        value: o.profile.mandatoryChart ? yes : no,
      },
      {
        key: 'cashBasis',
        label: $localize`:@@featureAccountingOverview-cashBasis:Cash-basis statement`,
        value: o.profile.hasCashBasis ? yes : no,
      },
    ];
  });

  /** VAT returns and exports of the profile with their availability (missing env vars). */
  readonly features = computed(() => {
    const o = this.overview().data;

    if (!o) return [];

    const names = new Map<string, string>(o.profile.vatReturns.map((r) => [r.key, r.name]));

    return o.features.map((f) => ({ ...f, name: names.get(f.key) ?? exportKindLabel(f.key) }));
  });

  readonly chartName = computed(() => {
    const index = new Map((this.charts().data ?? []).map((c) => [c.id, `${c.name} (${c.code})`]));

    return (chartId: string) => index.get(chartId) ?? chartId;
  });

  readonly chartColumns: FpcTableColumn<AccountingChart>[] = [
    {
      id: 'code',
      label: $localize`:@@featureAccountingOverview-colCode:Code`,
      value: (c) => c.code,
      mono: true,
      required: true,
    },
    { id: 'name', label: $localize`:@@featureAccountingOverview-colName:Name`, value: (c) => c.name, priority: 1 },
    {
      id: 'country',
      label: $localize`:@@featureAccountingOverview-colCountry:Country`,
      value: (c) => c.country ?? '-',
      priority: 2,
    },
    {
      id: 'template',
      label: $localize`:@@featureAccountingOverview-colTemplate:Template`,
      value: (c) => c.templateKey ?? $localize`:@@featureAccountingOverview-emptyChart:Empty`,
      priority: 2,
    },
    {
      id: 'length',
      label: $localize`:@@featureAccountingOverview-colAccountLength:Account length`,
      value: (c) => c.accountLength,
      align: 'end',
      priority: 3,
    },
  ];

  readonly issueColumns: FpcTableColumn<AccountingPostingIssue>[] = [
    {
      id: 'source',
      label: $localize`:@@featureAccountingOverview-colSource:Source`,
      value: (i) => `${sourceTypeLabel(i.sourceType)} (${i.sourceEvent})`,
      required: true,
    },
    {
      id: 'sourceId',
      label: $localize`:@@featureAccountingOverview-colSourceId:Document`,
      value: (i) => i.sourceLabel ?? i.sourceId,
      priority: 3,
    },
    { id: 'error', label: $localize`:@@featureAccountingOverview-colError:Error`, value: (i) => i.error, priority: 1 },
    {
      id: 'attempts',
      label: $localize`:@@featureAccountingOverview-colAttempts:Attempts`,
      value: (i) => i.attempts,
      align: 'end',
      priority: 2,
    },
    {
      id: 'updated',
      label: $localize`:@@featureAccountingOverview-colUpdated:Last attempt`,
      value: (i) => formatBillingDateTime(i.updatedAt),
      priority: 2,
    },
  ];

  readonly fxColumns: FpcTableColumn<AccountingFxRate>[] = [
    {
      id: 'currency',
      label: $localize`:@@featureAccountingOverview-colCurrency:Currency`,
      value: (r) => r.currency,
      mono: true,
      required: true,
    },
    {
      id: 'date',
      label: $localize`:@@featureAccountingOverview-colRateDate:Date`,
      value: (r) => formatBillingDate(r.rateDate),
      priority: 1,
    },
    {
      id: 'rate',
      label: $localize`:@@featureAccountingOverview-colRate:Rate per EUR`,
      value: (r) => accountingNumber(r.rate),
      align: 'end',
      priority: 1,
    },
    {
      id: 'source',
      label: $localize`:@@featureAccountingOverview-colRateSource:Source`,
      value: (r) => (r.source === 'ecb' ? 'ECB' : $localize`:@@featureAccountingOverview-rateManual:Manual`),
      priority: 2,
    },
  ];

  // ---- Dialogs ----

  readonly chartModalOpen = signal(false);
  chartForm: ChartForm = this.emptyChartForm();

  readonly fxModalOpen = signal(false);
  fxForm: FxForm = { currency: '', rateDate: accountingToday(), rate: null };

  readonly lockTarget = signal<AccountingPeriod | null>(null);
  readonly openYearConfirm = signal(false);

  readonly closeModalOpen = signal(false);
  readonly closingYear = signal<AccountingFiscalYear | null>(null);
  closeNextChartId = '';
  /** Old account number → new number (only edited rows are sent). */
  closeMapping: Record<string, string> = {};

  readonly catchUpResult = computed<AccountingCatchUpResult | null>(() => {
    const last = this.lastMutation();

    return last?.kind === 'runCatchUp' ? (last.result as AccountingCatchUpResult) : null;
  });
  readonly ecbResult = computed<number | null>(() => {
    const last = this.lastMutation();

    return last?.kind === 'fetchEcbRates' ? ((last.result as { stored?: number } | null)?.stored ?? 0) : null;
  });

  constructor() {
    // Entity-wide lists load once global access is known.
    effect(() => {
      if (this.globalAccess()) {
        untracked(() => {
          this.facade.load({ key: 'templates' });
          this.facade.load({ key: 'postingIssues', limit: 50, offset: 0 });
        });
      }
    });
  }

  ngOnInit(): void {
    this.capabilities.loadCapabilities();
    this.facade.clearMutation();
    this.facade.load({ key: 'overview' });
    this.facade.load({ key: 'fiscalYears' });
    this.facade.load({ key: 'charts' });
    this.facade.load({ key: 'fxRates', params: { limit: 100, offset: 0 } });

    for (const open of [this.chartModalOpen, this.fxModalOpen, this.closeModalOpen]) {
      watchBillingMutationModalClose({
        loading$: this.facade.mutating$,
        error$: this.facade.mutationError$,
        open,
        destroyRef: this.destroyRef,
      });
    }
  }

  onSectionChange(id: string | null): void {
    if (id) this.activeSection.set(id as OverviewSection);
  }

  methodText(method: string | null | undefined): string {
    if (!method) return '-';

    return method === 'cash'
      ? $localize`:@@featureAccountingOverview-methodCash:Cash basis`
      : $localize`:@@featureAccountingOverview-methodAccrual:Double entry (accrual)`;
  }

  money(value: number | string | null | undefined): string {
    return accountingMoney(value, this.overview().data?.functionalCurrency);
  }

  date(value: string | null | undefined): string {
    return formatBillingDate(value ?? null);
  }

  missingText(missing: string[]): string {
    return missing.join(', ');
  }

  // ---- Fiscal years ----

  requestLock(period: AccountingPeriod): void {
    this.facade.clearMutation();
    this.lockTarget.set(period);
  }

  confirmLock(): void {
    const period = this.lockTarget();

    if (!period) return;

    this.facade.mutate({ kind: 'lockPeriod', periodId: period.id });
    this.lockTarget.set(null);
  }

  confirmOpenYear(): void {
    this.facade.mutate({ kind: 'openFiscalYear', dto: {} });
    this.openYearConfirm.set(false);
  }

  openCloseYear(year: AccountingFiscalYear): void {
    this.facade.clearMutation();
    this.closingYear.set(year);
    this.closeNextChartId = '';
    this.closeMapping = {};
    this.loadClosePreview();
    showBillingModal(this.closeModalOpen);
  }

  loadClosePreview(): void {
    const year = this.closingYear();

    if (!year) return;

    this.facade.load({ key: 'closePreview', fiscalYearId: year.id, dto: this.closeDto() });
  }

  readonly canCloseYear = computed(() => {
    const preview = this.closePreview().data;

    return Boolean(preview) && !this.closePreview().loading && (preview?.unmapped.length ?? 0) === 0;
  });

  mappingValue(row: { number: string; targetNumber: string | null }): string {
    return this.closeMapping[row.number] || row.targetNumber || '';
  }

  setMapping(number: string, target: string): void {
    this.closeMapping = { ...this.closeMapping, [number]: target.trim() };
  }

  submitCloseYear(): void {
    const year = this.closingYear();

    if (!year) return;

    this.facade.mutate({ kind: 'closeFiscalYear', fiscalYearId: year.id, dto: this.closeDto() });
  }

  private closeDto(): { nextChartId?: string; accountMapping?: Record<string, string> } {
    const mapping = Object.fromEntries(Object.entries(this.closeMapping).filter(([, value]) => value));

    return {
      ...(this.closeNextChartId ? { nextChartId: this.closeNextChartId } : {}),
      ...(Object.keys(mapping).length > 0 ? { accountMapping: mapping } : {}),
    };
  }

  // ---- Charts ----

  reloadCharts(): void {
    this.facade.load({ key: 'charts' });
  }

  openChartModal(): void {
    this.facade.clearMutation();
    this.chartForm = this.emptyChartForm();
    showBillingModal(this.chartModalOpen);
  }

  chartFormValid(): boolean {
    const f = this.chartForm;

    return f.mode === 'template'
      ? Boolean(f.templateKey)
      : /^[A-Za-z0-9-]{2,32}$/.test(f.code.trim()) && !!f.name.trim();
  }

  submitChart(): void {
    if (!this.chartFormValid()) return;

    const f = this.chartForm;

    if (f.mode === 'template') {
      this.facade.mutate({
        kind: 'createChart',
        dto: {
          templateKey: f.templateKey,
          ...(f.code.trim() ? { code: f.code.trim() } : {}),
          ...(f.name.trim() ? { name: f.name.trim() } : {}),
        },
      });

      return;
    }

    this.facade.mutate({
      kind: 'createChart',
      dto: {
        code: f.code.trim(),
        name: f.name.trim(),
        ...(f.country.trim() ? { country: f.country.trim().toUpperCase() } : {}),
        ...(f.accountLength ? { accountLength: Number(f.accountLength) } : {}),
      },
    });
  }

  private emptyChartForm(): ChartForm {
    return {
      mode: 'template',
      templateKey: this.overview().data?.profile.defaultTemplate ?? '',
      code: '',
      name: '',
      country: '',
      accountLength: null,
    };
  }

  // ---- Posting issues / FX ----

  runCatchUp(): void {
    this.facade.mutate({ kind: 'runCatchUp' });
  }

  catchUpSummary(result: AccountingCatchUpResult): string {
    if (result.skipped)
      return $localize`:@@featureAccountingOverview-catchUpSkipped:Catch-up skipped (already running).`;

    const total =
      (result.invoicesIssued ?? 0) +
      (result.invoicesVoided ?? 0) +
      (result.creditDocuments ?? 0) +
      (result.settlements ?? 0) +
      (result.supplierInvoicesIssued ?? 0) +
      (result.supplierInvoicesVoided ?? 0);

    return $localize`:@@featureAccountingOverview-catchUpDone:Catch-up posted ${total}:count: documents and ${result.openingItems ?? 0}:opening: opening items.`;
  }

  openFxModal(): void {
    this.facade.clearMutation();
    this.fxForm = { currency: '', rateDate: accountingToday(), rate: null };
    showBillingModal(this.fxModalOpen);
  }

  fxFormValid(): boolean {
    return /^[A-Za-z]{3}$/.test(this.fxForm.currency.trim()) && !!this.fxForm.rateDate && Number(this.fxForm.rate) > 0;
  }

  submitFxRate(): void {
    if (!this.fxFormValid()) return;

    this.facade.mutate({
      kind: 'setFxRate',
      dto: {
        currency: this.fxForm.currency.trim().toUpperCase(),
        rateDate: this.fxForm.rateDate,
        rate: Number(this.fxForm.rate),
      },
    });
  }

  fetchEcbRates(): void {
    this.facade.mutate({ kind: 'fetchEcbRates' });
  }
}
