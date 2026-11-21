import type { AccountingAccount, AccountingOverview } from '../../types/accounting.types';

import { initialAccountingState, type AccountingState } from './accounting.reducer';
import {
  selectAccountingAccountIndex,
  selectAccountingCurrentFiscalYear,
  selectAccountingMutating,
  selectAccountingResource,
  selectAccountingViewTenantId,
} from './accounting.selectors';

describe('Accounting selectors', () => {
  const root = (overrides: Partial<AccountingState> = {}) => ({
    accounting: { ...initialAccountingState, ...overrides },
  });
  const account = (id: string, number: string): AccountingAccount =>
    ({ id, number, name: `Account ${number}` }) as AccountingAccount;

  it('selects plain state fields', () => {
    const state = root({ viewTenantId: 'all', mutating: true });

    expect(selectAccountingViewTenantId(state)).toBe('all');
    expect(selectAccountingMutating(state)).toBe(true);
  });

  it('returns an empty slice for resources never requested', () => {
    expect(selectAccountingResource('journal')(root())).toEqual({
      data: null,
      loading: false,
      error: null,
      loaded: false,
    });
  });

  it('memoizes one selector per resource key', () => {
    expect(selectAccountingResource('charts')).toBe(selectAccountingResource('charts'));
  });

  it('indexes accounts of the directory and the open chart by id', () => {
    const state = root({
      resources: {
        accountDirectory: { data: [account('a1', '1200')], loading: false, error: null, loaded: true },
        accounts: { data: [account('a2', '8400')], loading: false, error: null, loaded: true },
      },
    });
    const index = selectAccountingAccountIndex(state);

    expect(index.get('a1')?.number).toBe('1200');
    expect(index.get('a2')?.name).toBe('Account 8400');
  });

  it('picks the fiscal year containing today, else the latest', () => {
    const year = new Date().getUTCFullYear();
    const overview = {
      fiscalYears: [
        { id: 'old', startDate: '2001-01-01', endDate: '2001-12-31' },
        { id: 'now', startDate: `${year}-01-01`, endDate: `${year}-12-31` },
      ],
    } as unknown as AccountingOverview;
    const state = root({ resources: { overview: { data: overview, loading: false, error: null, loaded: true } } });

    expect(selectAccountingCurrentFiscalYear(state)?.id).toBe('now');
  });
});
