import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';

import type { CreateSubscriptionDto, SubscriptionResponse } from '../types/billing.types';
import type {
  ConfigChangeEligibility,
  ConfigChangePreviewResponse,
  ConfigChangeRequest,
  ConfigChangeResponse,
} from '../types/config-change.types';

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
              urls: {
                restApi: apiUrl,
              },
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

  describe('withdrawSubscription', () => {
    it('should withdraw a subscription', (done) => {
      const id = 'sub-1';
      const dto = { reason: 'test' };

      service.withdrawSubscription(id, dto).subscribe((subscription) => {
        expect(subscription).toEqual({ ...mockSubscription, status: 'canceled' });
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/${id}/withdraw`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush({ ...mockSubscription, status: 'canceled' });
    });

    it('should send empty object when dto not provided', (done) => {
      const id = 'sub-1';

      service.withdrawSubscription(id).subscribe(() => done());

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/${id}/withdraw`);

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

  describe('getConfigChangeEligibility', () => {
    it('should return eligibility for a subscription', (done) => {
      const id = 'sub-1';
      const eligibility: ConfigChangeEligibility = {
        canRequestChange: true,
        hasPendingChange: false,
        currentServerType: 'cx22',
        allowedServerTypes: ['cx22', 'cx32'],
        supportsServerTypeUpgrade: true,
        supportsServerTypeDowngrade: false,
        availableAddonIds: ['addon-2'],
        activeAddonIds: ['addon-1'],
      };

      service.getConfigChangeEligibility(id).subscribe((response) => {
        expect(response).toEqual(eligibility);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/${id}/config-change/eligibility`);

      expect(req.request.method).toBe('GET');
      req.flush(eligibility);
    });
  });

  describe('previewConfigChange', () => {
    it('should post the change request and return the preview', (done) => {
      const id = 'sub-1';
      const request: ConfigChangeRequest = { serverType: 'cx32', addAddonIds: ['addon-2'] };
      const preview: ConfigChangePreviewResponse = {
        eligibility: {
          canRequestChange: true,
          hasPendingChange: false,
          allowedServerTypes: ['cx22', 'cx32'],
          supportsServerTypeUpgrade: true,
          supportsServerTypeDowngrade: true,
          availableAddonIds: [],
          activeAddonIds: ['addon-1'],
        },
        amounts: {
          currency: 'EUR',
          currentPeriodNet: 10,
          newPeriodNet: 15,
          periodDeltaNet: 5,
          immediateAdjustmentNet: 2.5,
          remainingPeriodRatio: 0.5,
        },
        disclaimer: { kind: 'charge', effectiveAt: '2024-02-01T00:00:00Z', notes: ['Prorated charge applies.'] },
        discounts: [],
      };

      service.previewConfigChange(id, request).subscribe((response) => {
        expect(response).toEqual(preview);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/${id}/config-change/preview`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(request);
      req.flush(preview);
    });
  });

  describe('submitConfigChange', () => {
    it('should post the change request and return the run', (done) => {
      const id = 'sub-1';
      const request: ConfigChangeRequest = { removeAddonIds: ['addon-1'] };
      const result: ConfigChangeResponse = {
        id: 'run-1',
        status: 'pending',
        appliedSteps: [],
        requestedAt: '2024-01-01T00:00:00Z',
      };

      service.submitConfigChange(id, request).subscribe((response) => {
        expect(response).toEqual(result);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/subscriptions/${id}/config-change`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(request);
      req.flush(result);
    });
  });
});
