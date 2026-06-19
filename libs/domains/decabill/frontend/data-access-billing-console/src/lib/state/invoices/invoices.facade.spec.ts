import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import { InvoicesService } from '../../services/invoices.service';
import type { CreateInvoiceDto, InvoiceResponse } from '../../types/billing.types';

import {
  clearInvoices,
  createInvoice,
  initiatePayment,
  loadInvoiceDetails,
  loadInvoices,
  loadInvoicesSummary as loadInvoicesSummaryAction,
  loadOpenOverdueInvoices,
} from './invoices.actions';
import { InvoicesFacade } from './invoices.facade';

describe('InvoicesFacade', () => {
  let facade: InvoicesFacade;
  let store: jest.Mocked<Store>;
  let invoicesService: jest.Mocked<
    Pick<InvoicesService, 'downloadInvoicePdf' | 'downloadVoidDocumentPdf' | 'voidInvoice'>
  >;
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
    store = { select: jest.fn(), dispatch: jest.fn() } as never;
    invoicesService = {
      downloadInvoicePdf: jest.fn(),
      downloadVoidDocumentPdf: jest.fn(),
      voidInvoice: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        InvoicesFacade,
        { provide: Store, useValue: store },
        { provide: InvoicesService, useValue: invoicesService },
      ],
    });

    facade = TestBed.inject(InvoicesFacade);
  });

  describe('State Observables', () => {
    it('should return invoices by subscription id observable', (done) => {
      store.select.mockReturnValue(of([mockInvoice]));
      facade.getInvoicesBySubscriptionId$(subscriptionId).subscribe((result) => {
        expect(result).toEqual([mockInvoice]);
        done();
      });
    });

    it('should return loading observable', (done) => {
      store.select.mockReturnValue(of(true));
      facade.getInvoicesLoading$().subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should return error observable', (done) => {
      store.select.mockReturnValue(of('Test error'));
      facade.getInvoicesError$().subscribe((result) => {
        expect(result).toBe('Test error');
        done();
      });
    });

    it('should return payingInvoiceRefId observable', (done) => {
      store.select.mockReturnValue(of('ref-1'));
      facade.getPayingInvoiceRefId$().subscribe((result) => {
        expect(result).toBe('ref-1');
        done();
      });
    });

    it('should return invoices summary observable', (done) => {
      const summary = { openOverdueCount: 2, openOverdueTotal: 100, billingDayOfMonth: 10, unbilledTotal: 25 };

      store.select.mockReturnValue(of(summary));
      facade.getInvoicesSummary$().subscribe((result) => {
        expect(result).toEqual(summary);
        done();
      });
    });
  });

  describe('Action Methods', () => {
    it('should dispatch loadInvoices', () => {
      facade.loadInvoices(subscriptionId);
      expect(store.dispatch).toHaveBeenCalledWith(loadInvoices({ subscriptionId }));
    });

    it('should dispatch createInvoice', () => {
      const dto: CreateInvoiceDto = { description: 'Test' };

      facade.createInvoice(subscriptionId, dto);
      expect(store.dispatch).toHaveBeenCalledWith(createInvoice({ subscriptionId, dto }));
    });

    it('should dispatch clearInvoices', () => {
      facade.clearInvoices();
      expect(store.dispatch).toHaveBeenCalledWith(clearInvoices());
    });

    it('should dispatch loadInvoicesSummary', () => {
      facade.loadInvoicesSummary();
      expect(store.dispatch).toHaveBeenCalledWith(loadInvoicesSummaryAction());
    });

    it('should dispatch loadInvoiceDetails', () => {
      const invoiceRefId = 'ref-1';

      facade.loadInvoiceDetails(subscriptionId, invoiceRefId);
      expect(store.dispatch).toHaveBeenCalledWith(loadInvoiceDetails({ subscriptionId, invoiceRefId }));
    });

    it('should dispatch loadInvoiceDetails without subscriptionId for manual invoices', () => {
      const invoiceRefId = 'ref-manual';

      facade.loadInvoiceDetails(undefined, invoiceRefId);
      expect(store.dispatch).toHaveBeenCalledWith(loadInvoiceDetails({ subscriptionId: undefined, invoiceRefId }));
    });

    it('should dispatch loadOpenOverdueInvoices', () => {
      facade.loadOpenOverdueInvoices();
      expect(store.dispatch).toHaveBeenCalledWith(loadOpenOverdueInvoices());
    });

    it('should dispatch initiatePayment', () => {
      const invoiceRefId = 'ref-1';

      facade.initiatePayment(subscriptionId, invoiceRefId);
      expect(store.dispatch).toHaveBeenCalledWith(initiatePayment({ subscriptionId, invoiceRefId }));
    });

    it('should dispatch initiatePayment without subscriptionId for manual invoices', () => {
      const invoiceRefId = 'ref-manual';

      facade.initiatePayment(undefined, invoiceRefId);
      expect(store.dispatch).toHaveBeenCalledWith(initiatePayment({ subscriptionId: undefined, invoiceRefId }));
    });
  });

  describe('Service Methods', () => {
    it('should delegate downloadInvoicePdf to service', (done) => {
      const blob = new Blob(['pdf']);

      invoicesService.downloadInvoicePdf.mockReturnValue(of(blob));
      facade.downloadInvoicePdf(subscriptionId, 'inv-1').subscribe((result) => {
        expect(result).toBe(blob);
        expect(invoicesService.downloadInvoicePdf).toHaveBeenCalledWith(subscriptionId, 'inv-1');
        done();
      });
    });

    it('should delegate downloadInvoicePdf without subscriptionId', (done) => {
      const blob = new Blob(['pdf']);

      invoicesService.downloadInvoicePdf.mockReturnValue(of(blob));
      facade.downloadInvoicePdf(undefined, 'inv-manual').subscribe((result) => {
        expect(result).toBe(blob);
        expect(invoicesService.downloadInvoicePdf).toHaveBeenCalledWith(undefined, 'inv-manual');
        done();
      });
    });

    it('should delegate downloadVoidDocumentPdf to service', (done) => {
      const blob = new Blob(['void']);

      invoicesService.downloadVoidDocumentPdf.mockReturnValue(of(blob));
      facade.downloadVoidDocumentPdf(subscriptionId, 'inv-1').subscribe((result) => {
        expect(result).toBe(blob);
        expect(invoicesService.downloadVoidDocumentPdf).toHaveBeenCalledWith(subscriptionId, 'inv-1');
        done();
      });
    });

    it('should delegate voidInvoice to service', (done) => {
      invoicesService.voidInvoice.mockReturnValue(of({ ...mockInvoice, status: 'voided' }));
      facade.voidInvoice(subscriptionId, 'inv-1').subscribe((result) => {
        expect(result.status).toBe('voided');
        expect(invoicesService.voidInvoice).toHaveBeenCalledWith(subscriptionId, 'inv-1');
        done();
      });
    });
  });
});
