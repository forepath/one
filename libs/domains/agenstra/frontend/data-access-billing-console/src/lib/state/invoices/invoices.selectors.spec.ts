import type { InvoiceDetailResponse, InvoiceResponse } from '../../types/billing.types';

import { initialInvoicesState, type InvoicesState } from './invoices.reducer';
import {
  selectHasInvoicesBySubscriptionId,
  selectInvoiceDetailByRefId,
  selectInvoiceDetailsLoading,
  selectInvoicesBySubscriptionId,
  selectInvoicesCountBySubscriptionId,
  selectInvoicesCreating,
  selectInvoicesEntities,
  selectInvoicesError,
  selectInvoicesLoading,
  selectInvoicesLoadingAny,
  selectInvoicesState,
  selectInvoicesSummary,
  selectInvoicesSummaryError,
  selectInvoicesSummaryLoading,
  selectPayingInvoiceRefId,
} from './invoices.selectors';

describe('Invoices Selectors', () => {
  const subscriptionId = 'sub-1';
  const mockInvoice: InvoiceResponse = {
    id: 'inv-1',
    subscriptionId: 'sub-1',
    createdAt: '2024-01-01T00:00:00Z',
    canPay: true,
    canDownload: true,
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
  const createState = (overrides?: Partial<InvoicesState>): InvoicesState => ({
    ...initialInvoicesState,
    ...overrides,
  });

  describe('selectInvoicesState', () => {
    it('should select the invoices feature state', () => {
      const state = createState();
      const rootState = { invoices: state };

      expect(selectInvoicesState(rootState as never)).toEqual(state);
    });
  });

  describe('selectInvoicesEntities', () => {
    it('should select entities', () => {
      const state = createState({
        entities: { [subscriptionId]: [mockInvoice] },
      });
      const rootState = { invoices: state };

      expect(selectInvoicesEntities(rootState as never)).toEqual({ [subscriptionId]: [mockInvoice] });
    });
  });

  describe('selectInvoicesLoading', () => {
    it('should return loading state', () => {
      const state = createState({ loading: true });
      const rootState = { invoices: state };

      expect(selectInvoicesLoading(rootState as never)).toBe(true);
    });
  });

  describe('selectInvoicesCreating', () => {
    it('should return creating state', () => {
      const state = createState({ creating: true });
      const rootState = { invoices: state };

      expect(selectInvoicesCreating(rootState as never)).toBe(true);
    });
  });

  describe('selectPayingInvoiceRefId', () => {
    it('should return payingInvoiceRefId', () => {
      const state = createState({ payingInvoiceRefId: 'ref-1' });
      const rootState = { invoices: state };

      expect(selectPayingInvoiceRefId(rootState as never)).toBe('ref-1');
    });
    it('should return null when not paying', () => {
      const state = createState();
      const rootState = { invoices: state };

      expect(selectPayingInvoiceRefId(rootState as never)).toBeNull();
    });
  });

  describe('selectInvoiceDetailsLoading', () => {
    it('should return detailsLoading', () => {
      const state = createState({ detailsLoading: true });
      const rootState = { invoices: state };

      expect(selectInvoiceDetailsLoading(rootState as never)).toBe(true);
    });
  });

  describe('selectInvoiceDetailByRefId', () => {
    it('should return stored detail for ref id', () => {
      const state = createState({
        invoiceDetails: { 'inv-1': mockDetail },
      });
      const rootState = { invoices: state };
      const selector = selectInvoiceDetailByRefId('inv-1');

      expect(selector(rootState as never)).toEqual(mockDetail);
    });
    it('should return null when detail not loaded', () => {
      const state = createState();
      const rootState = { invoices: state };
      const selector = selectInvoiceDetailByRefId('inv-1');

      expect(selector(rootState as never)).toBeNull();
    });
  });

  describe('selectInvoicesSummary', () => {
    it('should return summary', () => {
      const summary = { openOverdueCount: 2, openOverdueTotal: 150, billingDayOfMonth: 1, unbilledTotal: 0 };
      const state = createState({ summary });
      const rootState = { invoices: state };

      expect(selectInvoicesSummary(rootState as never)).toEqual(summary);
    });
    it('should return null when no summary', () => {
      const state = createState();
      const rootState = { invoices: state };

      expect(selectInvoicesSummary(rootState as never)).toBeNull();
    });
  });

  describe('selectInvoicesSummaryLoading', () => {
    it('should return summaryLoading', () => {
      const state = createState({ summaryLoading: true });
      const rootState = { invoices: state };

      expect(selectInvoicesSummaryLoading(rootState as never)).toBe(true);
    });
  });

  describe('selectInvoicesSummaryError', () => {
    it('should return summaryError', () => {
      const state = createState({ summaryError: 'Summary failed' });
      const rootState = { invoices: state };

      expect(selectInvoicesSummaryError(rootState as never)).toBe('Summary failed');
    });
  });

  describe('selectInvoicesError', () => {
    it('should return error', () => {
      const state = createState({ error: 'Test error' });
      const rootState = { invoices: state };

      expect(selectInvoicesError(rootState as never)).toBe('Test error');
    });
  });

  describe('selectInvoicesLoadingAny', () => {
    it('should return true when loading or creating', () => {
      const state = createState({ loading: true });
      const rootState = { invoices: state };

      expect(selectInvoicesLoadingAny(rootState as never)).toBe(true);
    });
  });

  describe('selectInvoicesBySubscriptionId', () => {
    it('should return invoices for subscription', () => {
      const state = createState({
        entities: { [subscriptionId]: [mockInvoice] },
      });
      const rootState = { invoices: state };
      const selector = selectInvoicesBySubscriptionId(subscriptionId);

      expect(selector(rootState as never)).toEqual([mockInvoice]);
    });
    it('should return empty array when no invoices for subscription', () => {
      const state = createState({ entities: {} });
      const rootState = { invoices: state };
      const selector = selectInvoicesBySubscriptionId(subscriptionId);

      expect(selector(rootState as never)).toEqual([]);
    });
  });

  describe('selectInvoicesCountBySubscriptionId', () => {
    it('should return count for subscription', () => {
      const state = createState({
        entities: { [subscriptionId]: [mockInvoice, { ...mockInvoice, id: 'inv-2' }] },
      });
      const rootState = { invoices: state };
      const selector = selectInvoicesCountBySubscriptionId(subscriptionId);

      expect(selector(rootState as never)).toBe(2);
    });
  });

  describe('selectHasInvoicesBySubscriptionId', () => {
    it('should return true when subscription has invoices', () => {
      const state = createState({
        entities: { [subscriptionId]: [mockInvoice] },
      });
      const rootState = { invoices: state };
      const selector = selectHasInvoicesBySubscriptionId(subscriptionId);

      expect(selector(rootState as never)).toBe(true);
    });
    it('should return false when subscription has no invoices', () => {
      const state = createState({ entities: {} });
      const rootState = { invoices: state };
      const selector = selectHasInvoicesBySubscriptionId(subscriptionId);

      expect(selector(rootState as never)).toBe(false);
    });
  });
});
