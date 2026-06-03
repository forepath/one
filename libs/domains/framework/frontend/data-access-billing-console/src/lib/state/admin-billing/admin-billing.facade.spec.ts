import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import { billNow, loadAdminBillingSummary, loadAdminOpenOverdue } from './admin-billing.actions';
import { AdminBillingFacade } from './admin-billing.facade';

describe('AdminBillingFacade', () => {
  let facade: AdminBillingFacade;
  let store: jest.Mocked<Store>;

  beforeEach(() => {
    store = { select: jest.fn().mockReturnValue(of(null)), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [AdminBillingFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(AdminBillingFacade);
  });

  it('dispatches loadSummary', () => {
    facade.loadSummary();

    expect(store.dispatch).toHaveBeenCalledWith(loadAdminBillingSummary());
  });

  it('dispatches billNow', () => {
    facade.billNow({ userId: 'user-1' });

    expect(store.dispatch).toHaveBeenCalledWith(billNow({ dto: { userId: 'user-1' } }));
  });

  it('dispatches loadOpenOverdue with params', () => {
    facade.loadOpenOverdue({ limit: 10, offset: 0 });

    expect(store.dispatch).toHaveBeenCalledWith(loadAdminOpenOverdue({ params: { limit: 10, offset: 0 } }));
  });
});
