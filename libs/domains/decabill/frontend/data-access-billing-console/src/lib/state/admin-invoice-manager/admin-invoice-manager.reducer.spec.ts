import {
  adminInvoiceManagerMarkPaid,
  adminInvoiceManagerMarkPaidSuccess,
  adminInvoiceManagerMarkUnpaid,
  adminInvoiceManagerMarkUnpaidFailure,
  adminInvoiceManagerRefund,
  adminInvoiceManagerRefundSuccess,
  adminInvoiceManagerSend,
  adminInvoiceManagerSendCreditNoteSuccess,
  adminInvoiceManagerSendFailure,
  adminInvoiceManagerSendSuccess,
  adminInvoiceManagerVoid,
  adminInvoiceManagerVoidFailure,
  adminInvoiceManagerVoidSuccess,
  adminInvoiceManagerWriteOff,
  adminInvoiceManagerWriteOffFailure,
  adminInvoiceManagerWriteOffSuccess,
  createManualInvoice,
  createManualInvoiceFailure,
  createManualInvoiceSuccess,
  deleteManualInvoiceFailure,
  deleteManualInvoiceSuccess,
  issueManualInvoiceFailure,
  issueManualInvoiceSuccess,
  loadAdminInvoiceManager,
  loadAdminInvoiceManagerFailure,
  loadAdminInvoiceManagerSuccess,
  loadAdminInvoiceSettlements,
  loadAdminInvoiceSettlementsFailure,
  loadAdminInvoiceSettlementsSuccess,
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
  const listItem2 = {
    ...listItem,
    id: 'inv-2',
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

  it('sets loading and the requested page on loadAdminInvoiceManager (keeps rows until the page arrives)', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, invoices: [listItem], total: 30 },
      loadAdminInvoiceManager({ search: ' inv ', page: 2, pageSize: 50 }),
    );

    expect(state.loading).toBe(true);
    expect(state.invoices).toEqual([listItem]);
    expect(state.page).toBe(2);
    expect(state.pageSize).toBe(50);
    expect(state.search).toBe('inv');
  });

  it('defaults to page 1 and keeps the page size', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, page: 3, pageSize: 100 },
      loadAdminInvoiceManager({}),
    );

    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(100);
  });

  it('replaces the rows with the loaded page and stores the total', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, invoices: [listItem], loading: true },
      loadAdminInvoiceManagerSuccess({ invoices: [listItem2], total: 26 }),
    );

    expect(state.loading).toBe(false);
    expect(state.invoices).toEqual([listItem2]);
    expect(state.total).toBe(26);
  });

  it('stores error on load failure', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, invoices: [listItem], total: 1, loading: true },
      loadAdminInvoiceManagerFailure({ error: 'Load failed' }),
    );

    expect(state.loading).toBe(false);
    expect(state.error).toBe('Load failed');
    expect(state.invoices).toEqual([]);
    expect(state.total).toBe(0);
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

  it('keeps the delivery state when a silently issued invoice is upserted from its detail', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, invoices: [listItem], issuing: true },
      issueManualInvoiceSuccess({ invoice: { ...detail, sentAt: null, canSend: true } as never }),
    );

    expect(state.invoices[0]).toEqual(
      expect.objectContaining({ sentAt: null, canSend: true, canSendCreditNote: false }),
    );
  });

  it('tracks send / send credit note like the other row actions', () => {
    const loading = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, invoices: [{ ...listItem, canSend: true }] },
      adminInvoiceManagerSend({ invoiceRefId: 'inv-1' }),
    );

    expect(loading.actionLoading).toBe(true);

    const sent = adminInvoiceManagerReducer(
      loading,
      adminInvoiceManagerSendSuccess({ invoice: { ...listItem, canSend: false, sentAt: '2026-11-21' } as never }),
    );

    expect(sent.actionLoading).toBe(false);
    expect(sent.invoices[0]).toEqual(expect.objectContaining({ canSend: false }));

    const creditSent = adminInvoiceManagerReducer(
      loading,
      adminInvoiceManagerSendCreditNoteSuccess({ invoice: { ...listItem, canSendCreditNote: false } as never }),
    );

    expect(creditSent.actionLoading).toBe(false);

    const failed = adminInvoiceManagerReducer(loading, adminInvoiceManagerSendFailure({ error: 'no email' }));

    expect(failed).toEqual(expect.objectContaining({ actionLoading: false, error: 'no email' }));
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

  it('sets actionLoading on write-off and refund', () => {
    expect(
      adminInvoiceManagerReducer(
        initialAdminInvoiceManagerState,
        adminInvoiceManagerWriteOff({ invoiceRefId: 'inv-1' }),
      ).actionLoading,
    ).toBe(true);
    expect(
      adminInvoiceManagerReducer(initialAdminInvoiceManagerState, adminInvoiceManagerRefund({ invoiceRefId: 'inv-1' }))
        .actionLoading,
    ).toBe(true);
  });

  it('upserts invoice on write-off and refund success', () => {
    const writtenOff = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, invoices: [listItem], actionLoading: true },
      adminInvoiceManagerWriteOffSuccess({ invoice: { ...listItem, status: 'written_off' } }),
    );

    expect(writtenOff.actionLoading).toBe(false);
    expect(writtenOff.invoices[0].status).toBe('written_off');

    const refunded = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, invoices: [listItem], actionLoading: true },
      adminInvoiceManagerRefundSuccess({ invoice: { ...listItem, status: 'paid', balance: 0 } }),
    );

    expect(refunded.invoices[0].balance).toBe(0);
  });

  it('stores error on write-off failure', () => {
    const state = adminInvoiceManagerReducer(
      { ...initialAdminInvoiceManagerState, actionLoading: true },
      adminInvoiceManagerWriteOffFailure({ error: 'Write-off failed' }),
    );

    expect(state.actionLoading).toBe(false);
    expect(state.error).toBe('Write-off failed');
  });

  describe('settlements', () => {
    const settlement = {
      id: 's-1',
      type: 'payment',
      amount: 50,
      currency: 'EUR',
      occurredAt: '2026-11-01T00:00:00Z',
      source: 'manual',
      createdAt: '2026-11-01T00:00:00Z',
    };

    it('starts loading and clears settlements of another invoice', () => {
      const state = adminInvoiceManagerReducer(
        { ...initialAdminInvoiceManagerState, settlementsInvoiceId: 'inv-0', settlements: [settlement] },
        loadAdminInvoiceSettlements({ invoiceRefId: 'inv-1' }),
      );

      expect(state.settlementsLoading).toBe(true);
      expect(state.settlementsInvoiceId).toBe('inv-1');
      expect(state.settlements).toEqual([]);
    });

    it('stores settlements of the requested invoice only', () => {
      const loading = adminInvoiceManagerReducer(
        initialAdminInvoiceManagerState,
        loadAdminInvoiceSettlements({ invoiceRefId: 'inv-1' }),
      );
      const loaded = adminInvoiceManagerReducer(
        loading,
        loadAdminInvoiceSettlementsSuccess({ invoiceRefId: 'inv-1', settlements: [settlement] }),
      );

      expect(loaded.settlements).toEqual([settlement]);
      expect(loaded.settlementsLoading).toBe(false);

      const stale = adminInvoiceManagerReducer(
        loading,
        loadAdminInvoiceSettlementsSuccess({ invoiceRefId: 'inv-9', settlements: [settlement] }),
      );

      expect(stale.settlements).toEqual([]);
      expect(stale.settlementsLoading).toBe(true);
    });

    it('stops loading on failure', () => {
      const loading = adminInvoiceManagerReducer(
        initialAdminInvoiceManagerState,
        loadAdminInvoiceSettlements({ invoiceRefId: 'inv-1' }),
      );
      const state = adminInvoiceManagerReducer(
        loading,
        loadAdminInvoiceSettlementsFailure({ invoiceRefId: 'inv-1', error: 'failed' }),
      );

      expect(state.settlementsLoading).toBe(false);
      expect(state.settlements).toEqual([]);
    });
  });
});
