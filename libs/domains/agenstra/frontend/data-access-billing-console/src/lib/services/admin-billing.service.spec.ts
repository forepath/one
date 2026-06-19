import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

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
      expect(res.queued).toBe(true);
      expect(res.userCount).toBe(1);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/bill-now`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ userId: 'user-1' });
    req.flush({ queued: true, requestId: 'req-1', userCount: 1 });
  });

  it('lists invoices with query params', (done) => {
    service.listOpenOverdue({ limit: 10, offset: 0, search: 'INV', userId: 'user-1' }).subscribe((res) => {
      expect(res.total).toBe(1);
      done();
    });
    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/admin/billing/invoices`);

    expect(req.request.params.get('search')).toBe('INV');
    expect(req.request.params.get('userId')).toBe('user-1');
    req.flush({ items: [], total: 1, limit: 10, offset: 0 });
  });

  it('voids invoice', (done) => {
    service.voidInvoice('inv-1').subscribe((res) => {
      expect(res.id).toBe('inv-1');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/invoices/inv-1/void`);

    expect(req.request.method).toBe('POST');
    req.flush({ id: 'inv-1', subscriptionId: 'sub-1', userId: 'user-1', status: 'voided' });
  });

  it('marks invoice paid', (done) => {
    service.markPaid('inv-1', { reason: 'manual' }).subscribe((res) => {
      expect(res.status).toBe('paid');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/invoices/inv-1/mark-paid`);

    expect(req.request.body).toEqual({ reason: 'manual' });
    req.flush({ id: 'inv-1', subscriptionId: 'sub-1', userId: 'user-1', status: 'paid' });
  });

  it('marks invoice unpaid', (done) => {
    service.markUnpaid('inv-1').subscribe((res) => {
      expect(res.status).toBe('issued');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/invoices/inv-1/mark-unpaid`);

    expect(req.request.body).toEqual({});
    req.flush({ id: 'inv-1', subscriptionId: 'sub-1', userId: 'user-1', status: 'issued' });
  });

  it('lists audit logs', (done) => {
    service.listAuditLogs('inv-1', 20, 0).subscribe((res) => {
      expect(res.total).toBe(1);
      done();
    });
    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/admin/billing/invoices/inv-1/audit-logs`);

    expect(req.request.params.get('limit')).toBe('20');
    expect(req.request.params.get('offset')).toBe('0');
    req.flush({ items: [], total: 1, limit: 20, offset: 0 });
  });

  it('gets statistics summary', (done) => {
    service
      .getStatisticsSummary({ from: '2024-01-01', to: '2024-01-31', groupBy: 'day', userId: 'user-1' })
      .subscribe((res) => {
        expect(res.totalGross).toBe(100);
        done();
      });
    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/admin/billing/statistics/summary`);

    expect(req.request.params.get('from')).toBe('2024-01-01');
    expect(req.request.params.get('groupBy')).toBe('day');
    req.flush({
      series: [],
      totalGross: 100,
      paidCount: 1,
      from: '2024-01-01',
      to: '2024-01-31',
      groupBy: 'day',
    });
  });

  it('gets statistics by product', (done) => {
    service.getStatisticsByProduct({ from: '2024-01-01', to: '2024-01-31' }).subscribe((res) => {
      expect(res.totalGross).toBe(50);
      done();
    });
    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/admin/billing/statistics/by-product`);

    expect(req.request.params.get('from')).toBe('2024-01-01');
    req.flush({ items: [], totalGross: 50, from: '2024-01-01', to: '2024-01-31' });
  });

  it('lists user subscriptions', (done) => {
    const userId = '11111111-1111-4111-8111-111111111111';

    service.listUserSubscriptions(userId, { limit: 100 }).subscribe((res) => {
      expect(res).toEqual([{ id: 'sub-1', number: 'SUB-001', planId: 'plan-1', userId, status: 'active' }]);
      done();
    });
    const req = httpMock.expectOne(
      (request) => request.url === `${apiUrl}/admin/billing/users/${userId}/subscriptions`,
    );

    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('limit')).toBe('100');
    req.flush([{ id: 'sub-1', number: 'SUB-001', planId: 'plan-1', userId, status: 'active' }]);
  });

  it('creates manual invoice', (done) => {
    const dto = {
      userId: 'user-1',
      lineItems: [{ description: 'Consulting', quantity: 1, unitPriceNet: 100, taxCategory: 'standard' as const }],
    };

    service.createManualInvoice(dto).subscribe((res) => {
      expect(res.id).toBe('inv-manual-1');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/invoices/manual`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush({ id: 'inv-manual-1', userId: 'user-1', status: 'draft', lineItems: [], taxBreakdown: [] });
  });

  it('gets manual invoice detail', (done) => {
    service.getManualInvoiceDetail('inv-manual-1').subscribe((res) => {
      expect(res.id).toBe('inv-manual-1');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/invoices/inv-manual-1`);

    expect(req.request.method).toBe('GET');
    req.flush({ id: 'inv-manual-1', userId: 'user-1', status: 'draft', lineItems: [], taxBreakdown: [] });
  });

  it('updates manual invoice', (done) => {
    const dto = {
      lineItems: [{ description: 'Updated', quantity: 2, unitPriceNet: 50, taxCategory: 'standard' as const }],
    };

    service.updateManualInvoice('inv-manual-1', dto).subscribe((res) => {
      expect(res.status).toBe('draft');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/invoices/inv-manual-1`);

    expect(req.request.method).toBe('POST');
    req.flush({ id: 'inv-manual-1', userId: 'user-1', status: 'draft', lineItems: [], taxBreakdown: [] });
  });

  it('issues manual invoice', (done) => {
    service.issueManualInvoice('inv-manual-1', { dueInDays: 14 }).subscribe((res) => {
      expect(res.status).toBe('issued');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/invoices/inv-manual-1/issue`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ dueInDays: 14 });
    req.flush({ id: 'inv-manual-1', userId: 'user-1', status: 'issued', lineItems: [], taxBreakdown: [] });
  });

  it('deletes manual invoice', (done) => {
    service.deleteManualInvoice('inv-manual-1').subscribe((res) => {
      expect(res).toBeNull();
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/invoices/inv-manual-1`);

    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('downloads invoice pdf by ref', (done) => {
    const blob = new Blob(['pdf']);

    service.downloadInvoicePdf('inv-manual-1').subscribe((res) => {
      expect(res).toEqual(blob);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/invoices/inv-manual-1/pdf`);

    expect(req.request.responseType).toBe('blob');
    req.flush(blob);
  });

  it('downloads void document pdf by ref', (done) => {
    const blob = new Blob(['void-pdf']);

    service.downloadVoidDocumentPdf('inv-manual-1').subscribe((res) => {
      expect(res).toEqual(blob);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/admin/billing/invoices/inv-manual-1/void-document/pdf`);

    expect(req.request.responseType).toBe('blob');
    req.flush(blob);
  });
});
