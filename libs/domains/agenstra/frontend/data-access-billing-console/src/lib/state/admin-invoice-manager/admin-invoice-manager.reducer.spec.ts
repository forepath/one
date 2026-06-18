import { loadAdminInvoiceManager, loadAdminInvoiceManagerSuccess } from './admin-invoice-manager.actions';
import { adminInvoiceManagerReducer, initialAdminInvoiceManagerState } from './admin-invoice-manager.reducer';

describe('adminInvoiceManagerReducer', () => {
  it('sets loading on loadAdminInvoiceManager', () => {
    const state = adminInvoiceManagerReducer(initialAdminInvoiceManagerState, loadAdminInvoiceManager());

    expect(state.loading).toBe(true);
    expect(state.invoices).toEqual([]);
  });

  it('stores invoices on success', () => {
    const invoices = [
      {
        id: 'inv-1',
        userId: 'user-1',
        createdAt: '2024-01-01',
        canPay: false,
        canDownload: false,
        canPreview: false,
      },
    ];
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, loading: true },
      loadAdminInvoiceManagerSuccess({ invoices }),
    );

    expect(state.loading).toBe(false);
    expect(state.invoices).toEqual(invoices);
  });
});
