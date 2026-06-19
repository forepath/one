import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { CreateSubscriptionDto, SubscriptionResponse } from '../types/billing.types';

import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';
  const mockSubscription: SubscriptionResponse = {
    id: 'sub-1',
    planId: 'plan-1',
    userId: 'user-1',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
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

    service = TestBed.inject(SubscriptionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listSubscriptions', () => {
    it('should return subscriptions array', (done) => {
      const mockSubscriptions: SubscriptionResponse[] = [mockSubscription];

      service.listSubscriptions().subscribe((subscriptions) => {
        expect(subscriptions).toEqual(mockSubscriptions);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions`);

      expect(req.request.method).toBe('GET');
      req.flush(mockSubscriptions);
    });

    it('should include pagination parameters when provided', (done) => {
      const params = { limit: 10, offset: 20 };
      const mockSubscriptions: SubscriptionResponse[] = [mockSubscription];

      service.listSubscriptions(params).subscribe((subscriptions) => {
        expect(subscriptions).toEqual(mockSubscriptions);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions?limit=10&offset=20`);

      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.params.get('offset')).toBe('20');
      req.flush(mockSubscriptions);
    });
  });

  describe('getSubscription', () => {
    it('should return a subscription by id', (done) => {
      const id = 'sub-1';

      service.getSubscription(id).subscribe((subscription) => {
        expect(subscription).toEqual(mockSubscription);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/${id}`);

      expect(req.request.method).toBe('GET');
      req.flush(mockSubscription);
    });
  });

  describe('createSubscription', () => {
    it('should create a new subscription', (done) => {
      const createDto: CreateSubscriptionDto = { planId: 'plan-1' };

      service.createSubscription(createDto).subscribe((subscription) => {
        expect(subscription).toEqual(mockSubscription);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(createDto);
      req.flush(mockSubscription);
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel a subscription', (done) => {
      const id = 'sub-1';
      const dto = { reason: 'test' };

      service.cancelSubscription(id, dto).subscribe((subscription) => {
        expect(subscription).toEqual({ ...mockSubscription, status: 'canceled' });
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/${id}/cancel`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush({ ...mockSubscription, status: 'canceled' });
    });

    it('should send empty object when dto not provided', (done) => {
      const id = 'sub-1';

      service.cancelSubscription(id).subscribe(() => done());

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/${id}/cancel`);

      expect(req.request.body).toEqual({});
      req.flush(mockSubscription);
    });
  });

  describe('resumeSubscription', () => {
    it('should resume a subscription', (done) => {
      const id = 'sub-1';
      const dto = { reason: 'test' };

      service.resumeSubscription(id, dto).subscribe((subscription) => {
        expect(subscription).toEqual(mockSubscription);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/${id}/resume`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(mockSubscription);
    });
  });
});
