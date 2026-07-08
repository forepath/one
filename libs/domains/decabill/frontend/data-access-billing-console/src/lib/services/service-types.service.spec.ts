import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { ProviderLocation, ServerType } from '../types/billing.types';

import { ServiceTypesService } from './service-types.service';

describe('ServiceTypesService', () => {
  let service: ServiceTypesService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';

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

  describe('getProviderServerTypes', () => {
    it('should pass serviceTypeId as query parameter', (done) => {
      const mockTypes: ServerType[] = [{ id: 'cx11', name: 'CX11', cores: 2, memory: 4, disk: 40, priceMonthly: 4.15 }];

      service.getProviderServerTypes('hetzner', 'st-1').subscribe((types) => {
        expect(types).toEqual(mockTypes);
        done();
      });

      const req = httpMock.expectOne(
        (request) => request.url === `${apiUrl}/service-types/providers/hetzner/server-types`,
      );

      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('serviceTypeId')).toBe('st-1');
      req.flush(mockTypes);
    });

    it('should normalize numeric-keyed object responses', (done) => {
      service.getProviderServerTypes('hetzner').subscribe((types) => {
        expect(types).toEqual([{ id: 'cx11', name: 'CX11', cores: 2, memory: 4, disk: 40, priceMonthly: 4.15 }]);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/service-types/providers/hetzner/server-types`);

      req.flush({
        '0': { id: 'cx11', name: 'CX11', cores: 2, memory: 4, disk: 40, priceMonthly: 4.15 },
      });
    });
  });

  describe('getProviderLocations', () => {
    it('should fetch locations with optional serviceTypeId', (done) => {
      const mockLocations: ProviderLocation[] = [{ id: 'fsn1', name: 'Falkenstein', country: 'DE' }];

      service.getProviderLocations('hetzner', 'st-1').subscribe((locations) => {
        expect(locations).toEqual(mockLocations);
        done();
      });

      const req = httpMock.expectOne(
        (request) => request.url === `${apiUrl}/service-types/providers/hetzner/locations`,
      );

      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('serviceTypeId')).toBe('st-1');
      req.flush(mockLocations);
    });
  });
});
