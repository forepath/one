import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { forkJoin, map, Observable, of, switchMap } from 'rxjs';

import type {
  AccountingAccount,
  AccountingAccountImportResult,
  AccountingAccountInput,
  AccountingAssetScheduleRow,
  AccountingBankImport,
  AccountingBankImportUpload,
  AccountingBankStatistics,
  AccountingBankTransaction,
  AccountingBankTransactionParams,
  AccountingCatchUpResult,
  AccountingChart,
  AccountingChartTemplate,
  AccountingClosePreview,
  AccountingCloseYearDto,
  AccountingComputeVatReturnInput,
  AccountingCsvMapping,
  AccountingCsvMappingInput,
  AccountingCsvPreset,
  AccountingDateRange,
  AccountingDepreciationRunResult,
  AccountingDisposeAssetInput,
  AccountingDownloadableExportKind,
  AccountingEntryLink,
  AccountingFinancialAccount,
  AccountingFinancialAccountInput,
  AccountingFiscalYear,
  AccountingFixedAsset,
  AccountingFixedAssetDetail,
  AccountingFixedAssetInput,
  AccountingFixedAssetParams,
  AccountingFxRate,
  AccountingFxRateInput,
  AccountingFxRateParams,
  AccountingJournalEntry,
  AccountingJournalLinkInput,
  AccountingJournalListParams,
  AccountingJournalStatistics,
  AccountingLedger,
  AccountingLedgerParams,
  AccountingLinkType,
  AccountingManualEntryInput,
  AccountingMatchInput,
  AccountingMatchRule,
  AccountingMatchRuleInput,
  AccountingMatchSuggestion,
  AccountingOpenFiscalYearDto,
  AccountingOpenItems,
  AccountingOverview,
  AccountingPage,
  AccountingPayVatReturnInput,
  AccountingPeriod,
  AccountingPostingIssue,
  AccountingProcessorSyncResult,
  AccountingReverseEntryInput,
  AccountingStatement,
  AccountingStatementParams,
  AccountingSubmitVatReturnInput,
  AccountingTaxCode,
  AccountingTaxCodeInput,
  AccountingTaxCodeUpdate,
  AccountingTrialBalanceRow,
  AccountingVatReturn,
  AccountingVatReturnDefinition,
  AccountingVatReturnListParams,
  AccountingVatStatistics,
  AccountingCounterpartyType,
  CreateAccountingChartDto,
} from '../types/accounting.types';

type QueryValue = string | number | boolean | null | undefined;

/** `viewTenantId` value of the request; `null` / empty = the request tenant. */
export type AccountingViewTenant = string | null | undefined;

function toParams(values: Record<string, QueryValue>): HttpParams {
  let params = new HttpParams();

  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;

    const text = typeof value === 'string' ? value.trim() : String(value);

    if (text !== '') params = params.set(key, text);
  }

  return params;
}

/**
 * Admin accounting API (`/admin/billing/accounting`, scopes `accounting:read` / `accounting:admin`). Tenant-scoped
 * reads accept `viewTenantId` (another tenant or `all`, global views only); entity-wide functions need global access.
 */
@Injectable({
  providedIn: 'root',
})
export class AdminAccountingService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get baseUrl(): string {
    return `${this.environment.billing.urls.restApi}/admin/billing/accounting`;
  }

  // ---- Setup ----

  getOverview(viewTenantId?: AccountingViewTenant): Observable<AccountingOverview> {
    return this.http.get<AccountingOverview>(`${this.baseUrl}/overview`, { params: toParams({ viewTenantId }) });
  }

  listChartTemplates(): Observable<AccountingChartTemplate[]> {
    return this.http.get<AccountingChartTemplate[]>(`${this.baseUrl}/chart-templates`);
  }

  listCharts(): Observable<AccountingChart[]> {
    return this.http.get<AccountingChart[]>(`${this.baseUrl}/charts`);
  }

  createChart(dto: CreateAccountingChartDto): Observable<AccountingChart> {
    return this.http.post<AccountingChart>(`${this.baseUrl}/charts`, dto);
  }

  listAccounts(chartId: string): Observable<AccountingAccount[]> {
    return this.http.get<AccountingAccount[]>(`${this.baseUrl}/charts/${chartId}/accounts`);
  }

  /** Accounts of every chart (label lookup for journal lines across chart changes). */
  listAllAccounts(): Observable<AccountingAccount[]> {
    return this.listCharts().pipe(
      switchMap((charts) =>
        charts.length === 0 ? of([] as AccountingAccount[][]) : forkJoin(charts.map((c) => this.listAccounts(c.id))),
      ),
      map((lists) => lists.flat()),
    );
  }

  createAccount(chartId: string, dto: AccountingAccountInput): Observable<AccountingAccount> {
    return this.http.post<AccountingAccount>(`${this.baseUrl}/charts/${chartId}/accounts`, dto);
  }

  updateAccount(accountId: string, dto: Partial<AccountingAccountInput>): Observable<AccountingAccount> {
    return this.http.patch<AccountingAccount>(`${this.baseUrl}/accounts/${accountId}`, dto);
  }

  deleteAccount(accountId: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.baseUrl}/accounts/${accountId}`);
  }

  /** CSV (`number;name[;type[;position]]`) or DATEV Kontenbeschriftungen. */
  importAccounts(chartId: string, file: File): Observable<AccountingAccountImportResult> {
    const form = new FormData();

    form.append('file', file, file.name);

    return this.http.post<AccountingAccountImportResult>(`${this.baseUrl}/charts/${chartId}/accounts/import`, form);
  }

  listTaxCodes(chartId: string): Observable<AccountingTaxCode[]> {
    return this.http.get<AccountingTaxCode[]>(`${this.baseUrl}/charts/${chartId}/tax-codes`);
  }

  createTaxCode(chartId: string, dto: AccountingTaxCodeInput): Observable<AccountingTaxCode> {
    return this.http.post<AccountingTaxCode>(`${this.baseUrl}/charts/${chartId}/tax-codes`, dto);
  }

  updateTaxCode(taxCodeId: string, dto: AccountingTaxCodeUpdate): Observable<AccountingTaxCode> {
    return this.http.patch<AccountingTaxCode>(`${this.baseUrl}/tax-codes/${taxCodeId}`, dto);
  }

  listFiscalYears(): Observable<AccountingFiscalYear[]> {
    return this.http.get<AccountingFiscalYear[]>(`${this.baseUrl}/fiscal-years`);
  }

  openFiscalYear(dto: AccountingOpenFiscalYearDto): Observable<AccountingFiscalYear> {
    return this.http.post<AccountingFiscalYear>(`${this.baseUrl}/fiscal-years`, dto);
  }

  changeFiscalYearChart(fiscalYearId: string, chartId: string): Observable<AccountingFiscalYear> {
    return this.http.patch<AccountingFiscalYear>(`${this.baseUrl}/fiscal-years/${fiscalYearId}/chart`, { chartId });
  }

  lockPeriod(periodId: string): Observable<AccountingPeriod> {
    return this.http.post<AccountingPeriod>(`${this.baseUrl}/periods/${periodId}/lock`, {});
  }

  previewCloseFiscalYear(fiscalYearId: string, dto: AccountingCloseYearDto): Observable<AccountingClosePreview> {
    return this.http.post<AccountingClosePreview>(`${this.baseUrl}/fiscal-years/${fiscalYearId}/close/preview`, dto);
  }

  closeFiscalYear(fiscalYearId: string, dto: AccountingCloseYearDto): Observable<AccountingFiscalYear> {
    return this.http.post<AccountingFiscalYear>(`${this.baseUrl}/fiscal-years/${fiscalYearId}/close`, dto);
  }

  listFxRates(params: AccountingFxRateParams = {}): Observable<AccountingPage<AccountingFxRate>> {
    return this.http.get<AccountingPage<AccountingFxRate>>(`${this.baseUrl}/fx-rates`, {
      params: toParams({ ...params }),
    });
  }

  setFxRate(dto: AccountingFxRateInput): Observable<AccountingFxRate> {
    return this.http.post<AccountingFxRate>(`${this.baseUrl}/fx-rates`, dto);
  }

  fetchEcbRates(): Observable<{ stored: number }> {
    return this.http.post<{ stored: number }>(`${this.baseUrl}/fx-rates/fetch`, {});
  }

  listPostingIssues(
    params: { includeResolved?: boolean; limit?: number; offset?: number } = {},
  ): Observable<AccountingPage<AccountingPostingIssue>> {
    return this.http.get<AccountingPage<AccountingPostingIssue>>(`${this.baseUrl}/posting-issues`, {
      params: toParams({ ...params }),
    });
  }

  runCatchUp(): Observable<AccountingCatchUpResult> {
    return this.http.post<AccountingCatchUpResult>(`${this.baseUrl}/catch-up`, {});
  }

  // ---- Journal ----

  listJournal(
    params: AccountingJournalListParams,
    viewTenantId?: AccountingViewTenant,
  ): Observable<AccountingPage<AccountingJournalEntry>> {
    return this.http.get<AccountingPage<AccountingJournalEntry>>(`${this.baseUrl}/journal`, {
      params: toParams({ ...params, viewTenantId }),
    });
  }

  getJournalStatistics(
    range: AccountingDateRange,
    viewTenantId?: AccountingViewTenant,
  ): Observable<AccountingJournalStatistics> {
    return this.http.get<AccountingJournalStatistics>(`${this.baseUrl}/journal/statistics`, {
      params: toParams({ ...range, viewTenantId }),
    });
  }

  /** Bookings linked to a document / transaction (reverse lookup). */
  listEntriesByLink(
    linkType: AccountingLinkType,
    targetId: string,
    viewTenantId?: AccountingViewTenant,
  ): Observable<AccountingJournalEntry[]> {
    return this.http.get<AccountingJournalEntry[]>(`${this.baseUrl}/journal/by-link`, {
      params: toParams({ linkType, targetId, viewTenantId }),
    });
  }

  /** Display label (document number) of a link target; `null` when unknown. */
  getReferenceLabel(
    linkType: AccountingLinkType,
    targetId: string,
    viewTenantId?: AccountingViewTenant,
  ): Observable<{ label: string | null }> {
    return this.http.get<{ label: string | null }>(`${this.baseUrl}/journal/reference-label`, {
      params: toParams({ linkType, targetId, viewTenantId }),
    });
  }

  getEntry(entryId: string, viewTenantId?: AccountingViewTenant): Observable<AccountingJournalEntry> {
    return this.http.get<AccountingJournalEntry>(`${this.baseUrl}/journal/${entryId}`, {
      params: toParams({ viewTenantId }),
    });
  }

  createManualEntry(
    dto: AccountingManualEntryInput,
    viewTenantId?: AccountingViewTenant,
  ): Observable<AccountingJournalEntry> {
    return this.http.post<AccountingJournalEntry>(`${this.baseUrl}/journal`, dto, {
      params: toParams({ viewTenantId }),
    });
  }

  reverseEntry(
    entryId: string,
    dto: AccountingReverseEntryInput,
    viewTenantId?: AccountingViewTenant,
  ): Observable<AccountingJournalEntry> {
    return this.http.post<AccountingJournalEntry>(`${this.baseUrl}/journal/${entryId}/reverse`, dto, {
      params: toParams({ viewTenantId }),
    });
  }

  addLink(
    entryId: string,
    dto: AccountingJournalLinkInput,
    viewTenantId?: AccountingViewTenant,
  ): Observable<AccountingEntryLink> {
    return this.http.post<AccountingEntryLink>(`${this.baseUrl}/journal/${entryId}/links`, dto, {
      params: toParams({ viewTenantId }),
    });
  }

  removeLink(entryId: string, linkId: string, viewTenantId?: AccountingViewTenant): Observable<{ removed: boolean }> {
    return this.http.delete<{ removed: boolean }>(`${this.baseUrl}/journal/${entryId}/links/${linkId}`, {
      params: toParams({ viewTenantId }),
    });
  }

  attachReceipt(entryId: string, file: File, viewTenantId?: AccountingViewTenant): Observable<AccountingEntryLink> {
    const form = new FormData();

    form.append('file', file, file.name);

    return this.http.post<AccountingEntryLink>(`${this.baseUrl}/journal/${entryId}/receipts`, form, {
      params: toParams({ viewTenantId }),
    });
  }

  downloadReceipt(storedFileId: string, viewTenantId?: AccountingViewTenant): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/receipts/${storedFileId}`, {
      params: toParams({ viewTenantId }),
      responseType: 'blob',
    });
  }

  // ---- Reports ----

  getAccountLedger(params: AccountingLedgerParams, viewTenantId?: AccountingViewTenant): Observable<AccountingLedger> {
    const { accountId, ...query } = params;

    return this.http.get<AccountingLedger>(`${this.baseUrl}/accounts/${accountId}/ledger`, {
      params: toParams({ ...query, viewTenantId }),
    });
  }

  getTrialBalance(
    range: AccountingDateRange,
    viewTenantId?: AccountingViewTenant,
  ): Observable<AccountingTrialBalanceRow[]> {
    return this.http.get<AccountingTrialBalanceRow[]>(`${this.baseUrl}/trial-balance`, {
      params: toParams({ ...range, viewTenantId }),
    });
  }

  getOpenItems(
    params: { type: AccountingCounterpartyType; asOf?: string },
    viewTenantId?: AccountingViewTenant,
  ): Observable<AccountingOpenItems> {
    return this.http.get<AccountingOpenItems>(`${this.baseUrl}/open-items`, {
      params: toParams({ ...params, viewTenantId }),
    });
  }

  getStatement(
    params: AccountingStatementParams,
    viewTenantId?: AccountingViewTenant,
  ): Observable<AccountingStatement> {
    return this.http.get<AccountingStatement>(`${this.baseUrl}/statements`, {
      params: toParams({ ...params, viewTenantId }),
    });
  }

  /** Journal / trial balance CSV, GDPdU, FEC or SAF-T file (statutory kinds need `viewTenantId=all`). */
  downloadExport(
    kind: AccountingDownloadableExportKind,
    range: AccountingDateRange,
    viewTenantId?: AccountingViewTenant,
  ): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/exports`, {
      params: toParams({ kind, ...range, viewTenantId }),
      responseType: 'blob',
    });
  }

  // ---- VAT returns ----

  listVatDefinitions(): Observable<AccountingVatReturnDefinition[]> {
    return this.http.get<AccountingVatReturnDefinition[]>(`${this.baseUrl}/vat-returns/definitions`);
  }

  listVatReturns(params: AccountingVatReturnListParams = {}): Observable<AccountingPage<AccountingVatReturn>> {
    return this.http.get<AccountingPage<AccountingVatReturn>>(`${this.baseUrl}/vat-returns`, {
      params: toParams({ ...params }),
    });
  }

  getVatStatistics(): Observable<AccountingVatStatistics> {
    return this.http.get<AccountingVatStatistics>(`${this.baseUrl}/vat-returns/statistics`);
  }

  getVatReturn(id: string): Observable<AccountingVatReturn> {
    return this.http.get<AccountingVatReturn>(`${this.baseUrl}/vat-returns/${id}`);
  }

  downloadVatReturnCsv(id: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/vat-returns/${id}/csv`, { responseType: 'blob' });
  }

  computeVatReturn(dto: AccountingComputeVatReturnInput): Observable<AccountingVatReturn> {
    return this.http.post<AccountingVatReturn>(`${this.baseUrl}/vat-returns/compute`, dto);
  }

  submitVatReturn(id: string, dto: AccountingSubmitVatReturnInput): Observable<AccountingVatReturn> {
    return this.http.post<AccountingVatReturn>(`${this.baseUrl}/vat-returns/${id}/submit`, dto);
  }

  payVatReturn(id: string, dto: AccountingPayVatReturnInput): Observable<AccountingVatReturn> {
    return this.http.post<AccountingVatReturn>(`${this.baseUrl}/vat-returns/${id}/payment`, dto);
  }

  // ---- Banking ----

  listFinancialAccounts(viewTenantId?: AccountingViewTenant): Observable<AccountingFinancialAccount[]> {
    return this.http.get<AccountingFinancialAccount[]>(`${this.baseUrl}/banking/accounts`, {
      params: toParams({ viewTenantId }),
    });
  }

  createFinancialAccount(dto: AccountingFinancialAccountInput): Observable<AccountingFinancialAccount> {
    return this.http.post<AccountingFinancialAccount>(`${this.baseUrl}/banking/accounts`, dto);
  }

  updateFinancialAccount(id: string, dto: AccountingFinancialAccountInput): Observable<AccountingFinancialAccount> {
    return this.http.patch<AccountingFinancialAccount>(`${this.baseUrl}/banking/accounts/${id}`, dto);
  }

  listCsvPresets(): Observable<AccountingCsvPreset[]> {
    return this.http.get<AccountingCsvPreset[]>(`${this.baseUrl}/banking/csv-presets`);
  }

  listCsvMappings(): Observable<AccountingCsvMapping[]> {
    return this.http.get<AccountingCsvMapping[]>(`${this.baseUrl}/banking/csv-mappings`);
  }

  createCsvMapping(dto: AccountingCsvMappingInput): Observable<AccountingCsvMapping> {
    return this.http.post<AccountingCsvMapping>(`${this.baseUrl}/banking/csv-mappings`, dto);
  }

  updateCsvMapping(id: string, dto: AccountingCsvMappingInput): Observable<AccountingCsvMapping> {
    return this.http.patch<AccountingCsvMapping>(`${this.baseUrl}/banking/csv-mappings/${id}`, dto);
  }

  deleteCsvMapping(id: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.baseUrl}/banking/csv-mappings/${id}`);
  }

  listImports(
    params: { limit?: number; offset?: number } = {},
    viewTenantId?: AccountingViewTenant,
  ): Observable<AccountingPage<AccountingBankImport>> {
    return this.http.get<AccountingPage<AccountingBankImport>>(`${this.baseUrl}/banking/imports`, {
      params: toParams({ ...params, viewTenantId }),
    });
  }

  /** Multipart statement upload (`file` + optional account / format / CSV preset or mapping / encoding fields). */
  uploadImport(upload: AccountingBankImportUpload): Observable<AccountingBankImport> {
    const form = new FormData();
    const { file, ...fields } = upload;

    form.append('file', file, file.name);

    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'string' && value.trim() !== '') form.append(key, value.trim());
    }

    return this.http.post<AccountingBankImport>(`${this.baseUrl}/banking/imports`, form);
  }

  getImport(id: string): Observable<AccountingBankImport> {
    return this.http.get<AccountingBankImport>(`${this.baseUrl}/banking/imports/${id}`);
  }

  downloadImportFile(id: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/banking/imports/${id}/file`, { responseType: 'blob' });
  }

  rollbackImport(id: string): Observable<AccountingBankImport> {
    return this.http.post<AccountingBankImport>(`${this.baseUrl}/banking/imports/${id}/rollback`, {});
  }

  listTransactions(
    params: AccountingBankTransactionParams,
    viewTenantId?: AccountingViewTenant,
  ): Observable<AccountingPage<AccountingBankTransaction>> {
    return this.http.get<AccountingPage<AccountingBankTransaction>>(`${this.baseUrl}/banking/transactions`, {
      params: toParams({ ...params, viewTenantId }),
    });
  }

  getBankStatistics(
    range: AccountingDateRange,
    viewTenantId?: AccountingViewTenant,
  ): Observable<AccountingBankStatistics> {
    return this.http.get<AccountingBankStatistics>(`${this.baseUrl}/banking/statistics`, {
      params: toParams({ ...range, viewTenantId }),
    });
  }

  getSuggestions(transactionId: string): Observable<AccountingMatchSuggestion[]> {
    return this.http.get<AccountingMatchSuggestion[]>(
      `${this.baseUrl}/banking/transactions/${transactionId}/suggestions`,
    );
  }

  matchTransaction(transactionId: string, dto: AccountingMatchInput): Observable<unknown> {
    return this.http.post<unknown>(`${this.baseUrl}/banking/transactions/${transactionId}/match`, dto);
  }

  unmatchTransaction(transactionId: string): Observable<AccountingBankTransaction> {
    return this.http.post<AccountingBankTransaction>(
      `${this.baseUrl}/banking/transactions/${transactionId}/unmatch`,
      {},
    );
  }

  ignoreTransaction(transactionId: string): Observable<{ ignored: boolean }> {
    return this.http.post<{ ignored: boolean }>(`${this.baseUrl}/banking/transactions/${transactionId}/ignore`, {});
  }

  listMatchRules(): Observable<AccountingMatchRule[]> {
    return this.http.get<AccountingMatchRule[]>(`${this.baseUrl}/banking/rules`);
  }

  createMatchRule(dto: AccountingMatchRuleInput): Observable<AccountingMatchRule> {
    return this.http.post<AccountingMatchRule>(`${this.baseUrl}/banking/rules`, dto);
  }

  deleteMatchRule(id: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.baseUrl}/banking/rules/${id}`);
  }

  runProcessorSync(): Observable<AccountingProcessorSyncResult> {
    return this.http.post<AccountingProcessorSyncResult>(`${this.baseUrl}/banking/processor-sync`, {});
  }

  // ---- Fixed assets ----

  listAssets(params: AccountingFixedAssetParams = {}): Observable<AccountingPage<AccountingFixedAsset>> {
    return this.http.get<AccountingPage<AccountingFixedAsset>>(`${this.baseUrl}/assets`, {
      params: toParams({ ...params }),
    });
  }

  getAssetSchedule(range: AccountingDateRange): Observable<AccountingAssetScheduleRow[]> {
    return this.http.get<AccountingAssetScheduleRow[]>(`${this.baseUrl}/assets/schedule`, {
      params: toParams({ ...range }),
    });
  }

  getAsset(id: string): Observable<AccountingFixedAssetDetail> {
    return this.http.get<AccountingFixedAssetDetail>(`${this.baseUrl}/assets/${id}`);
  }

  createAsset(dto: AccountingFixedAssetInput): Observable<AccountingFixedAsset> {
    return this.http.post<AccountingFixedAsset>(`${this.baseUrl}/assets`, dto);
  }

  /** `through`: `YYYY-MM`. */
  runDepreciation(through: string): Observable<AccountingDepreciationRunResult> {
    return this.http.post<AccountingDepreciationRunResult>(`${this.baseUrl}/assets/depreciation-run`, { through });
  }

  disposeAsset(id: string, dto: AccountingDisposeAssetInput): Observable<AccountingFixedAsset> {
    return this.http.post<AccountingFixedAsset>(`${this.baseUrl}/assets/${id}/dispose`, dto);
  }
}
