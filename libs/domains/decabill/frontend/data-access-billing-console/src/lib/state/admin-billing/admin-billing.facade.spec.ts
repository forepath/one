import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  adminMarkPaid,
  adminMarkUnpaid,
  adminVoidInvoice,
  billNow,
  loadAdminAuditLogs,
  loadAdminBillingSummary,
  loadAdminOpenOverdue,
  loadAdminStatisticsByCountry,
  loadAdminStatisticsByProduct,
  loadAdminStatisticsSummary,
} from './admin-billing.actions';
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

  it('dispatches voidInvoice', () => {
    facade.voidInvoice('inv-1');

    expect(store.dispatch).toHaveBeenCalledWith(adminVoidInvoice({ invoiceRefId: 'inv-1' }));
  });

  it('dispatches markPaid', () => {
    facade.markPaid('inv-1', { reason: 'manual' });

    expect(store.dispatch).toHaveBeenCalledWith(adminMarkPaid({ invoiceRefId: 'inv-1', dto: { reason: 'manual' } }));
  });

  it('dispatches markUnpaid', () => {
    facade.markUnpaid('inv-1');

    expect(store.dispatch).toHaveBeenCalledWith(adminMarkUnpaid({ invoiceRefId: 'inv-1', dto: undefined }));
  });

  it('dispatches loadStatisticsSummary', () => {
    facade.loadStatisticsSummary({ from: '2024-01-01', to: '2024-01-31', groupBy: 'day' });

    expect(store.dispatch).toHaveBeenCalledWith(
      loadAdminStatisticsSummary({ params: { from: '2024-01-01', to: '2024-01-31', groupBy: 'day' } }),
    );
  });

  it('dispatches loadStatisticsByProduct', () => {
    facade.loadStatisticsByProduct({ from: '2024-01-01', to: '2024-01-31' });

    expect(store.dispatch).toHaveBeenCalledWith(
      loadAdminStatisticsByProduct({ params: { from: '2024-01-01', to: '2024-01-31' } }),
    );
  });

  it('dispatches loadStatisticsByCountry', () => {
    facade.loadStatisticsByCountry({ from: '2024-01-01', to: '2024-01-31' });

    expect(store.dispatch).toHaveBeenCalledWith(
      loadAdminStatisticsByCountry({ params: { from: '2024-01-01', to: '2024-01-31' } }),
    );
  });

  it('dispatches loadAuditLogs', () => {
    facade.loadAuditLogs('inv-1', 20, 0);

    expect(store.dispatch).toHaveBeenCalledWith(loadAdminAuditLogs({ invoiceRefId: 'inv-1', limit: 20, offset: 0 }));
  });
});
