import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { InvoicesService } from '../../services/invoices.service';
import type { InvoiceResponse } from '../../types/billing.types';

import {
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
import {
  createInvoice$,
  initiatePaymentRedirect$,
  loadInvoiceDetails$,
  loadInvoices$,
  loadInvoicesSummary$,
  loadOpenOverdueInvoices$,
} from './invoices.effects';

describe('InvoicesEffects', () => {
  let actions$: Actions;
  let invoicesService: jest.Mocked<InvoicesService>;
  const subscriptionId = 'sub-1';
  const mockInvoice: InvoiceResponse = {
    id: 'inv-1',
    subscriptionId: 'sub-1',
    createdAt: '2024-01-01T00:00:00Z',
    canPay: true,
    canDownload: true,
    canPreview: true,
  };

  beforeEach(() => {
    invoicesService = {
      listInvoices: jest.fn(),
      createInvoice: jest.fn(),
      getInvoicesSummary: jest.fn(),
      getOpenOverdueInvoices: jest.fn(),
      getInvoiceDetails: jest.fn(),
      initiatePayment: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: InvoicesService, useValue: invoicesService }],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('loadInvoicesSummary$', () => {
    it('should return loadInvoicesSummarySuccess on success', (done) => {
      const summary = { openOverdueCount: 2, openOverdueTotal: 100, billingDayOfMonth: 10, unbilledTotal: 25 };

      actions$ = of(loadInvoicesSummary());
      invoicesService.getInvoicesSummary.mockReturnValue(of(summary));

      loadInvoicesSummary$(actions$, invoicesService).subscribe((result) => {
        expect(result).toEqual(loadInvoicesSummarySuccess({ summary }));
        expect(invoicesService.getInvoicesSummary).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadInvoicesSummaryFailure on error', (done) => {
      actions$ = of(loadInvoicesSummary());
      invoicesService.getInvoicesSummary.mockReturnValue(throwError(() => new Error('Summary failed')));

      loadInvoicesSummary$(actions$, invoicesService).subscribe((result) => {
        expect(result).toEqual(loadInvoicesSummaryFailure({ error: 'Summary failed' }));
        done();
      });
    });
  });

  describe('loadOpenOverdueInvoices$', () => {
    it('should return loadOpenOverdueInvoicesSuccess on success', (done) => {
      const invoices = [mockInvoice];

      actions$ = of(loadOpenOverdueInvoices());
      invoicesService.getOpenOverdueInvoices.mockReturnValue(of(invoices));

      loadOpenOverdueInvoices$(actions$, invoicesService).subscribe((result) => {
        expect(result).toEqual(loadOpenOverdueInvoicesSuccess({ invoices }));
        expect(invoicesService.getOpenOverdueInvoices).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadOpenOverdueInvoicesFailure on error', (done) => {
      actions$ = of(loadOpenOverdueInvoices());
      invoicesService.getOpenOverdueInvoices.mockReturnValue(throwError(() => new Error('Open overdue failed')));

      loadOpenOverdueInvoices$(actions$, invoicesService).subscribe((result) => {
        expect(result).toEqual(loadOpenOverdueInvoicesFailure({ error: 'Open overdue failed' }));
        done();
      });
    });
  });

  describe('loadInvoices$', () => {
    it('should return loadInvoicesSuccess on success', (done) => {
      const invoices = [mockInvoice];

      actions$ = of(loadInvoices({ subscriptionId }));
      invoicesService.listInvoices.mockReturnValue(of(invoices));

      loadInvoices$(actions$, invoicesService).subscribe((result) => {
        expect(result).toEqual(loadInvoicesSuccess({ subscriptionId, invoices }));
        expect(invoicesService.listInvoices).toHaveBeenCalledWith(subscriptionId);
        done();
      });
    });

    it('should return loadInvoicesFailure on error', (done) => {
      actions$ = of(loadInvoices({ subscriptionId }));
      invoicesService.listInvoices.mockReturnValue(throwError(() => new Error('Load failed')));

      loadInvoices$(actions$, invoicesService).subscribe((result) => {
        expect(result).toEqual(loadInvoicesFailure({ error: 'Load failed' }));
        done();
      });
    });
  });

  describe('createInvoice$', () => {
    it('should return createInvoiceSuccess on success', (done) => {
      const response = { invoiceRefId: 'inv-1', invoiceNumber: 'INV-001' };

      actions$ = of(createInvoice({ subscriptionId, dto: {} }));
      invoicesService.createInvoice.mockReturnValue(of(response));

      createInvoice$(actions$, invoicesService).subscribe((result) => {
        expect(result).toEqual(createInvoiceSuccess({ subscriptionId, response }));
        done();
      });
    });

    it('should return createInvoiceFailure on error', (done) => {
      actions$ = of(createInvoice({ subscriptionId }));
      invoicesService.createInvoice.mockReturnValue(throwError(() => new Error('Create failed')));

      createInvoice$(actions$, invoicesService).subscribe((result) => {
        expect(result).toEqual(createInvoiceFailure({ error: 'Create failed' }));
        done();
      });
    });
  });

  describe('loadInvoiceDetails$', () => {
    it('should return loadInvoiceDetailsSuccess on success', (done) => {
      const detail = {
        id: 'inv-1',
        subscriptionId,
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

      actions$ = of(loadInvoiceDetails({ subscriptionId, invoiceRefId: 'inv-1' }));
      invoicesService.getInvoiceDetails.mockReturnValue(of(detail));

      loadInvoiceDetails$(actions$, invoicesService).subscribe((result) => {
        expect(result).toEqual(loadInvoiceDetailsSuccess({ invoiceRefId: 'inv-1', detail }));
        done();
      });
    });

    it('should return loadInvoiceDetailsFailure on error', (done) => {
      actions$ = of(loadInvoiceDetails({ subscriptionId, invoiceRefId: 'inv-1' }));
      invoicesService.getInvoiceDetails.mockReturnValue(throwError(() => new Error('Details failed')));

      loadInvoiceDetails$(actions$, invoicesService).subscribe((result) => {
        expect(result).toEqual(loadInvoiceDetailsFailure({ error: 'Details failed' }));
        done();
      });
    });
  });

  describe('initiatePaymentRedirect$', () => {
    it('should return initiatePaymentSuccess on success', (done) => {
      actions$ = of(initiatePayment({ subscriptionId, invoiceRefId: 'inv-1' }));
      invoicesService.initiatePayment.mockReturnValue(of({ checkoutUrl: 'https://checkout.stripe.com/pay' }));

      initiatePaymentRedirect$(actions$, invoicesService).subscribe((result) => {
        expect(invoicesService.initiatePayment).toHaveBeenCalledWith(subscriptionId, 'inv-1');
        expect(result).toEqual(initiatePaymentSuccess());
        done();
      });
    });

    it('should return initiatePaymentFailure on error', (done) => {
      actions$ = of(initiatePayment({ subscriptionId, invoiceRefId: 'inv-1' }));
      invoicesService.initiatePayment.mockReturnValue(throwError(() => new Error('Payment failed')));

      initiatePaymentRedirect$(actions$, invoicesService).subscribe((result) => {
        expect(result).toEqual(initiatePaymentFailure({ error: 'Payment failed' }));
        done();
      });
    });
  });
});
