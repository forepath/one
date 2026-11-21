import { createAction, props } from '@ngrx/store';

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
  AccountingCounterpartyType,
  AccountingCsvMapping,
  AccountingCsvMappingInput,
  AccountingCsvPreset,
  AccountingDateRange,
  AccountingDepreciationRunResult,
  AccountingDisposeAssetInput,
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
  AccountingPostingIssue,
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
  CreateAccountingChartDto,
} from '../../types/accounting.types';

/** Data of every accounting resource (one slice each, keyed by the request kind). */
export interface AccountingResourceMap {
  overview: AccountingOverview;
  templates: AccountingChartTemplate[];
  charts: AccountingChart[];
  accounts: AccountingAccount[];
  /** Accounts of all charts (label lookup for journal lines). */
  accountDirectory: AccountingAccount[];
  taxCodes: AccountingTaxCode[];
  fiscalYears: AccountingFiscalYear[];
  closePreview: AccountingClosePreview;
  fxRates: AccountingPage<AccountingFxRate>;
  postingIssues: AccountingPage<AccountingPostingIssue>;
  journal: AccountingPage<AccountingJournalEntry>;
  journalStatistics: AccountingJournalStatistics;
  entry: AccountingJournalEntry;
  byLink: AccountingJournalEntry[];
  trialBalance: AccountingTrialBalanceRow[];
  ledger: AccountingLedger;
  openItems: AccountingOpenItems;
  statement: AccountingStatement;
  vatDefinitions: AccountingVatReturnDefinition[];
  vatReturns: AccountingPage<AccountingVatReturn>;
  vatStatistics: AccountingVatStatistics;
  vatReturn: AccountingVatReturn;
  financialAccounts: AccountingFinancialAccount[];
  imports: AccountingPage<AccountingBankImport>;
  importDetail: AccountingBankImport;
  transactions: AccountingPage<AccountingBankTransaction>;
  bankStatistics: AccountingBankStatistics;
  suggestions: AccountingMatchSuggestion[];
  csvPresets: AccountingCsvPreset[];
  csvMappings: AccountingCsvMapping[];
  matchRules: AccountingMatchRule[];
  assets: AccountingPage<AccountingFixedAsset>;
  asset: AccountingFixedAssetDetail;
  assetSchedule: AccountingAssetScheduleRow[];
}

export type AccountingResourceKey = keyof AccountingResourceMap;

/** One read request; `key` names the resource slice it fills. */
export type AccountingRequest =
  | { key: 'overview' }
  | { key: 'templates' }
  | { key: 'charts' }
  | { key: 'accounts'; chartId: string }
  | { key: 'accountDirectory' }
  | { key: 'taxCodes'; chartId: string }
  | { key: 'fiscalYears' }
  | { key: 'closePreview'; fiscalYearId: string; dto: AccountingCloseYearDto }
  | { key: 'fxRates'; params?: AccountingFxRateParams }
  | { key: 'postingIssues'; includeResolved?: boolean; limit?: number; offset?: number }
  | { key: 'journal'; params: AccountingJournalListParams }
  | { key: 'journalStatistics'; range: AccountingDateRange }
  | { key: 'entry'; entryId: string }
  | { key: 'byLink'; linkType: AccountingLinkType; targetId: string }
  | { key: 'trialBalance'; range: AccountingDateRange }
  | { key: 'ledger'; params: AccountingLedgerParams }
  | { key: 'openItems'; type: AccountingCounterpartyType; asOf?: string }
  | { key: 'statement'; params: AccountingStatementParams }
  | { key: 'vatDefinitions' }
  | { key: 'vatReturns'; params?: AccountingVatReturnListParams }
  | { key: 'vatStatistics' }
  | { key: 'vatReturn'; id: string }
  | { key: 'financialAccounts' }
  | { key: 'imports'; limit?: number; offset?: number }
  | { key: 'importDetail'; id: string }
  | { key: 'transactions'; params: AccountingBankTransactionParams }
  | { key: 'bankStatistics'; range: AccountingDateRange }
  | { key: 'suggestions'; transactionId: string }
  | { key: 'csvPresets' }
  | { key: 'csvMappings' }
  | { key: 'matchRules' }
  | { key: 'assets'; params?: AccountingFixedAssetParams }
  | { key: 'asset'; id: string }
  | { key: 'assetSchedule'; range: AccountingDateRange };

/** Resources whose API accepts `viewTenantId` (reloaded when the viewed tenant changes). */
export const ACCOUNTING_TENANT_SCOPED_RESOURCES: readonly AccountingResourceKey[] = [
  'overview',
  'journal',
  'journalStatistics',
  'entry',
  'byLink',
  'trialBalance',
  'ledger',
  'openItems',
  'statement',
  'financialAccounts',
  'imports',
  'transactions',
  'bankStatistics',
];

/** Writes; `kind` drives which resources reload afterwards. */
export type AccountingMutation =
  | { kind: 'createChart'; dto: CreateAccountingChartDto }
  | { kind: 'createAccount'; chartId: string; dto: AccountingAccountInput }
  | { kind: 'updateAccount'; accountId: string; dto: Partial<AccountingAccountInput> }
  | { kind: 'deleteAccount'; accountId: string }
  | { kind: 'importAccounts'; chartId: string; file: File }
  | { kind: 'createTaxCode'; chartId: string; dto: AccountingTaxCodeInput }
  | { kind: 'updateTaxCode'; taxCodeId: string; dto: AccountingTaxCodeUpdate }
  | { kind: 'openFiscalYear'; dto: AccountingOpenFiscalYearDto }
  | { kind: 'changeFiscalYearChart'; fiscalYearId: string; chartId: string }
  | { kind: 'lockPeriod'; periodId: string }
  | { kind: 'closeFiscalYear'; fiscalYearId: string; dto: AccountingCloseYearDto }
  | { kind: 'setFxRate'; dto: AccountingFxRateInput }
  | { kind: 'fetchEcbRates' }
  | { kind: 'runCatchUp' }
  | { kind: 'createManualEntry'; dto: AccountingManualEntryInput }
  | { kind: 'reverseEntry'; entryId: string; dto: AccountingReverseEntryInput }
  | { kind: 'addLink'; entryId: string; dto: AccountingJournalLinkInput }
  | { kind: 'removeLink'; entryId: string; linkId: string }
  | { kind: 'attachReceipt'; entryId: string; file: File }
  | { kind: 'computeVatReturn'; dto: AccountingComputeVatReturnInput }
  | { kind: 'submitVatReturn'; id: string; dto: AccountingSubmitVatReturnInput }
  | { kind: 'payVatReturn'; id: string; dto: AccountingPayVatReturnInput }
  | { kind: 'saveFinancialAccount'; id?: string; dto: AccountingFinancialAccountInput }
  | { kind: 'uploadImport'; upload: AccountingBankImportUpload }
  | { kind: 'rollbackImport'; id: string }
  | { kind: 'matchTransaction'; transactionId: string; dto: AccountingMatchInput }
  | { kind: 'unmatchTransaction'; transactionId: string }
  | { kind: 'ignoreTransaction'; transactionId: string }
  | { kind: 'saveCsvMapping'; id?: string; dto: AccountingCsvMappingInput }
  | { kind: 'deleteCsvMapping'; id: string }
  | { kind: 'createMatchRule'; dto: AccountingMatchRuleInput }
  | { kind: 'deleteMatchRule'; id: string }
  | { kind: 'runProcessorSync' }
  | { kind: 'createAsset'; dto: AccountingFixedAssetInput }
  | { kind: 'runDepreciation'; through: string }
  | { kind: 'disposeAsset'; id: string; dto: AccountingDisposeAssetInput };

export type AccountingMutationKind = AccountingMutation['kind'];

/** Typed results of mutations whose response the UI shows (others: `unknown`). */
export interface AccountingMutationResultMap {
  importAccounts: AccountingAccountImportResult;
  runCatchUp: AccountingCatchUpResult;
  fetchEcbRates: { stored: number };
  runDepreciation: AccountingDepreciationRunResult;
}

// ---- Reads ----

export const loadAccountingResource = createAction(
  '[Accounting] Load Resource',
  props<{ request: AccountingRequest; silent?: boolean }>(),
);
export const loadAccountingResourceSuccess = createAction(
  '[Accounting] Load Resource Success',
  props<{ key: AccountingResourceKey; data: unknown }>(),
);
export const loadAccountingResourceFailure = createAction(
  '[Accounting] Load Resource Failure',
  props<{ key: AccountingResourceKey; error: string }>(),
);
export const clearAccountingResource = createAction(
  '[Accounting] Clear Resource',
  props<{ key: AccountingResourceKey }>(),
);

/** Viewed tenant of tenant-scoped resources (`null` = own tenant, `all` = every tenant). */
export const setAccountingViewTenant = createAction(
  '[Accounting] Set View Tenant',
  props<{ viewTenantId: string | null }>(),
);

/** Re-requests the last request of the given (loaded) resources. */
export const reloadAccountingResources = createAction(
  '[Accounting] Reload Resources',
  props<{ keys: readonly AccountingResourceKey[] }>(),
);

// ---- Writes ----

export const runAccountingMutation = createAction(
  '[Accounting] Run Mutation',
  props<{ mutation: AccountingMutation }>(),
);
export const runAccountingMutationSuccess = createAction(
  '[Accounting] Run Mutation Success',
  props<{ kind: AccountingMutationKind; result: unknown }>(),
);
export const runAccountingMutationFailure = createAction(
  '[Accounting] Run Mutation Failure',
  props<{ kind: AccountingMutationKind; error: string }>(),
);
export const clearAccountingMutation = createAction('[Accounting] Clear Mutation');
