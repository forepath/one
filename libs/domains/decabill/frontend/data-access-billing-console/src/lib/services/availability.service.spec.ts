import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type {
  AvailabilityCheckDto,
  AvailabilityResponse,
  PricingPreviewDto,
  PricingPreviewResponse,
} from '../types/billing.types';

import { AvailabilityService } from './availability.service';

describe('AvailabilityService', () => {
  let service: AvailabilityService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';
  const mockCheck: AvailabilityCheckDto = {
    serviceTypeId: 'st-1',
    region: 'eu',
    serverType: 'small',
  };
  const mockAvailability: AvailabilityResponse = {
    isAvailable: true,
    reason: 'Available',
  };
  const mockPricing: PricingPreviewResponse = {
    basePrice: 100,
    marginPercent: 10,
    marginFixed: 5,
    totalPrice: 115,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: { billing: { restApiUrl: apiUrl } },
        },
      ],
    });

    service = TestBed.inject(AvailabilityService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('checkAvailability', () => {
    it('should post check and return availability response', (done) => {
      service.checkAvailability(mockCheck).subscribe((response) => {
        expect(response).toEqual(mockAvailability);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/availability/check`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(mockCheck);
      req.flush(mockAvailability);
    });
  });

  describe('checkAvailabilityAlternatives', () => {
    it('should post check and return availability with alternatives', (done) => {
      const responseWithAlternatives: AvailabilityResponse = {
        ...mockAvailability,
        alternatives: { key: 'value' },
      };

      service.checkAvailabilityAlternatives(mockCheck).subscribe((response) => {
        expect(response).toEqual(responseWithAlternatives);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/availability/alternatives`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(mockCheck);
      req.flush(responseWithAlternatives);
    });
  });

  describe('previewPricing', () => {
    it('should post preview and return pricing response', (done) => {
      const preview: PricingPreviewDto = { planId: 'plan-1' };

      service.previewPricing(preview).subscribe((response) => {
        expect(response).toEqual(mockPricing);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/pricing/preview`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(preview);
      req.flush(mockPricing);
    });
  });
});
