import type { InvoiceDetailResponse, InvoiceResponse } from '../../types/billing.types';

import {
  clearInvoices,
  createInvoice,
  createInvoiceFailure,
  createInvoiceSuccess,
  initiatePayment,
  initiatePaymentFailure,
  initiatePaymentSuccess,
  loadInvoiceDetails,
  loadInvoiceDetailsFailure,
  loadInvoiceDetailsSuccess,
  loadInvoices,
  loadInvoicesFailure,
  loadInvoicesSuccess,
  loadInvoicesSummary,
  loadInvoicesSummaryFailure,
  loadInvoicesSummarySuccess,
  loadOpenOverdueInvoices,
  loadOpenOverdueInvoicesFailure,
  loadOpenOverdueInvoicesSuccess,
} from './invoices.actions';
import { invoicesReducer, initialInvoicesState, type InvoicesState } from './invoices.reducer';

describe('invoicesReducer', () => {
  const subscriptionId = 'sub-1';
  const mockInvoice: InvoiceResponse = {
    id: 'inv-1',
    subscriptionId: 'sub-1',
    status: 'draft',
    createdAt: '2024-01-01T00:00:00Z',
    canPay: false,
    canDownload: false,
    canPreview: true,
  };
  const mockDetail: InvoiceDetailResponse = {
    id: 'inv-1',
    subscriptionId: 'sub-1',
    invoiceNumber: 'INV-001',
    status: 'issued',
    currency: 'EUR',
    subtotalNet: 100,
    taxTotal: 19,
    totalGross: 119,
    balanceDue: 119,
    lineItems: [],
    taxBreakdown: [],
    createdAt: '2024-01-01T00:00:00Z',
    canPay: true,
    canDownload: true,
    canPreview: true,
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };

      expect(invoicesReducer(undefined, action as never)).toEqual(initialInvoicesState);
    });
  });

  describe('loadInvoices', () => {
    it('should set loading to true and clear error', () => {
      const state: InvoicesState = {
        ...initialInvoicesState,
        error: 'Previous error',
      };
      const newState = invoicesReducer(state, loadInvoices({ subscriptionId }));

      expect(newState.loading).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadInvoicesSuccess', () => {
    it('should set invoices for subscription and set loading to false', () => {
      const state: InvoicesState = {
        ...initialInvoicesState,
        loading: true,
      };
      const invoices = [mockInvoice];
      const newState = invoicesReducer(state, loadInvoicesSuccess({ subscriptionId, invoices }));

      expect(newState.entities[subscriptionId]).toEqual(invoices);
      expect(newState.loading).toBe(false);
      expect(newState.error).toBeNull();
    });

    it('should merge entities for different subscriptions', () => {
      const state: InvoicesState = {
        ...initialInvoicesState,
        entities: { 'sub-other': [mockInvoice] },
      };
      const newState = invoicesReducer(state, loadInvoicesSuccess({ subscriptionId, invoices: [mockInvoice] }));

      expect(newState.entities['sub-other']).toEqual([mockInvoice]);
      expect(newState.entities[subscriptionId]).toEqual([mockInvoice]);
    });
  });

  describe('loadInvoicesFailure', () => {
    it('should set error and set loading to false', () => {
      const state: InvoicesState = { ...initialInvoicesState, loading: true };
      const newState = invoicesReducer(state, loadInvoicesFailure({ error: 'Load failed' }));

      expect(newState.error).toBe('Load failed');
      expect(newState.loading).toBe(false);
    });
  });

  describe('createInvoice', () => {
    it('should set creating to true and clear error', () => {
      const state: InvoicesState = { ...initialInvoicesState, error: 'Previous error' };
      const newState = invoicesReducer(state, createInvoice({ subscriptionId }));

      expect(newState.creating).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('createInvoiceSuccess', () => {
    it('should set creating to false and clear error', () => {
      const state: InvoicesState = { ...initialInvoicesState, creating: true };
      const newState = invoicesReducer(
        state,
        createInvoiceSuccess({
          subscriptionId,
          response: { invoiceRefId: 'inv-1', invoiceNumber: 'INV-001' },
        }),
      );

      expect(newState.creating).toBe(false);
      expect(newState.error).toBeNull();
    });
  });

  describe('createInvoiceFailure', () => {
    it('should set error and set creating to false', () => {
      const state: InvoicesState = { ...initialInvoicesState, creating: true };
      const newState = invoicesReducer(state, createInvoiceFailure({ error: 'Create failed' }));

      expect(newState.error).toBe('Create failed');
      expect(newState.creating).toBe(false);
    });
  });

  describe('loadInvoiceDetails', () => {
    it('should set detailsLoading to true and clear error', () => {
      const state: InvoicesState = { ...initialInvoicesState, error: 'Previous error' };
      const newState = invoicesReducer(state, loadInvoiceDetails({ subscriptionId, invoiceRefId: 'inv-1' }));

      expect(newState.detailsLoading).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadInvoiceDetailsSuccess', () => {
    it('should store detail by ref id and clear detailsLoading', () => {
      const state: InvoicesState = { ...initialInvoicesState, detailsLoading: true };
      const newState = invoicesReducer(state, loadInvoiceDetailsSuccess({ invoiceRefId: 'inv-1', detail: mockDetail }));

      expect(newState.invoiceDetails['inv-1']).toEqual(mockDetail);
      expect(newState.detailsLoading).toBe(false);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadInvoiceDetailsFailure', () => {
    it('should set error and clear detailsLoading', () => {
      const state: InvoicesState = { ...initialInvoicesState, detailsLoading: true };
      const newState = invoicesReducer(state, loadInvoiceDetailsFailure({ error: 'Details failed' }));

      expect(newState.detailsLoading).toBe(false);
      expect(newState.error).toBe('Details failed');
    });
  });

  describe('initiatePayment', () => {
    it('should set payingInvoiceRefId and clear error', () => {
      const state: InvoicesState = { ...initialInvoicesState, error: 'Previous error' };
      const newState = invoicesReducer(state, initiatePayment({ subscriptionId, invoiceRefId: 'ref-1' }));

      expect(newState.payingInvoiceRefId).toBe('ref-1');
      expect(newState.error).toBeNull();
    });
  });

  describe('initiatePaymentSuccess', () => {
    it('should clear payingInvoiceRefId', () => {
      const state: InvoicesState = {
        ...initialInvoicesState,
        payingInvoiceRefId: 'ref-1',
      };
      const newState = invoicesReducer(state, initiatePaymentSuccess());

      expect(newState.payingInvoiceRefId).toBeNull();
    });
  });

  describe('initiatePaymentFailure', () => {
    it('should set error and clear payingInvoiceRefId', () => {
      const state: InvoicesState = {
        ...initialInvoicesState,
        payingInvoiceRefId: 'ref-1',
      };
      const newState = invoicesReducer(state, initiatePaymentFailure({ error: 'Payment failed' }));

      expect(newState.payingInvoiceRefId).toBeNull();
      expect(newState.error).toBe('Payment failed');
    });
  });

  describe('loadInvoicesSummary', () => {
    it('should set summaryLoading to true and clear summaryError', () => {
      const state: InvoicesState = { ...initialInvoicesState, summaryError: 'Previous error' };
      const newState = invoicesReducer(state, loadInvoicesSummary());

      expect(newState.summaryLoading).toBe(true);
      expect(newState.summaryError).toBeNull();
    });
  });

  describe('loadInvoicesSummarySuccess', () => {
    it('should set summary and clear summaryLoading', () => {
      const state: InvoicesState = { ...initialInvoicesState, summaryLoading: true };
      const summary = { openOverdueCount: 3, openOverdueTotal: 200, billingDayOfMonth: 15, unbilledTotal: 50 };
      const newState = invoicesReducer(state, loadInvoicesSummarySuccess({ summary }));

      expect(newState.summary).toEqual(summary);
      expect(newState.summaryLoading).toBe(false);
      expect(newState.summaryError).toBeNull();
    });
  });

  describe('loadInvoicesSummaryFailure', () => {
    it('should set summaryError and clear summaryLoading', () => {
      const state: InvoicesState = { ...initialInvoicesState, summaryLoading: true };
      const newState = invoicesReducer(state, loadInvoicesSummaryFailure({ error: 'Summary failed' }));

      expect(newState.summaryLoading).toBe(false);
      expect(newState.summaryError).toBe('Summary failed');
    });
  });

  describe('loadOpenOverdueInvoices', () => {
    it('should set openOverdueListLoading to true and clear openOverdueListError', () => {
      const state: InvoicesState = { ...initialInvoicesState, openOverdueListError: 'Previous error' };
      const newState = invoicesReducer(state, loadOpenOverdueInvoices());

      expect(newState.openOverdueListLoading).toBe(true);
      expect(newState.openOverdueListError).toBeNull();
    });
  });

  describe('loadOpenOverdueInvoicesSuccess', () => {
    it('should set openOverdueList and clear loading', () => {
      const state: InvoicesState = { ...initialInvoicesState, openOverdueListLoading: true };
      const invoices = [mockInvoice];
      const newState = invoicesReducer(state, loadOpenOverdueInvoicesSuccess({ invoices }));

      expect(newState.openOverdueList).toEqual(invoices);
      expect(newState.openOverdueListLoading).toBe(false);
      expect(newState.openOverdueListError).toBeNull();
    });
  });

  describe('loadOpenOverdueInvoicesFailure', () => {
    it('should set openOverdueListError and clear loading', () => {
      const state: InvoicesState = { ...initialInvoicesState, openOverdueListLoading: true };
      const newState = invoicesReducer(state, loadOpenOverdueInvoicesFailure({ error: 'Open overdue load failed' }));

      expect(newState.openOverdueListLoading).toBe(false);
      expect(newState.openOverdueListError).toBe('Open overdue load failed');
    });
  });

  describe('clearInvoices', () => {
    it('should reset to initial state', () => {
      const state: InvoicesState = {
        ...initialInvoicesState,
        entities: { [subscriptionId]: [mockInvoice] },
        loading: true,
      };
      const newState = invoicesReducer(state, clearInvoices());

      expect(newState).toEqual(initialInvoicesState);
    });
  });
});
