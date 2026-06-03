import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/framework/frontend/util-configuration';

import { AdminBillingService } from './admin-billing.service';

describe('AdminBillingService', () => {
  let service: AdminBillingService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AdminBillingService, { provide: ENVIRONMENT, useValue: { billing: { restApiUrl: apiUrl } } }],
    });
    service = TestBed.inject(AdminBillingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('gets summary', (done) => {
    service.getSummary().subscribe((res) => {
      expect(res.activeSubscriptionsCount).toBe(1);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/summary`);

    expect(req.request.method).toBe('GET');
    req.flush({ activeSubscriptionsCount: 1, openOverdueCount: 0, openOverdueTotal: 0, unbilledTotal: 0 });
  });

  it('posts bill-now', (done) => {
    service.billNow({ userId: 'user-1' }).subscribe((res) => {
      expect(res.invoicesCreated).toBe(1);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/bill-now`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ userId: 'user-1' });
    req.flush({ usersProcessed: 1, invoicesCreated: 1, usersSkipped: 0, errors: [] });
  });

  it('lists invoices with query params', (done) => {
    service.listOpenOverdue({ limit: 10, offset: 0, search: 'INV' }).subscribe((res) => {
      expect(res.total).toBe(1);
      done();
    });
    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/admin/billing/invoices`);

    expect(req.request.params.get('search')).toBe('INV');
    req.flush({ items: [], total: 1, limit: 10, offset: 0 });
  });
});
