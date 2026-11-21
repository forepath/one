import type {
  AccountingResource,
  AccountingAccountType,
  AccountingBankImportStatus,
  AccountingBankMatchStatus,
  AccountingDownloadableExportKind,
  AccountingEntryKind,
  AccountingFixedAssetMethod,
  AccountingFixedAssetStatus,
  AccountingLinkType,
  AccountingTaxCodeKind,
  AccountingVatReturnStatus,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FPC_CHART_GRID,
  FPC_CHART_LEGEND,
  FPC_CHART_LEGEND_SCROLL,
  FPC_CHART_SLICE_LABELS,
  FPC_CHART_SLICE_TOOLTIP,
  fpcChart,
  fpcChartCategorical,
  fpcChartCountAxis,
  fpcChartValueAxis,
  fpcFormatMoney,
  type FpcBadgeTone,
  type FpcTableState,
} from '@forepath/shared/frontend/ui-components';
import type {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexLegend,
  ApexNonAxisChartSeries,
  ApexPlotOptions,
  ApexTooltip,
  ApexXAxis,
  ApexYAxis,
} from 'ng-apexcharts';

import { BILLING_CHART_RESPONSIVE, billingChartTimeAxis } from '../billing-chart';
import { billingLocale, DEFAULT_BILLING_CURRENCY, formatBillingMoney } from '../billing-format';

// ---- Values / dates / files ----

/** Initial value of `toSignal(facade.xxx$)` resource signals. */
export function emptyAccountingResource<T>(): AccountingResource<T> {
  return { data: null, loading: false, error: null, loaded: false };
}

/** API numerics arrive as numbers or numeric strings. */
export function accountingNumber(value: number | string | null | undefined): number {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);

  return Number.isFinite(n) ? n : 0;
}

export function accountingMoney(value: number | string | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined || value === '') return '-';

  return formatBillingMoney(accountingNumber(value), currency || DEFAULT_BILLING_CURRENCY);
}

export function accountingPercent(ratio: number | null | undefined): string {
  return new Intl.NumberFormat(billingLocale(), { style: 'percent', maximumFractionDigits: 1 }).format(ratio ?? 0);
}

export function accountingIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');

  return `${y}-${m}-${d}`;
}

export function accountingToday(): string {
  return accountingIsoDate(new Date());
}

/** Jan 1 of the current year (default range start of statistics). */
export function accountingYearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

export function accountingYearEnd(): string {
  return `${new Date().getFullYear()}-12-31`;
}

/** `YYYY-MM` of the previous month (default depreciation run month). */
export function accountingPreviousMonth(): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Saves a downloaded file via an object URL (same as the DATEV export download). */
export function saveAccountingBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Viewed tenant of a request (`null` = own tenant). */
export function accountingTenantParam(viewTenantId: string | null | undefined): string | undefined {
  return viewTenantId?.trim() || undefined;
}

// ---- Labels ----

export function accountTypeLabel(type: AccountingAccountType | string): string {
  const labels: Record<string, string> = {
    asset: $localize`:@@featureAccounting-typeAsset:Asset`,
    liability: $localize`:@@featureAccounting-typeLiability:Liability`,
    equity: $localize`:@@featureAccounting-typeEquity:Equity`,
    revenue: $localize`:@@featureAccounting-typeRevenue:Revenue`,
    expense: $localize`:@@featureAccounting-typeExpense:Expense`,
    statistical: $localize`:@@featureAccounting-typeStatistical:Statistical`,
  };

  return labels[type] ?? type;
}

export const ACCOUNTING_ACCOUNT_TYPES: readonly AccountingAccountType[] = [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
  'statistical',
];

export function taxCodeKindLabel(kind: AccountingTaxCodeKind | string): string {
  const labels: Record<string, string> = {
    output: $localize`:@@featureAccounting-taxKindOutput:Output VAT`,
    input: $localize`:@@featureAccounting-taxKindInput:Input VAT`,
    reverse_charge: $localize`:@@featureAccounting-taxKindReverseCharge:Reverse charge`,
    exempt: $localize`:@@featureAccounting-taxKindExempt:Exempt`,
  };

  return labels[kind] ?? kind;
}

export const ACCOUNTING_TAX_CODE_KINDS: readonly AccountingTaxCodeKind[] = [
  'output',
  'input',
  'reverse_charge',
  'exempt',
];

export function entryKindLabel(kind: AccountingEntryKind | string): string {
  const labels: Record<string, string> = {
    automatic: $localize`:@@featureAccounting-kindAutomatic:Automatic`,
    manual: $localize`:@@featureAccounting-kindManual:Manual`,
    opening: $localize`:@@featureAccounting-kindOpening:Opening`,
    closing: $localize`:@@featureAccounting-kindClosing:Closing`,
    reversal: $localize`:@@featureAccounting-kindReversal:Reversal`,
    depreciation: $localize`:@@featureAccounting-kindDepreciation:Depreciation`,
    vat_settlement: $localize`:@@featureAccounting-kindVatSettlement:VAT settlement`,
  };

  return labels[kind] ?? kind;
}

export const ACCOUNTING_ENTRY_KINDS: readonly AccountingEntryKind[] = [
  'automatic',
  'manual',
  'opening',
  'closing',
  'reversal',
  'depreciation',
  'vat_settlement',
];

export function sourceTypeLabel(source: string): string {
  const labels: Record<string, string> = {
    invoice: $localize`:@@featureAccounting-sourceInvoice:Invoice`,
    credit_document: $localize`:@@featureAccounting-sourceCreditDocument:Credit note`,
    void_document: $localize`:@@featureAccounting-sourceVoidDocument:Void document`,
    settlement: $localize`:@@featureAccounting-sourceSettlement:Payment`,
    supplier_invoice: $localize`:@@featureAccounting-sourceSupplierInvoice:Supplier invoice`,
    bank_transaction: $localize`:@@featureAccounting-sourceBankTransaction:Bank transaction`,
    processor_transaction: $localize`:@@featureAccounting-sourceProcessorTransaction:Processor transaction`,
    inventory_movement: $localize`:@@featureAccounting-sourceInventoryMovement:Inventory movement`,
    fixed_asset: $localize`:@@featureAccounting-sourceFixedAsset:Fixed asset`,
    vat_return: $localize`:@@featureAccounting-sourceVatReturn:VAT return`,
    fiscal_year: $localize`:@@featureAccounting-sourceFiscalYear:Fiscal year`,
    manual: $localize`:@@featureAccounting-sourceManual:Manual`,
    opening_balance: $localize`:@@featureAccounting-sourceOpeningBalance:Opening balance`,
  };

  return labels[source] ?? source;
}

export const ACCOUNTING_SOURCE_TYPES: readonly string[] = [
  'invoice',
  'credit_document',
  'void_document',
  'settlement',
  'supplier_invoice',
  'bank_transaction',
  'processor_transaction',
  'inventory_movement',
  'fixed_asset',
  'vat_return',
  'fiscal_year',
  'manual',
  'opening_balance',
];

export function linkTypeLabel(type: AccountingLinkType | string): string {
  const labels: Record<string, string> = {
    offer: $localize`:@@featureAccounting-linkOffer:Offer`,
    project: $localize`:@@featureAccounting-linkProject:Project`,
    subscription: $localize`:@@featureAccounting-linkSubscription:Subscription`,
    stored_file: $localize`:@@featureAccounting-linkStoredFile:Receipt file`,
    payment_attempt: $localize`:@@featureAccounting-linkPaymentAttempt:Payment attempt`,
    payment_refund: $localize`:@@featureAccounting-linkPaymentRefund:Refund`,
    journal_entry: $localize`:@@featureAccounting-linkJournalEntry:Journal entry`,
  };

  return labels[type] ?? sourceTypeLabel(type);
}

export const ACCOUNTING_LINK_TYPES: readonly AccountingLinkType[] = [
  'invoice',
  'credit_document',
  'void_document',
  'supplier_invoice',
  'settlement',
  'payment_attempt',
  'payment_refund',
  'bank_transaction',
  'processor_transaction',
  'inventory_movement',
  'fixed_asset',
  'offer',
  'project',
  'subscription',
  'vat_return',
  'journal_entry',
];

export function matchStatusLabel(status: AccountingBankMatchStatus | string): string {
  const labels: Record<string, string> = {
    unmatched: $localize`:@@featureAccounting-matchUnmatched:Unmatched`,
    suggested: $localize`:@@featureAccounting-matchSuggested:Suggested`,
    matched: $localize`:@@featureAccounting-matchMatched:Matched`,
    booked: $localize`:@@featureAccounting-matchBooked:Booked`,
    ignored: $localize`:@@featureAccounting-matchIgnored:Ignored`,
    superseded: $localize`:@@featureAccounting-matchSuperseded:Superseded (booked or duplicate)`,
  };

  return labels[status] ?? status;
}

export function matchStatusState(status: AccountingBankMatchStatus | string): FpcTableState {
  const tones: Record<string, FpcBadgeTone> = {
    unmatched: 'warning',
    suggested: 'info',
    matched: 'success',
    booked: 'success',
    ignored: 'neutral',
    superseded: 'neutral',
  };

  return { label: matchStatusLabel(status), tone: tones[status] ?? 'neutral' };
}

export const ACCOUNTING_MATCH_STATUSES: readonly AccountingBankMatchStatus[] = [
  'unmatched',
  'suggested',
  'matched',
  'booked',
  'ignored',
  'superseded',
];

export function importStatusState(status: AccountingBankImportStatus | string): FpcTableState {
  const labels: Record<string, string> = {
    pending: $localize`:@@featureAccounting-importPending:Pending`,
    processing: $localize`:@@featureAccounting-importProcessing:Processing`,
    completed: $localize`:@@featureAccounting-importCompleted:Completed`,
    failed: $localize`:@@featureAccounting-importFailed:Failed`,
    rolled_back: $localize`:@@featureAccounting-importRolledBack:Rolled back`,
  };
  const tones: Record<string, FpcBadgeTone> = {
    pending: 'info',
    processing: 'primary',
    completed: 'success',
    failed: 'danger',
    rolled_back: 'neutral',
  };

  return { label: labels[status] ?? status, tone: tones[status] ?? 'neutral' };
}

export function vatStatusState(status: AccountingVatReturnStatus | string): FpcTableState {
  const labels: Record<string, string> = {
    draft: $localize`:@@featureAccounting-vatDraft:Draft`,
    submitted: $localize`:@@featureAccounting-vatSubmitted:Submitted`,
    paid: $localize`:@@featureAccounting-vatPaid:Paid`,
  };
  const tones: Record<string, FpcBadgeTone> = { draft: 'warning', submitted: 'info', paid: 'success' };

  return { label: labels[status] ?? status, tone: tones[status] ?? 'neutral' };
}

export function assetStatusState(status: AccountingFixedAssetStatus | string): FpcTableState {
  const labels: Record<string, string> = {
    active: $localize`:@@featureAccounting-assetActive:Active`,
    fully_depreciated: $localize`:@@featureAccounting-assetFullyDepreciated:Fully depreciated`,
    disposed: $localize`:@@featureAccounting-assetDisposed:Disposed`,
  };
  const tones: Record<string, FpcBadgeTone> = { active: 'success', fully_depreciated: 'info', disposed: 'neutral' };

  return { label: labels[status] ?? status, tone: tones[status] ?? 'neutral' };
}

export function assetMethodLabel(method: AccountingFixedAssetMethod | string): string {
  const labels: Record<string, string> = {
    straight_line: $localize`:@@featureAccounting-methodStraightLine:Straight line`,
    immediate: $localize`:@@featureAccounting-methodImmediate:Immediate write-off`,
    pool: $localize`:@@featureAccounting-methodPool:Asset pool`,
  };

  return labels[method] ?? method;
}

export function exportKindLabel(kind: AccountingDownloadableExportKind | string): string {
  const labels: Record<string, string> = {
    datev: 'DATEV',
    journal_csv: $localize`:@@featureAccounting-exportJournalCsv:Journal (CSV)`,
    trial_balance_csv: $localize`:@@featureAccounting-exportTrialBalanceCsv:Trial balance (CSV)`,
    gdpdu: $localize`:@@featureAccounting-exportGdpdu:GDPdU / GoBD`,
    fec: $localize`:@@featureAccounting-exportFec:FEC`,
    saft: $localize`:@@featureAccounting-exportSaft:SAF-T`,
    xaf: 'XAF 3.2 (Auditfile Financieel)',
  };

  return labels[kind] ?? kind;
}

export function agingBucketLabel(bucket: string): string {
  return bucket === 'current' ? $localize`:@@featureAccounting-agingCurrent:Not due` : bucket;
}

export const ACCOUNTING_AGING_BUCKETS: readonly string[] = ['current', '1-30', '31-60', '61-90', '90+'];

// ---- Charts ----

function compactMoneyAxis() {
  return fpcChartValueAxis((value) =>
    fpcFormatMoney(value, DEFAULT_BILLING_CURRENCY, billingLocale(), { compact: true }),
  ) as ApexYAxis;
}

/** Bar / line chart over category buckets (months, sources …); `money` formats axis + tooltip as currency. */
export function accountingSeriesChart(
  type: 'bar' | 'area' | 'line',
  categories: readonly string[],
  series: Array<{ name: string; data: number[] }>,
  options: { money?: boolean; colors?: string[]; stacked?: boolean; height?: number } = {},
) {
  if (categories.length === 0) return null;

  const money = options.money ?? false;

  return {
    series: series as ApexAxisChartSeries,
    chart: fpcChart(type, options.height ?? 240, { stacked: options.stacked }) as ApexChart,
    colors: options.colors ?? ['var(--bs-primary)', 'var(--bs-danger)', 'var(--bs-info)', 'var(--bs-warning)'],
    plotOptions: { bar: { columnWidth: '55%', borderRadius: 2 } } as ApexPlotOptions,
    dataLabels: { enabled: false } as ApexDataLabels,
    legend: { ...FPC_CHART_LEGEND, position: 'top' } as ApexLegend,
    xaxis: billingChartTimeAxis([...categories]) as ApexXAxis,
    yaxis: (money ? compactMoneyAxis() : fpcChartCountAxis()) as ApexYAxis,
    grid: FPC_CHART_GRID,
    tooltip: (money ? { y: { formatter: (value: number) => formatBillingMoney(value) } } : {}) as ApexTooltip,
    responsive: BILLING_CHART_RESPONSIVE,
  };
}

export type AccountingSeriesChart = NonNullable<ReturnType<typeof accountingSeriesChart>>;

/** Donut of shares (statuses, aging buckets …). */
export function accountingDonutChart(
  labels: readonly string[],
  values: readonly number[],
  options: { money?: boolean; dark?: boolean; colors?: string[] } = {},
) {
  if (values.length === 0 || values.every((v) => !v)) return null;

  return {
    series: [...values] as ApexNonAxisChartSeries,
    chart: fpcChart('donut', 240) as ApexChart,
    labels: [...labels],
    colors: options.colors ?? fpcChartCategorical(values.length, options.dark ?? false),
    dataLabels: {
      ...FPC_CHART_SLICE_LABELS,
      enabled: true,
      formatter: (percent: number) => `${percent.toFixed(1)}%`,
      style: { ...FPC_CHART_SLICE_LABELS.style, fontSize: '10px' },
    } as ApexDataLabels,
    legend: FPC_CHART_LEGEND_SCROLL as ApexLegend,
    tooltip: {
      ...FPC_CHART_SLICE_TOOLTIP,
      y: { formatter: (value: number) => (options.money ? formatBillingMoney(value) : String(value)) },
    } as ApexTooltip,
    responsive: BILLING_CHART_RESPONSIVE,
  };
}

export type AccountingDonutChart = NonNullable<ReturnType<typeof accountingDonutChart>>;

/** `YYYY-MM` / `YYYY-MM-DD` bucket → short month label (`Jan 2026`). */
export function accountingMonthLabel(bucket: string): string {
  const [y, m] = bucket.split('-').map(Number);

  if (!y || !m) return bucket;

  return new Intl.DateTimeFormat(billingLocale(), { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 15)),
  );
}
