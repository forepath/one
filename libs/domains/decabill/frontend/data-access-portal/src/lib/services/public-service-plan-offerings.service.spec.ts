import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { PublicServicePlanOffering } from '../types/portal-service-plans.types';

import { PublicServicePlanOfferingsService } from './public-service-plan-offerings.service';

describe('PublicServicePlanOfferingsService', () => {
  let service: PublicServicePlanOfferingsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';
  const mockOffering: PublicServicePlanOffering = {
    id: 'sp-1',
    name: 'Basic',
    description: null,
    serviceTypeId: 'st-1',
    serviceTypeName: 'Cloud',
    billingIntervalType: 'month',
    billingIntervalValue: 1,
    billInAdvance: false,
    totalPrice: 99,
    totalGross: 117.81,
    taxRate: 19,
    orderingHighlights: [],
    allowCustomerServerTypeSelection: false,
    withdrawalPolicy: {
      periodDays: 14,
      allowedAfterProvisioning: true,
      unprovisionedAlwaysWithdrawable: true,
      provisionedRefundPolicy: 'unused_period_prorated',
    },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: {
            billing: {
              restApiUrl: apiUrl,
            },
          },
        },
      ],
    });

    service = TestBed.inject(PublicServicePlanOfferingsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listOfferings', () => {
    it('should return offerings array', (done) => {
      const mockList: PublicServicePlanOffering[] = [mockOffering];

      service.listOfferings().subscribe((list) => {
        expect(list).toEqual(mockList);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/public/service-plan-offerings`);

      expect(req.request.method).toBe('GET');
      req.flush(mockList);
    });

    it('should include pagination and serviceTypeId when provided', (done) => {
      service.listOfferings({ limit: 10, offset: 20, serviceTypeId: 'st-x' }).subscribe((list) => {
        expect(list).toEqual([mockOffering]);
        done();
      });

      const req = httpMock.expectOne(
        (r) =>
          r.url === `${apiUrl}/public/service-plan-offerings` &&
          r.params.get('limit') === '10' &&
          r.params.get('offset') === '20' &&
          r.params.get('serviceTypeId') === 'st-x',
      );

      expect(req.request.method).toBe('GET');
      req.flush([mockOffering]);
    });
  });

  describe('getCheapestOffering', () => {
    it('should return cheapest offering', (done) => {
      service.getCheapestOffering().subscribe((offering) => {
        expect(offering).toEqual(mockOffering);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/public/service-plan-offerings/cheapest`);

      expect(req.request.method).toBe('GET');
      req.flush(mockOffering);
    });

    it('should pass serviceTypeId query when provided', (done) => {
      service.getCheapestOffering('st-x').subscribe((offering) => {
        expect(offering).toEqual(mockOffering);
        done();
      });

      const req = httpMock.expectOne(
        (r) => r.url === `${apiUrl}/public/service-plan-offerings/cheapest` && r.params.get('serviceTypeId') === 'st-x',
      );

      req.flush(mockOffering);
    });
  });
});
