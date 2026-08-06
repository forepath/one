import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { CreateMeterDto, MeterResponse, UpdateMeterDto } from '../types/billing.types';

import { MetersService } from './meters.service';

describe('MetersService', () => {
  let service: MetersService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';
  const mockMeter: MeterResponse = {
    id: 'meter-1',
    key: 'api_calls',
    name: 'API Calls',
    aggregator: 'max',
    defaultUnitPriceNet: 0.01,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
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

    service = TestBed.inject(MetersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listMeters', () => {
    it('lists meters', (done) => {
      service.listMeters().subscribe((list) => {
        expect(list).toEqual([mockMeter]);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/meters`);
      expect(req.request.method).toBe('GET');
      req.flush([mockMeter]);
    });

    it('includes pagination parameters when provided', (done) => {
      service.listMeters({ limit: 10, offset: 20 }).subscribe((list) => {
        expect(list).toEqual([mockMeter]);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/meters?limit=10&offset=20`);
      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.params.get('offset')).toBe('20');
      req.flush([mockMeter]);
    });
  });

  describe('getMeter', () => {
    it('returns a meter by id', (done) => {
      service.getMeter('meter-1').subscribe((meter) => {
        expect(meter).toEqual(mockMeter);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/meters/meter-1`);
      expect(req.request.method).toBe('GET');
      req.flush(mockMeter);
    });
  });

  describe('createMeter', () => {
    it('creates a meter', (done) => {
      const dto: CreateMeterDto = {
        key: 'api_calls',
        name: 'API Calls',
        aggregator: 'max',
        defaultUnitPriceNet: 0.01,
      };

      service.createMeter(dto).subscribe((meter) => {
        expect(meter).toEqual(mockMeter);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/meters`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(mockMeter);
    });
  });

  describe('updateMeter', () => {
    it('updates a meter', (done) => {
      const dto: UpdateMeterDto = { name: 'Updated' };

      service.updateMeter('meter-1', dto).subscribe((meter) => {
        expect(meter).toEqual(mockMeter);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/meters/meter-1`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(mockMeter);
    });
  });

  describe('deleteMeter', () => {
    it('deletes a meter', (done) => {
      service.deleteMeter('meter-1').subscribe((result) => {
        expect(result).toBeNull();
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/meters/meter-1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });
});
