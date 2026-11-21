import type { AccountingJournalEntry, AccountingVatReturn } from '../../types/accounting.types';

import {
  clearAccountingResource,
  loadAccountingResource,
  loadAccountingResourceFailure,
  loadAccountingResourceSuccess,
  runAccountingMutation,
  runAccountingMutationFailure,
  runAccountingMutationSuccess,
  setAccountingViewTenant,
} from './accounting.actions';
import {
  ACCOUNTING_MUTATION_RELOADS,
  accountingReducer,
  initialAccountingState,
  type AccountingState,
} from './accounting.reducer';

const entry = (id: string): AccountingJournalEntry =>
  ({ id, entryNumber: 1, lines: [] }) as unknown as AccountingJournalEntry;

describe('accountingReducer', () => {
  it('stores the request and marks the resource loading', () => {
    const state = accountingReducer(
      initialAccountingState,
      loadAccountingResource({ request: { key: 'journal', params: { limit: 25, offset: 0 } } }),
    );

    expect(state.requests.journal).toEqual({ key: 'journal', params: { limit: 25, offset: 0 } });
    expect(state.resources.journal).toEqual({ data: null, loading: true, error: null, loaded: false });
  });

  it('keeps list data while a new page loads but clears a detail of another record', () => {
    let state = accountingReducer(
      initialAccountingState,
      loadAccountingResource({ request: { key: 'entry', entryId: 'e1' } }),
    );

    state = accountingReducer(state, loadAccountingResourceSuccess({ key: 'entry', data: entry('e1') }));
    state = accountingReducer(state, loadAccountingResource({ request: { key: 'entry', entryId: 'e1' } }));
    expect(state.resources.entry?.data?.id).toBe('e1');

    state = accountingReducer(state, loadAccountingResource({ request: { key: 'entry', entryId: 'e2' } }));
    expect(state.resources.entry?.data).toBeNull();
    expect(state.resources.entry?.loading).toBe(true);
  });

  it('silent reloads keep the loading flag off', () => {
    let state = accountingReducer(initialAccountingState, loadAccountingResource({ request: { key: 'charts' } }));

    state = accountingReducer(state, loadAccountingResourceSuccess({ key: 'charts', data: [] }));
    state = accountingReducer(state, loadAccountingResource({ request: { key: 'charts' }, silent: true }));

    expect(state.resources.charts?.loading).toBe(false);
    expect(state.resources.charts?.loaded).toBe(true);
  });

  it('records load failures per resource', () => {
    const state = accountingReducer(
      initialAccountingState,
      loadAccountingResourceFailure({ key: 'overview', error: 'Accounting disabled' }),
    );

    expect(state.resources.overview).toEqual({
      data: null,
      loading: false,
      error: 'Accounting disabled',
      loaded: true,
    });
  });

  it('clears a resource with its request', () => {
    let state = accountingReducer(initialAccountingState, loadAccountingResource({ request: { key: 'charts' } }));

    state = accountingReducer(state, clearAccountingResource({ key: 'charts' }));

    expect(state.resources.charts).toBeUndefined();
    expect(state.requests.charts).toBeUndefined();
  });

  it('normalizes the viewed tenant', () => {
    expect(
      accountingReducer(initialAccountingState, setAccountingViewTenant({ viewTenantId: ' ' })).viewTenantId,
    ).toBeNull();
    expect(
      accountingReducer(initialAccountingState, setAccountingViewTenant({ viewTenantId: 'all' })).viewTenantId,
    ).toBe('all');
  });

  it('tracks the mutation lifecycle', () => {
    let state: AccountingState = accountingReducer(
      initialAccountingState,
      runAccountingMutation({ mutation: { kind: 'lockPeriod', periodId: 'p1' } }),
    );

    expect(state.mutating).toBe(true);
    expect(state.mutationKind).toBe('lockPeriod');

    state = accountingReducer(state, runAccountingMutationFailure({ kind: 'lockPeriod', error: 'Locked' }));
    expect(state.mutating).toBe(false);
    expect(state.mutationError).toBe('Locked');
  });

  it('shows the returned record of result mutations and re-targets its request', () => {
    const vatReturn = { id: 'v1', status: 'draft', figures: {} } as unknown as AccountingVatReturn;
    const state = accountingReducer(
      initialAccountingState,
      runAccountingMutationSuccess({ kind: 'computeVatReturn', result: vatReturn }),
    );

    expect(state.resources.vatReturn?.data).toBe(vatReturn);
    expect(state.requests.vatReturn).toEqual({ key: 'vatReturn', id: 'v1' });
    expect(state.lastMutation).toEqual({ kind: 'computeVatReturn', result: vatReturn });
  });

  it('declares reloads for every mutation kind', () => {
    expect(ACCOUNTING_MUTATION_RELOADS.matchTransaction).toContain('transactions');
    expect(ACCOUNTING_MUTATION_RELOADS.lockPeriod).toContain('fiscalYears');
  });
});
