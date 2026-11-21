import type { AdminInvoiceManagerState } from './admin-invoice-manager.reducer';
import {
  selectAdminInvoiceManagerActionLoading,
  selectAdminInvoiceManagerCreating,
  selectAdminInvoiceManagerDeleting,
  selectAdminInvoiceManagerError,
  selectAdminInvoiceManagerInvoices,
  selectAdminInvoiceManagerIssuing,
  selectAdminInvoiceManagerLoading,
  selectAdminInvoiceManagerSettlements,
  selectAdminInvoiceManagerSettlementsInvoiceId,
  selectAdminInvoiceManagerSettlementsLoading,
  selectAdminInvoiceManagerState,
  selectAdminInvoiceManagerUpdating,
} from './admin-invoice-manager.selectors';

describe('adminInvoiceManagerSelectors', () => {
  const state: AdminInvoiceManagerState = {
    invoices: [{ id: 'inv-1', userId: 'u-1', createdAt: '', canPay: false, canDownload: false, canPreview: false }],
    loading: true,
    creating: true,
    updating: true,
    issuing: true,
    deleting: true,
    actionLoading: true,
    error: 'err',
    settlementsInvoiceId: 'inv-1',
    settlements: [
      {
        id: 's-1',
        type: 'write_off',
        amount: 20,
        currency: 'EUR',
        occurredAt: '2026-11-01T00:00:00Z',
        source: 'manual',
        createdAt: '2026-11-01T00:00:00Z',
      },
    ],
    settlementsLoading: false,
  } as AdminInvoiceManagerState;
  const rootState = { adminInvoiceManager: state };

  it('selects state slice', () => {
    expect(selectAdminInvoiceManagerState(rootState as never)).toEqual(state);
  });

  it('selects invoices', () => {
    expect(selectAdminInvoiceManagerInvoices(rootState as never)).toEqual(state.invoices);
  });

  it('selects loading flags', () => {
    expect(selectAdminInvoiceManagerLoading(rootState as never)).toBe(true);
    expect(selectAdminInvoiceManagerCreating(rootState as never)).toBe(true);
    expect(selectAdminInvoiceManagerUpdating(rootState as never)).toBe(true);
    expect(selectAdminInvoiceManagerIssuing(rootState as never)).toBe(true);
    expect(selectAdminInvoiceManagerDeleting(rootState as never)).toBe(true);
    expect(selectAdminInvoiceManagerActionLoading(rootState as never)).toBe(true);
  });

  it('selects error', () => {
    expect(selectAdminInvoiceManagerError(rootState as never)).toBe('err');
  });

  it('selects settlements', () => {
    expect(selectAdminInvoiceManagerSettlements(rootState as never)).toEqual(state.settlements);
    expect(selectAdminInvoiceManagerSettlementsInvoiceId(rootState as never)).toBe('inv-1');
    expect(selectAdminInvoiceManagerSettlementsLoading(rootState as never)).toBe(false);
  });
});
