import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { CreateInvoiceDto, CreateInvoiceResponse, InvoiceResponse } from '../types/billing.types';

import { InvoicesService } from './invoices.service';

describe('InvoicesService', () => {
  let service: InvoicesService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';
  const mockInvoice: InvoiceResponse = {
    id: 'inv-1',
    subscriptionId: 'sub-1',
    invoiceNumber: 'INV-1',
    status: 'issued',
    balance: 10,
    createdAt: '2024-01-01T00:00:00Z',
    canPay: true,
    canDownload: true,
    canPreview: true,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        InvoicesService,
        {
          provide: ENVIRONMENT,
          useValue: { billing: { restApiUrl: apiUrl } },
        },
      ],
    });
    service = TestBed.inject(InvoicesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should get invoices summary', (done) => {
    const summary = { openOverdueCount: 1, openOverdueTotal: 10, billingDayOfMonth: 5, unbilledTotal: 20 };

    service.getInvoicesSummary().subscribe((res) => {
      expect(res).toEqual(summary);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/invoices/summary`);

    req.flush(summary);
  });

  it('should get open overdue invoices', (done) => {
    service.getOpenOverdueInvoices().subscribe((res) => {
      expect(res).toEqual([mockInvoice]);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/invoices/open-overdue`);

    req.flush([mockInvoice]);
  });

  it('should list invoices', (done) => {
    service.listInvoices('sub-1').subscribe((res) => {
      expect(res).toEqual([mockInvoice]);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/invoices/sub-1`);

    req.flush([mockInvoice]);
  });

  it('should get invoice details', (done) => {
    const detail = {
      ...mockInvoice,
      currency: 'EUR',
      subtotalNet: 10,
      taxTotal: 1.9,
      totalGross: 11.9,
      balanceDue: 11.9,
      lineItems: [],
      taxBreakdown: [],
    };

    service.getInvoiceDetails('sub-1', 'inv-1').subscribe((res) => {
      expect(res.id).toBe('inv-1');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/invoices/sub-1/ref/inv-1`);

    req.flush(detail);
  });

  it('should download invoice pdf', (done) => {
    const blob = new Blob(['pdf']);

    service.downloadInvoicePdf('sub-1', 'inv-1').subscribe((res) => {
      expect(res).toEqual(blob);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/invoices/sub-1/ref/inv-1/pdf`);

    expect(req.request.responseType).toBe('blob');
    req.flush(blob);
  });

  it('should download void document pdf', (done) => {
    const blob = new Blob(['void-pdf']);

    service.downloadVoidDocumentPdf('sub-1', 'inv-1').subscribe((res) => {
      expect(res).toEqual(blob);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/invoices/sub-1/ref/inv-1/void-document/pdf`);

    expect(req.request.responseType).toBe('blob');
    req.flush(blob);
  });

  it('should create invoice', (done) => {
    const dto: CreateInvoiceDto = { description: 'Test' };
    const response: CreateInvoiceResponse = { invoiceRefId: 'ref-1', invoiceNumber: 'INV-1' };

    service.createInvoice('sub-1', dto).subscribe((res) => {
      expect(res).toEqual(response);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/invoices/sub-1`);

    expect(req.request.method).toBe('POST');
    req.flush(response);
  });

  it('should create invoice with empty body when dto omitted', (done) => {
    service.createInvoice('sub-1').subscribe(() => done());
    const req = httpMock.expectOne(`${apiUrl}/invoices/sub-1`);

    expect(req.request.body).toEqual({});
    req.flush({ invoiceRefId: 'ref-1' });
  });

  it('should initiate payment', (done) => {
    service.initiatePayment('sub-1', 'ref-1').subscribe((res) => {
      expect(res.checkoutUrl).toContain('stripe');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/invoices/sub-1/ref/ref-1/pay`);

    req.flush({ checkoutUrl: 'https://checkout.stripe.com/test' });
  });

  it('should void invoice', (done) => {
    service.voidInvoice('sub-1', 'inv-1').subscribe((res) => {
      expect(res.status).toBe('voided');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/invoices/sub-1/ref/inv-1/void`);

    expect(req.request.method).toBe('POST');
    req.flush({ ...mockInvoice, status: 'voided' });
  });
});
