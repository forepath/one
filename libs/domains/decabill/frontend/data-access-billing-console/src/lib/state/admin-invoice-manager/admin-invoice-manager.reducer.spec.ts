import {
  adminInvoiceManagerMarkPaid,
  adminInvoiceManagerMarkPaidFailure,
  adminInvoiceManagerMarkPaidSuccess,
  adminInvoiceManagerMarkUnpaid,
  adminInvoiceManagerMarkUnpaidFailure,
  adminInvoiceManagerMarkUnpaidSuccess,
  adminInvoiceManagerVoid,
  adminInvoiceManagerVoidFailure,
  adminInvoiceManagerVoidSuccess,
  createManualInvoice,
  createManualInvoiceFailure,
  createManualInvoiceSuccess,
  deleteManualInvoice,
  deleteManualInvoiceFailure,
  deleteManualInvoiceSuccess,
  issueManualInvoice,
  issueManualInvoiceFailure,
  issueManualInvoiceSuccess,
  loadAdminInvoiceManager,
  loadAdminInvoiceManagerBatch,
  loadAdminInvoiceManagerFailure,
  loadAdminInvoiceManagerSuccess,
  updateManualInvoice,
  updateManualInvoiceFailure,
  updateManualInvoiceSuccess,
} from './admin-invoice-manager.actions';
import { adminInvoiceManagerReducer, initialAdminInvoiceManagerState } from './admin-invoice-manager.reducer';

describe('adminInvoiceManagerReducer', () => {
  const listItem = {
    id: 'inv-1',
    userId: 'user-1',
    status: 'draft',
    createdAt: '2024-01-01',
    canPay: false,
    canDownload: false,
    canPreview: false,
  };
  const detail = {
    id: 'inv-1',
    userId: 'user-1',
    status: 'issued',
    invoiceNumber: 'INV-2026-00001',
    balanceDue: 119,
    createdAt: '2024-01-01',
    dueDate: '2024-01-15',
    canPay: true,
    canDownload: true,
    canPreview: true,
  };

  it('sets loading on loadAdminInvoiceManager', () => {
    const state = adminInvoiceManagerReducer(initialAdminInvoiceManagerState, loadAdminInvoiceManager());

    expect(state.loading).toBe(true);
    expect(state.invoices).toEqual([]);
  });

  it('stores accumulated invoices on batch', () => {
    const state = adminInvoiceManagerReducer(
      initialAdminInvoiceManagerState,
      loadAdminInvoiceManagerBatch({ offset: 10, accumulatedInvoices: [listItem] }),
    );

    expect(state.invoices).toEqual([listItem]);
    expect(state.loading).toBe(true);
  });

  it('stores invoices on success', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, loading: true },
      loadAdminInvoiceManagerSuccess({ invoices: [listItem] }),
    );

    expect(state.loading).toBe(false);
    expect(state.invoices).toEqual([listItem]);
  });

  it('stores error on load failure', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, loading: true },
      loadAdminInvoiceManagerFailure({ error: 'Load failed' }),
    );

    expect(state.loading).toBe(false);
    expect(state.error).toBe('Load failed');
  });

  it('upserts invoice on create success', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, creating: true },
      createManualInvoiceSuccess({ invoice: detail as never }),
    );

    expect(state.creating).toBe(false);
    expect(state.invoices[0].status).toBe('issued');
    expect(state.invoices[0].invoiceNumber).toBe('INV-2026-00001');
  });

  it('stores error on create failure', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, creating: true },
      createManualInvoiceFailure({ error: 'Create failed' }),
    );

    expect(state.creating).toBe(false);
    expect(state.error).toBe('Create failed');
  });

  it('upserts invoice on update success', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, invoices: [listItem], updating: true },
      updateManualInvoiceSuccess({ invoice: detail as never }),
    );

    expect(state.updating).toBe(false);
    expect(state.invoices[0].status).toBe('issued');
  });

  it('stores error on update failure', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, updating: true },
      updateManualInvoiceFailure({ error: 'Update failed' }),
    );

    expect(state.updating).toBe(false);
    expect(state.error).toBe('Update failed');
  });

  it('upserts invoice on issue success', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, invoices: [listItem], issuing: true },
      issueManualInvoiceSuccess({ invoice: detail as never }),
    );

    expect(state.issuing).toBe(false);
    expect(state.invoices[0].status).toBe('issued');
  });

  it('stores error on issue failure', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, issuing: true },
      issueManualInvoiceFailure({ error: 'Issue failed' }),
    );

    expect(state.issuing).toBe(false);
    expect(state.error).toBe('Issue failed');
  });

  it('removes invoice on delete success', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, invoices: [listItem], deleting: true },
      deleteManualInvoiceSuccess({ invoiceRefId: 'inv-1' }),
    );

    expect(state.deleting).toBe(false);
    expect(state.invoices).toEqual([]);
  });

  it('stores error on delete failure', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, deleting: true },
      deleteManualInvoiceFailure({ error: 'Delete failed' }),
    );

    expect(state.deleting).toBe(false);
    expect(state.error).toBe('Delete failed');
  });

  it('sets actionLoading on void', () => {
    const state = adminInvoiceManagerReducer(
      initialAdminInvoiceManagerState,
      adminInvoiceManagerVoid({ invoiceRefId: 'inv-1' }),
    );

    expect(state.actionLoading).toBe(true);
  });

  it('upserts invoice on void success', () => {
    const voided = { ...listItem, status: 'void' };
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, invoices: [listItem], actionLoading: true },
      adminInvoiceManagerVoidSuccess({ invoice: voided }),
    );

    expect(state.actionLoading).toBe(false);
    expect(state.invoices[0].status).toBe('void');
  });

  it('stores error on void failure', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, actionLoading: true },
      adminInvoiceManagerVoidFailure({ error: 'Void failed' }),
    );

    expect(state.actionLoading).toBe(false);
    expect(state.error).toBe('Void failed');
  });

  it('upserts invoice on mark paid success', () => {
    const paid = { ...listItem, status: 'paid' };
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, invoices: [listItem], actionLoading: true },
      adminInvoiceManagerMarkPaidSuccess({ invoice: paid }),
    );

    expect(state.invoices[0].status).toBe('paid');
  });

  it('stores error on mark unpaid failure', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, actionLoading: true },
      adminInvoiceManagerMarkUnpaidFailure({ error: 'Mark unpaid failed' }),
    );

    expect(state.error).toBe('Mark unpaid failed');
  });

  it('sets actionLoading on mark paid and mark unpaid', () => {
    expect(
      adminInvoiceManagerReducer(
        initialAdminInvoiceManagerState,
        adminInvoiceManagerMarkPaid({ invoiceRefId: 'inv-1' }),
      ).actionLoading,
    ).toBe(true);
    expect(
      adminInvoiceManagerReducer(
        initialAdminInvoiceManagerState,
        adminInvoiceManagerMarkUnpaid({ invoiceRefId: 'inv-1' }),
      ).actionLoading,
    ).toBe(true);
  });

  it('sets creating on createManualInvoice', () => {
    const state = adminInvoiceManagerReducer(
      initialAdminInvoiceManagerState,
      createManualInvoice({
        dto: {
          userId: 'user-1',
          lineItems: [{ description: 'Line', quantity: 1, unitPriceNet: 10, taxCategory: 'standard' }],
        },
      }),
    );

    expect(state.creating).toBe(true);
  });
});
