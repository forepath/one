import { createFeatureSelector, createSelector, type MemoizedSelector } from '@ngrx/store';

import type { AccountingFiscalYear } from '../../types/accounting.types';

import type { AccountingResourceKey, AccountingResourceMap } from './accounting.actions';
import type { AccountingResource, AccountingState } from './accounting.reducer';

export const selectAccountingState = createFeatureSelector<AccountingState>('accounting');

export const selectAccountingViewTenantId = createSelector(selectAccountingState, (state) => state.viewTenantId);
export const selectAccountingResources = createSelector(selectAccountingState, (state) => state.resources);
export const selectAccountingMutating = createSelector(selectAccountingState, (state) => state.mutating);
export const selectAccountingMutationKind = createSelector(selectAccountingState, (state) => state.mutationKind);
export const selectAccountingMutationError = createSelector(selectAccountingState, (state) => state.mutationError);
export const selectAccountingLastMutation = createSelector(selectAccountingState, (state) => state.lastMutation);

const EMPTY_RESOURCE: AccountingResource<never> = Object.freeze({
  data: null,
  loading: false,
  error: null,
  loaded: false,
}) as AccountingResource<never>;
const resourceSelectors = new Map<AccountingResourceKey, MemoizedSelector<object, AccountingResource<unknown>>>();

/** Memoized selector of one resource slice (an empty slice until first requested). */
export function selectAccountingResource<K extends AccountingResourceKey>(
  key: K,
): MemoizedSelector<object, AccountingResource<AccountingResourceMap[K]>> {
  let selector = resourceSelectors.get(key);

  if (!selector) {
    selector = createSelector(
      selectAccountingResources,
      (resources) => (resources[key] as AccountingResource<unknown> | undefined) ?? EMPTY_RESOURCE,
    );
    resourceSelectors.set(key, selector);
  }

  return selector as MemoizedSelector<object, AccountingResource<AccountingResourceMap[K]>>;
}

/** Account id → account (journal line labels). */
export const selectAccountingAccountIndex = createSelector(
  selectAccountingResource('accountDirectory'),
  selectAccountingResource('accounts'),
  (directory, accounts) => {
    const index = new Map<string, { number: string; name: string }>();

    for (const account of [...(directory.data ?? []), ...(accounts.data ?? [])]) {
      index.set(account.id, { number: account.number, name: account.name });
    }

    return index;
  },
);

/** The open fiscal year containing today, else the latest one. */
export const selectAccountingCurrentFiscalYear = createSelector(
  selectAccountingResource('overview'),
  (overview): AccountingFiscalYear | null => {
    const years = overview.data?.fiscalYears ?? [];
    const today = new Date().toISOString().slice(0, 10);

    return (
      years.find((y) => y.startDate <= today && y.endDate >= today) ??
      [...years].sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ??
      null
    );
  },
);
