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
    billInAdvance: false,
    autoRecalculatePriceDaily: false,
    minCommitmentDays: 0,
    noticeDays: 0,
    providerConfigDefaults: {},
    orderingHighlights: [],
    allowCustomerLocationSelection: false,
    allowCustomerServerTypeSelection: false,
    allowedServerTypes: [],
    withdrawalPolicy: {
      periodDays: 14,
      allowedAfterProvisioning: true,
      unprovisionedAlwaysWithdrawable: true,
      provisionedRefundPolicy: 'unused_period_prorated',
    },
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

  describe('getOrderProvisioningOptions', () => {
    it('should return order provisioning options for a plan', (done) => {
      const options = [
        {
          optionKey: 'integrated:agenstra-controller',
          type: 'integrated',
          service: 'agenstra-controller',
          label: 'Agenstra Controller',
        },
      ];

      service.getOrderProvisioningOptions('sp-1').subscribe((result) => {
        expect(result).toEqual(options);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-plans/sp-1/order-provisioning-options`);

      expect(req.request.method).toBe('GET');
      req.flush(options);
    });
  });

  it('fetches plan-scoped cloud init order fields', (done) => {
    service.getCloudInitOrderFields('sp-1', 'cfg-1').subscribe((fields) => {
      expect(fields).toEqual([{ key: 'API_KEY', label: 'API Key', required: true, hasDefault: false }]);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/service-plans/sp-1/cloud-init-configs/cfg-1/order-fields`);
    expect(req.request.method).toBe('GET');
    req.flush([{ key: 'API_KEY', label: 'API Key', required: true, hasDefault: false }]);
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

  describe('getOrderAddons', () => {
    it('should return plan addon options', (done) => {
      const options = [
        {
          id: 'addon-1',
          key: 'backup',
          name: 'Backup',
          implementationType: 'module' as const,
          periodPrice: 1,
          orderFields: [{ key: 'REGION', label: 'Region', required: true, hasDefault: false }],
        },
      ];

      service.getOrderAddons('sp-1').subscribe((result) => {
        expect(result).toEqual(options);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-plans/sp-1/addons`);
      expect(req.request.method).toBe('GET');
      req.flush(options);
    });
  });

  describe('plan meters', () => {
    const attachedMeter = {
      meterId: 'meter-1',
      key: 'api_calls',
      name: 'API Calls',
      aggregator: 'max' as const,
      defaultUnitPriceNet: 0.01,
      effectiveUnitPriceNet: 0.01,
      isActive: true,
    };

    it('lists plan meters', (done) => {
      service.listPlanMeters('sp-1').subscribe((meters) => {
        expect(meters).toEqual([attachedMeter]);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-plans/sp-1/meters`);
      expect(req.request.method).toBe('GET');
      req.flush([attachedMeter]);
    });

    it('attaches a plan meter', (done) => {
      service.attachPlanMeter('sp-1', { meterId: 'meter-1', unitPriceNet: 0.02 }).subscribe((meter) => {
        expect(meter).toEqual({ ...attachedMeter, effectiveUnitPriceNet: 0.02 });
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-plans/sp-1/meters`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ meterId: 'meter-1', unitPriceNet: 0.02 });
      req.flush({ ...attachedMeter, effectiveUnitPriceNet: 0.02 });
    });

    it('updates a plan meter override', (done) => {
      service.updatePlanMeter('sp-1', 'meter-1', { unitPriceNet: 0.03 }).subscribe((meter) => {
        expect(meter.effectiveUnitPriceNet).toBe(0.03);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-plans/sp-1/meters/meter-1`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ unitPriceNet: 0.03 });
      req.flush({ ...attachedMeter, effectiveUnitPriceNet: 0.03 });
    });

    it('detaches a plan meter', (done) => {
      service.detachPlanMeter('sp-1', 'meter-1').subscribe(() => done());

      const req = httpMock.expectOne(`${apiUrl}/service-plans/sp-1/meters/meter-1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });
});
