import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';

import { AdminSupplierInvoicesService } from './admin-supplier-invoices.service';

describe('AdminSupplierInvoicesService', () => {
  let service: AdminSupplierInvoicesService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AdminSupplierInvoicesService,
        {
          provide: ENVIRONMENT,
          useValue: {
            billing: {
              urls: {
                restApi: apiUrl,
              },
            },
          },
        },
      ],
    });
    service = TestBed.inject(AdminSupplierInvoicesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists supplier invoices with filters', (done) => {
    service.list({ limit: 10, offset: 0, search: 'INV', status: 'draft' }).subscribe((res) => {
      expect(res.total).toBe(0);
      done();
    });
    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/admin/billing/supplier-invoices`);

    expect(req.request.params.get('search')).toBe('INV');
    expect(req.request.params.get('status')).toBe('draft');
    req.flush({ items: [], total: 0, limit: 10, offset: 0 });
  });

  it('parses supplier invoice document via multipart upload', (done) => {
    const file = new File(['pdf'], 'invoice.pdf', { type: 'application/pdf' });

    service.parseDocument(file).subscribe((res) => {
      expect(res.lineItems.length).toBe(1);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/supplier-invoices/parse-document`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof FormData).toBe(true);
    req.flush({ lineItems: [{ description: 'Hosting', quantity: 1, unitPriceNet: 100 }], warnings: [] });
  });

  it('creates supplier invoice with FormData', (done) => {
    const formData = new FormData();

    formData.append('supplierId', 'supplier-1');
    formData.append('lineItems', JSON.stringify([{ description: 'Line', quantity: 1, unitPriceNet: 10 }]));

    service.create(formData).subscribe((res) => {
      expect(res.id).toBe('inv-1');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/supplier-invoices`);

    expect(req.request.method).toBe('POST');
    req.flush({
      id: 'inv-1',
      supplierId: 'supplier-1',
      status: 'draft',
      currency: 'EUR',
      subtotalNet: 10,
      taxTotal: 1.9,
      totalGross: 11.9,
      balanceDue: 11.9,
      hasUploadedDocument: false,
      createdAt: '',
      canDownload: false,
      canPreview: false,
    });
  });
});
