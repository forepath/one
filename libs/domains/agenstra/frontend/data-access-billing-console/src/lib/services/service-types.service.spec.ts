import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { CreateServiceTypeDto, ServiceTypeResponse, UpdateServiceTypeDto } from '../types/billing.types';

import { ServiceTypesService } from './service-types.service';

describe('ServiceTypesService', () => {
  let service: ServiceTypesService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';
  const mockServiceType: ServiceTypeResponse = {
    id: 'st-1',
    key: 'cursor',
    name: 'Cursor',
    provider: 'provider-1',
    configSchema: {},
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

    service = TestBed.inject(ServiceTypesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getProviderDetails', () => {
    it('should return provider details from GET /service-types/providers', (done) => {
      const mockProviders = [{ id: 'hetzner', displayName: 'Hetzner Cloud', configSchema: { required: ['location'] } }];

      service.getProviderDetails().subscribe((list) => {
        expect(list).toEqual(mockProviders);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-types/providers`);

      expect(req.request.method).toBe('GET');
      req.flush(mockProviders);
    });
  });

  describe('listServiceTypes', () => {
    it('should return service types array', (done) => {
      const mockList: ServiceTypeResponse[] = [mockServiceType];

      service.listServiceTypes().subscribe((list) => {
        expect(list).toEqual(mockList);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-types`);

      expect(req.request.method).toBe('GET');
      req.flush(mockList);
    });

    it('should include pagination parameters when provided', (done) => {
      const params = { limit: 10, offset: 20 };

      service.listServiceTypes(params).subscribe((list) => {
        expect(list).toEqual([mockServiceType]);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-types?limit=10&offset=20`);

      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.params.get('offset')).toBe('20');
      req.flush([mockServiceType]);
    });
  });

  describe('getServiceType', () => {
    it('should return a service type by id', (done) => {
      const id = 'st-1';

      service.getServiceType(id).subscribe((st) => {
        expect(st).toEqual(mockServiceType);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-types/${id}`);

      expect(req.request.method).toBe('GET');
      req.flush(mockServiceType);
    });
  });

  describe('createServiceType', () => {
    it('should create a new service type', (done) => {
      const createDto: CreateServiceTypeDto = {
        key: 'new',
        name: 'New Type',
        provider: 'p1',
      };

      service.createServiceType(createDto).subscribe((st) => {
        expect(st).toEqual(mockServiceType);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-types`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(createDto);
      req.flush(mockServiceType);
    });
  });

  describe('updateServiceType', () => {
    it('should update an existing service type', (done) => {
      const id = 'st-1';
      const updateDto: UpdateServiceTypeDto = { name: 'Updated Name' };

      service.updateServiceType(id, updateDto).subscribe((st) => {
        expect(st).toEqual({ ...mockServiceType, name: 'Updated Name' });
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-types/${id}`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(updateDto);
      req.flush({ ...mockServiceType, name: 'Updated Name' });
    });
  });

  describe('deleteServiceType', () => {
    it('should delete a service type', (done) => {
      const id = 'st-1';

      service.deleteServiceType(id).subscribe(() => done());

      const req = httpMock.expectOne(`${apiUrl}/service-types/${id}`);

      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });
});
