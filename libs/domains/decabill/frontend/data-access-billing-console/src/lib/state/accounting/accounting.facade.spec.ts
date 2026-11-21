import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import {
  clearAccountingMutation,
  clearAccountingResource,
  loadAccountingResource,
  runAccountingMutation,
  setAccountingViewTenant,
} from './accounting.actions';
import { AccountingFacade } from './accounting.facade';
import { initialAccountingState } from './accounting.reducer';

describe('AccountingFacade', () => {
  let facade: AccountingFacade;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AccountingFacade, provideMockStore({ initialState: { accounting: initialAccountingState } })],
    });
    facade = TestBed.inject(AccountingFacade);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('load dispatches loadAccountingResource', () => {
    facade.load({ key: 'trialBalance', range: { from: '2026-01-01', to: '2026-12-31' } });

    expect(store.dispatch).toHaveBeenCalledWith(
      loadAccountingResource({ request: { key: 'trialBalance', range: { from: '2026-01-01', to: '2026-12-31' } } }),
    );
  });

  it('mutate dispatches runAccountingMutation', () => {
    facade.mutate({ kind: 'runCatchUp' });

    expect(store.dispatch).toHaveBeenCalledWith(runAccountingMutation({ mutation: { kind: 'runCatchUp' } }));
  });

  it('clear, clearMutation and setViewTenant dispatch their actions', () => {
    facade.clear('entry');
    facade.clearMutation();
    facade.setViewTenant('all');

    expect(store.dispatch).toHaveBeenCalledWith(clearAccountingResource({ key: 'entry' }));
    expect(store.dispatch).toHaveBeenCalledWith(clearAccountingMutation());
    expect(store.dispatch).toHaveBeenCalledWith(setAccountingViewTenant({ viewTenantId: 'all' }));
  });

  it('exposes resource slices', (done) => {
    facade.overview$.subscribe((resource) => {
      expect(resource.data).toBeNull();
      expect(resource.loaded).toBe(false);
      done();
    });
  });
});
