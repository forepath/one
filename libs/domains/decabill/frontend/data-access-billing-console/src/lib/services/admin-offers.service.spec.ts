import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { AdminOfferDetailResponse, AdminOfferListItem } from '../types/offers.types';

import { AdminOffersService } from './admin-offers.service';

describe('AdminOffersService', () => {
  let service: AdminOffersService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';

  const mockListItem: AdminOfferListItem = {
    id: 'offer-1',
    userId: 'user-1',
    userEmail: 'customer@example.com',
    offerNumber: 'OFF-2026-00001',
    status: 'draft',
    currency: 'EUR',
    totalGross: 119,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AdminOffersService,
        {
          provide: ENVIRONMENT,
          useValue: { billing: { restApiUrl: apiUrl } },
        },
      ],
    });
    service = TestBed.inject(AdminOffersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists offers with pagination and search params', (done) => {
    const response = { items: [mockListItem], total: 1, limit: 10, offset: 0 };

    service.list({ limit: 10, offset: 0, search: ' OFF-2026 ', userId: 'user-1' }).subscribe((res) => {
      expect(res).toEqual(response);
      done();
    });

    const req = httpMock.expectOne((request) => request.url === `${apiUrl}/admin/billing/offers`);
    expect(req.request.params.get('limit')).toBe('10');
    expect(req.request.params.get('offset')).toBe('0');
    expect(req.request.params.get('search')).toBe('OFF-2026');
    expect(req.request.params.get('userId')).toBe('user-1');
    req.flush(response);
  });

  it('gets offer detail', (done) => {
    const detail: AdminOfferDetailResponse = {
      ...mockListItem,
      subtotalNet: 100,
      taxTotal: 19,
      billToOpenPositions: false,
      lineItems: [],
    };

    service.get('offer-1').subscribe((res) => {
      expect(res).toEqual(detail);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/admin/billing/offers/offer-1`);
    req.flush(detail);
  });

  it('creates offer', (done) => {
    const dto = {
      userId: 'user-1',
      currency: 'EUR',
      billToOpenPositions: false,
      lineItems: [],
    };

    service.create(dto).subscribe((res) => {
      expect(res.id).toBe('offer-1');
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/admin/billing/offers`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush({ ...mockListItem, subtotalNet: 0, taxTotal: 0, billToOpenPositions: false, lineItems: [] });
  });

  it('updates offer', (done) => {
    const dto = { currency: 'EUR', billToOpenPositions: true, lineItems: [] };

    service.update('offer-1', dto).subscribe((res) => {
      expect(res.id).toBe('offer-1');
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/admin/billing/offers/offer-1`);
    expect(req.request.method).toBe('PUT');
    req.flush({ ...mockListItem, subtotalNet: 0, taxTotal: 0, billToOpenPositions: true, lineItems: [] });
  });

  it('deletes offer', (done) => {
    service.delete('offer-1').subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/admin/billing/offers/offer-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('archives offer', (done) => {
    service.archive('offer-1').subscribe((res) => {
      expect(res.status).toBe('archived');
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/admin/billing/offers/offer-1/archive`);
    expect(req.request.method).toBe('POST');
    req.flush({
      ...mockListItem,
      status: 'archived',
      subtotalNet: 0,
      taxTotal: 0,
      billToOpenPositions: false,
      lineItems: [],
    });
  });

  it('revokes offer', (done) => {
    service.revoke('offer-1').subscribe((res) => {
      expect(res.status).toBe('revoked');
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/admin/billing/offers/offer-1/revoke`);
    req.flush({
      ...mockListItem,
      status: 'revoked',
      subtotalNet: 0,
      taxTotal: 0,
      billToOpenPositions: false,
      lineItems: [],
    });
  });

  it('gets statistics with filters', (done) => {
    const stats = {
      draftCount: 2,
      pendingCount: 3,
      pendingGross: 300,
      acceptedCount: 4,
      acceptedGross: 400,
      declinedCount: 1,
      expiredCount: 0,
      revokedCount: 0,
      series: [],
      from: '2026-01-01',
      to: '2026-12-31',
      groupBy: 'month' as const,
    };

    service
      .getStatistics({ from: '2026-01-01', to: '2026-12-31', groupBy: 'month', userId: 'user-1' })
      .subscribe((res) => {
        expect(res).toEqual(stats);
        done();
      });

    const req = httpMock.expectOne((request) => request.url === `${apiUrl}/admin/billing/offers/statistics`);
    expect(req.request.params.get('from')).toBe('2026-01-01');
    expect(req.request.params.get('to')).toBe('2026-12-31');
    expect(req.request.params.get('groupBy')).toBe('month');
    expect(req.request.params.get('userId')).toBe('user-1');
    req.flush(stats);
  });

  it('lists audit logs with pagination', (done) => {
    const response = { items: [], total: 0, limit: 20, offset: 0 };

    service.listAuditLogs('offer-1', { limit: 20, offset: 0 }).subscribe((res) => {
      expect(res).toEqual(response);
      done();
    });

    const req = httpMock.expectOne((request) => request.url === `${apiUrl}/admin/billing/offers/offer-1/audit-logs`);
    expect(req.request.params.get('limit')).toBe('20');
    expect(req.request.params.get('offset')).toBe('0');
    req.flush(response);
  });
});
