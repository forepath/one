import { createReducer, on } from '@ngrx/store';

import type { AdminDatevExportListItem, DatevExportScope, QueuedDatevExport } from '../../types/billing.types';

import {
  downloadDatevExport,
  downloadDatevExportFailure,
  downloadDatevExportSuccess,
  expireQueuedDatevExports,
  loadAdminDatevExports,
  loadAdminDatevExportsBatch,
  loadAdminDatevExportsFailure,
  loadAdminDatevExportsSuccess,
  triggerDatevExport,
  triggerDatevExportFailure,
  triggerDatevExportSuccess,
} from './admin-datev-exports.actions';

export interface AdminDatevExportsState {
  items: AdminDatevExportListItem[];
  queuedExports: QueuedDatevExport[];
  total: number;
  limit: number;
  offset: number;
  scope: DatevExportScope;
  loading: boolean;
  error: string | null;
  triggerLoading: boolean;
  triggerError: string | null;
  downloadLoading: boolean;
}

export const initialAdminDatevExportsState: AdminDatevExportsState = {
  items: [],
  queuedExports: [],
  total: 0,
  limit: 20,
  offset: 0,
  scope: 'tenant',
  loading: false,
  error: null,
  triggerLoading: false,
  triggerError: null,
  downloadLoading: false,
};

function matchesDatevExportPeriod(
  scope: DatevExportScope,
  periodYear: number,
  periodMonth: number,
  candidate: { scope: DatevExportScope; periodYear: number; periodMonth: number },
): boolean {
  return candidate.scope === scope && candidate.periodYear === periodYear && candidate.periodMonth === periodMonth;
}

function pruneResolvedQueuedExports(
  queuedExports: QueuedDatevExport[],
  items: AdminDatevExportListItem[],
  loadedScope: DatevExportScope,
): QueuedDatevExport[] {
  return queuedExports.filter((queued) => {
    if (queued.scope !== loadedScope) {
      return true;
    }

    return !items.some((item) => matchesDatevExportPeriod(queued.scope, queued.periodYear, queued.periodMonth, item));
  });
}

export const adminDatevExportsReducer = createReducer(
  initialAdminDatevExportsState,
  on(loadAdminDatevExports, (state, { params, preserveScope }) => {
    const nextScope = preserveScope ? state.scope : (params.scope ?? state.scope);
    const scopeChanged = !preserveScope && nextScope !== state.scope;

    return {
      ...state,
      items: scopeChanged ? [] : state.items,
      loading: true,
      error: null,
      scope: nextScope,
    };
  }),
  on(loadAdminDatevExportsBatch, (state, { accumulatedItems }) => ({
    ...state,
    items: accumulatedItems,
    loading: true,
  })),
  on(loadAdminDatevExportsSuccess, (state, { items, total, limit, offset, loadedScope }) => ({
    ...state,
    items: loadedScope === state.scope ? items : state.items,
    total: loadedScope === state.scope ? total : state.total,
    limit: loadedScope === state.scope ? limit : state.limit,
    offset: loadedScope === state.scope ? offset : state.offset,
    loading: false,
    queuedExports: pruneResolvedQueuedExports(state.queuedExports, items, loadedScope),
  })),
  on(loadAdminDatevExportsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(triggerDatevExport, (state) => ({ ...state, triggerLoading: true, triggerError: null })),
  on(triggerDatevExportSuccess, (state, { result, queuedAt }) => {
    if (!result.queued) {
      return { ...state, triggerLoading: false };
    }

    const alreadyTracked =
      state.queuedExports.some((queued) => matchesDatevExportPeriod(result.scope, result.year, result.month, queued)) ||
      state.items.some((item) => matchesDatevExportPeriod(result.scope, result.year, result.month, item));

    if (alreadyTracked) {
      return { ...state, triggerLoading: false };
    }

    const queuedExport: QueuedDatevExport = {
      clientId: `${result.scope}-${result.year}-${result.month}-${state.queuedExports.length}`,
      scope: result.scope,
      periodYear: result.year,
      periodMonth: result.month,
      queuedAt,
    };

    return {
      ...state,
      triggerLoading: false,
      queuedExports: [...state.queuedExports, queuedExport],
    };
  }),
  on(triggerDatevExportFailure, (state, { error }) => ({
    ...state,
    triggerLoading: false,
    triggerError: error,
  })),
  on(expireQueuedDatevExports, (state) => ({
    ...state,
    queuedExports: [],
    error:
      state.queuedExports.length > 0
        ? 'DATEV export did not appear within the expected time. Check export configuration and worker logs.'
        : state.error,
  })),
  on(downloadDatevExport, (state) => ({ ...state, downloadLoading: true })),
  on(downloadDatevExportSuccess, (state) => ({ ...state, downloadLoading: false })),
  on(downloadDatevExportFailure, (state, { error }) => ({
    ...state,
    downloadLoading: false,
    error,
  })),
);
