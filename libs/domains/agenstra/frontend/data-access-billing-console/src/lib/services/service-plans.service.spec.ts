import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { CreateServicePlanDto, ServicePlanResponse, UpdateServicePlanDto } from '../types/billing.types';

import { ServicePlansService } from './service-plans.service';

describe('ServicePlansService', () => {
  let service: ServicePlansService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';
  const mockPlan: ServicePlanResponse = {
    id: 'sp-1',
    serviceTypeId: 'st-1',
    name: 'Basic',
    billingIntervalType: 'month',
    billingIntervalValue: 1,
    cancelAtPeriodEnd: false,
    minCommitmentDays: 0,
    noticeDays: 0,
    providerConfigDefaults: {},
    orderingHighlights: [],
    isActive: true,
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

    service = TestBed.inject(ServicePlansService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listServicePlans', () => {
    it('should return service plans array', (done) => {
      const mockList: ServicePlanResponse[] = [mockPlan];

      service.listServicePlans().subscribe((list) => {
        expect(list).toEqual(mockList);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-plans`);

      expect(req.request.method).toBe('GET');
      req.flush(mockList);
    });

    it('should include pagination parameters when provided', (done) => {
      const params = { limit: 10, offset: 20 };

      service.listServicePlans(params).subscribe((list) => {
        expect(list).toEqual([mockPlan]);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-plans?limit=10&offset=20`);

      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.params.get('offset')).toBe('20');
      req.flush([mockPlan]);
    });
  });

  describe('getServicePlan', () => {
    it('should return a service plan by id', (done) => {
      const id = 'sp-1';

      service.getServicePlan(id).subscribe((plan) => {
        expect(plan).toEqual(mockPlan);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-plans/${id}`);

      expect(req.request.method).toBe('GET');
      req.flush(mockPlan);
    });
  });

  describe('createServicePlan', () => {
    it('should create a new service plan', (done) => {
      const createDto: CreateServicePlanDto = {
        serviceTypeId: 'st-1',
        name: 'New Plan',
        billingIntervalType: 'month',
        billingIntervalValue: 1,
      };

      service.createServicePlan(createDto).subscribe((plan) => {
        expect(plan).toEqual(mockPlan);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-plans`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(createDto);
      req.flush(mockPlan);
    });
  });

  describe('updateServicePlan', () => {
    it('should update an existing service plan', (done) => {
      const id = 'sp-1';
      const updateDto: UpdateServicePlanDto = { name: 'Updated Name' };

      service.updateServicePlan(id, updateDto).subscribe((plan) => {
        expect(plan).toEqual({ ...mockPlan, name: 'Updated Name' });
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-plans/${id}`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(updateDto);
      req.flush({ ...mockPlan, name: 'Updated Name' });
    });
  });

  describe('deleteServicePlan', () => {
    it('should delete a service plan', (done) => {
      const id = 'sp-1';

      service.deleteServicePlan(id).subscribe(() => done());

      const req = httpMock.expectOne(`${apiUrl}/service-plans/${id}`);

      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });
});
