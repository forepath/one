import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { CustomerOfferDetailResponse, CustomerOfferListItem } from '../types/offers.types';

import { OffersService } from './offers.service';

describe('OffersService', () => {
  let service: OffersService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';

  const mockListItem: CustomerOfferListItem = {
    id: 'offer-1',
    offerNumber: 'OFF-2026-00001',
    status: 'archived',
    currency: 'EUR',
    totalGross: 119,
    expiresAt: '2026-12-31T23:59:59.000Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        OffersService,
        {
          provide: ENVIRONMENT,
          useValue: { billing: { restApiUrl: apiUrl } },
        },
      ],
    });
    service = TestBed.inject(OffersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('gets offers summary', (done) => {
    const summary = { pendingCount: 2, actionRequiredCount: 2, acceptedCount: 1, historyCount: 5 };

    service.getSummary().subscribe((res) => {
      expect(res).toEqual(summary);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/offers/summary`);
    expect(req.request.method).toBe('GET');
    req.flush(summary);
  });

  it('gets pending offers without search param when empty', (done) => {
    service.getPendingOffers().subscribe((res) => {
      expect(res).toEqual([mockListItem]);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/offers/pending`);
    expect(req.request.params.has('search')).toBe(false);
    req.flush([mockListItem]);
  });

  it('gets pending offers with trimmed search param', (done) => {
    service.getPendingOffers('  OFF-2026  ').subscribe((res) => {
      expect(res).toEqual([mockListItem]);
      done();
    });

    const req = httpMock.expectOne((request) => request.url === `${apiUrl}/offers/pending`);
    expect(req.request.params.get('search')).toBe('OFF-2026');
    req.flush([mockListItem]);
  });

  it('gets history offers with search param', (done) => {
    const historyItem = { ...mockListItem, status: 'accepted' as const };

    service.getHistoryOffers('customer@example.com').subscribe((res) => {
      expect(res).toEqual([historyItem]);
      done();
    });

    const req = httpMock.expectOne((request) => request.url === `${apiUrl}/offers/history`);
    expect(req.request.params.get('search')).toBe('customer@example.com');
    req.flush([historyItem]);
  });

  it('gets offer detail', (done) => {
    const detail: CustomerOfferDetailResponse = {
      ...mockListItem,
      subtotalNet: 100,
      taxTotal: 19,
      billToOpenPositions: false,
      lineItems: [],
    };

    service.getOffer('offer-1').subscribe((res) => {
      expect(res).toEqual(detail);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/offers/offer-1`);
    req.flush(detail);
  });

  it('downloads offer pdf as blob', (done) => {
    const blob = new Blob(['pdf']);

    service.downloadOfferPdf('offer-1').subscribe((res) => {
      expect(res).toEqual(blob);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/offers/offer-1/pdf`);
    expect(req.request.responseType).toBe('blob');
    req.flush(blob);
  });

  it('accepts offer', (done) => {
    const accepted = { ...mockListItem, status: 'accepted' as const };

    service.acceptOffer('offer-1').subscribe((res) => {
      expect(res).toEqual(accepted);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/offers/offer-1/accept`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(accepted);
  });

  it('declines offer', (done) => {
    const declined = { ...mockListItem, status: 'declined' as const };

    service.declineOffer('offer-1').subscribe((res) => {
      expect(res).toEqual(declined);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/offers/offer-1/decline`);
    expect(req.request.method).toBe('POST');
    req.flush(declined);
  });
});
