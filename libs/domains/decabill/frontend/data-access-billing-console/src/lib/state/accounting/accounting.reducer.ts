import { createReducer, on } from '@ngrx/store';

import {
  type AccountingMutationKind,
  type AccountingRequest,
  type AccountingResourceKey,
  type AccountingResourceMap,
  clearAccountingMutation,
  clearAccountingResource,
  loadAccountingResource,
  loadAccountingResourceFailure,
  loadAccountingResourceSuccess,
  runAccountingMutation,
  runAccountingMutationFailure,
  runAccountingMutationSuccess,
  setAccountingViewTenant,
} from './accounting.actions';

/** One resource slice: the last response of its request (replace, never accumulated). */
export interface AccountingResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  loaded: boolean;
}

export type AccountingResources = { [K in AccountingResourceKey]?: AccountingResource<AccountingResourceMap[K]> };

export interface AccountingState {
  /** `null` = own tenant; a tenant id or `all` (global views only). */
  viewTenantId: string | null;
  resources: AccountingResources;
  /** Last request per resource (re-run after mutations and tenant switches). */
  requests: { [K in AccountingResourceKey]?: AccountingRequest };
  mutating: boolean;
  mutationKind: AccountingMutationKind | null;
  mutationError: string | null;
  lastMutation: { kind: AccountingMutationKind; result: unknown } | null;
}

export const initialAccountingState: AccountingState = {
  viewTenantId: null,
  resources: {},
  requests: {},
  mutating: false,
  mutationKind: null,
  mutationError: null,
  lastMutation: null,
};

/** Single-record resources: a request for another record starts empty (no stale detail of the previous one). */
const DETAIL_RESOURCES: readonly AccountingResourceKey[] = [
  'entry',
  'byLink',
  'ledger',
  'closePreview',
  'vatReturn',
  'importDetail',
  'suggestions',
  'asset',
  'accounts',
  'taxCodes',
];

/** Mutations whose response replaces a resource right away (before the reloads arrive). */
export const ACCOUNTING_MUTATION_RESULT_RESOURCE: Partial<Record<AccountingMutationKind, AccountingResourceKey>> = {
  createManualEntry: 'entry',
  computeVatReturn: 'vatReturn',
  submitVatReturn: 'vatReturn',
  payVatReturn: 'vatReturn',
  uploadImport: 'importDetail',
  rollbackImport: 'importDetail',
};

/** Resources to re-request after a successful mutation (only those loaded before). */
export const ACCOUNTING_MUTATION_RELOADS: Record<AccountingMutationKind, readonly AccountingResourceKey[]> = {
  createChart: ['charts', 'accountDirectory', 'overview'],
  createAccount: ['accounts', 'accountDirectory'],
  updateAccount: ['accounts', 'accountDirectory'],
  deleteAccount: ['accounts', 'accountDirectory'],
  importAccounts: ['accounts', 'accountDirectory'],
  createTaxCode: ['taxCodes'],
  updateTaxCode: ['taxCodes'],
  openFiscalYear: ['fiscalYears', 'overview'],
  changeFiscalYearChart: ['fiscalYears', 'overview'],
  lockPeriod: ['fiscalYears', 'overview'],
  closeFiscalYear: ['fiscalYears', 'overview', 'journal', 'trialBalance'],
  setFxRate: ['fxRates'],
  fetchEcbRates: ['fxRates'],
  runCatchUp: ['postingIssues', 'overview', 'journal', 'journalStatistics'],
  createManualEntry: ['journal', 'journalStatistics', 'byLink', 'trialBalance'],
  reverseEntry: ['journal', 'journalStatistics', 'entry', 'byLink', 'trialBalance'],
  addLink: ['entry', 'byLink'],
  removeLink: ['entry', 'byLink'],
  attachReceipt: ['entry'],
  computeVatReturn: ['vatReturns', 'vatStatistics'],
  submitVatReturn: ['vatReturns', 'vatStatistics', 'fiscalYears', 'overview'],
  payVatReturn: ['vatReturns', 'vatStatistics', 'journal'],
  saveFinancialAccount: ['financialAccounts', 'bankStatistics'],
  uploadImport: ['imports', 'transactions', 'bankStatistics', 'financialAccounts'],
  rollbackImport: ['imports', 'transactions', 'bankStatistics', 'financialAccounts'],
  matchTransaction: ['transactions', 'bankStatistics', 'matchRules', 'suggestions'],
  unmatchTransaction: ['transactions', 'bankStatistics'],
  ignoreTransaction: ['transactions', 'bankStatistics'],
  saveCsvMapping: ['csvMappings'],
  deleteCsvMapping: ['csvMappings'],
  createMatchRule: ['matchRules'],
  deleteMatchRule: ['matchRules'],
  runProcessorSync: ['transactions', 'imports', 'bankStatistics', 'financialAccounts'],
  createAsset: ['assets', 'assetSchedule'],
  runDepreciation: ['assets', 'asset', 'assetSchedule', 'journal'],
  disposeAsset: ['assets', 'asset', 'assetSchedule'],
};

function emptyResource<T>(): AccountingResource<T> {
  return { data: null, loading: false, error: null, loaded: false };
}

function sameRequest(a: AccountingRequest | undefined, b: AccountingRequest): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

function patchResource(
  state: AccountingState,
  key: AccountingResourceKey,
  patch: Partial<AccountingResource<unknown>>,
): AccountingResources {
  const current = (state.resources[key] as AccountingResource<unknown> | undefined) ?? emptyResource();

  return { ...state.resources, [key]: { ...current, ...patch } };
}

/** Request that loads the record a mutation returned (by its `id`). */
function resultRequest(key: AccountingResourceKey, result: unknown): AccountingRequest | null {
  const id = result && typeof result === 'object' ? (result as { id?: unknown }).id : null;

  if (typeof id !== 'string' || !id) return null;

  if (key === 'entry') return { key, entryId: id };

  if (key === 'vatReturn' || key === 'importDetail') return { key, id };

  return null;
}

export const accountingReducer = createReducer(
  initialAccountingState,
  on(loadAccountingResource, (state, { request, silent }) => {
    const key = request.key;
    const stale = DETAIL_RESOURCES.includes(key) && !sameRequest(state.requests[key], request);
    const patch: Partial<AccountingResource<unknown>> = silent ? {} : { loading: true, error: null };

    return {
      ...state,
      requests: { ...state.requests, [key]: request },
      resources: patchResource(state, key, stale ? { ...patch, data: null, loaded: false } : patch),
    };
  }),
  on(loadAccountingResourceSuccess, (state, { key, data }) => ({
    ...state,
    resources: patchResource(state, key, { data, loading: false, error: null, loaded: true }),
  })),
  on(loadAccountingResourceFailure, (state, { key, error }) => ({
    ...state,
    resources: patchResource(state, key, { loading: false, error, loaded: true }),
  })),
  on(clearAccountingResource, (state, { key }) => {
    const resources = { ...state.resources };
    const requests = { ...state.requests };

    delete resources[key];
    delete requests[key];

    return { ...state, resources, requests };
  }),
  on(setAccountingViewTenant, (state, { viewTenantId }) => ({
    ...state,
    viewTenantId: viewTenantId?.trim() || null,
  })),
  on(runAccountingMutation, (state, { mutation }) => ({
    ...state,
    mutating: true,
    mutationKind: mutation.kind,
    mutationError: null,
  })),
  on(runAccountingMutationSuccess, (state, { kind, result }) => {
    const target = ACCOUNTING_MUTATION_RESULT_RESOURCE[kind];
    const request = target ? resultRequest(target, result) : null;

    if (!target || !request) {
      return { ...state, mutating: false, mutationError: null, lastMutation: { kind, result } };
    }

    return {
      ...state,
      mutating: false,
      mutationError: null,
      lastMutation: { kind, result },
      // The shown record follows the response (later reloads re-request it, not the previous one).
      requests: { ...state.requests, [target]: request },
      resources: patchResource(state, target, { data: result, loading: false, error: null, loaded: true }),
    };
  }),
  on(runAccountingMutationFailure, (state, { kind, error }) => ({
    ...state,
    mutating: false,
    mutationKind: kind,
    mutationError: error,
  })),
  on(clearAccountingMutation, (state) => ({
    ...state,
    mutationKind: null,
    mutationError: null,
    lastMutation: null,
  })),
);
