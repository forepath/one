import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/framework/frontend/util-configuration';

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

  it('should list invoices', (done) => {
    service.listInvoices('sub-1').subscribe((res) => {
      expect(res).toEqual([mockInvoice]);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/invoices/sub-1`);

    req.flush([mockInvoice]);
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

  it('should initiate payment', (done) => {
    service.initiatePayment('sub-1', 'ref-1').subscribe((res) => {
      expect(res.checkoutUrl).toContain('stripe');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/invoices/sub-1/ref/ref-1/pay`);

    req.flush({ checkoutUrl: 'https://checkout.stripe.com/test' });
  });
});
