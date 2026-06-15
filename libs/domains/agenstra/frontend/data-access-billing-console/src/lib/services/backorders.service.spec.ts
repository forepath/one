import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { BackorderCancelDto, BackorderResponse, BackorderRetryDto } from '../types/billing.types';

import { BackordersService } from './backorders.service';

describe('BackordersService', () => {
  let service: BackordersService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';
  const mockBackorder: BackorderResponse = {
    id: 'bo-1',
    userId: 'user-1',
    serviceTypeId: 'st-1',
    planId: 'plan-1',
    status: 'pending',
    requestedConfigSnapshot: {},
    providerErrors: {},
    preferredAlternatives: {},
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

    service = TestBed.inject(BackordersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listBackorders', () => {
    it('should return backorders array', (done) => {
      const mockList: BackorderResponse[] = [mockBackorder];

      service.listBackorders().subscribe((list) => {
        expect(list).toEqual(mockList);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/backorders`);

      expect(req.request.method).toBe('GET');
      req.flush(mockList);
    });

    it('should include pagination parameters when provided', (done) => {
      const params = { limit: 10, offset: 20 };

      service.listBackorders(params).subscribe((list) => {
        expect(list).toEqual([mockBackorder]);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/backorders?limit=10&offset=20`);

      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.params.get('offset')).toBe('20');
      req.flush([mockBackorder]);
    });
  });

  describe('retryBackorder', () => {
    it('should post retry and return backorder', (done) => {
      const id = 'bo-1';
      const dto: BackorderRetryDto = { reason: 'retry' };

      service.retryBackorder(id, dto).subscribe((backorder) => {
        expect(backorder).toEqual({ ...mockBackorder, status: 'retrying' });
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/backorders/${id}/retry`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush({ ...mockBackorder, status: 'retrying' });
    });

    it('should send empty object when dto not provided', (done) => {
      const id = 'bo-1';

      service.retryBackorder(id).subscribe(() => done());

      const req = httpMock.expectOne(`${apiUrl}/backorders/${id}/retry`);

      expect(req.request.body).toEqual({});
      req.flush(mockBackorder);
    });
  });

  describe('cancelBackorder', () => {
    it('should post cancel and return backorder', (done) => {
      const id = 'bo-1';
      const dto: BackorderCancelDto = { reason: 'cancel' };

      service.cancelBackorder(id, dto).subscribe((backorder) => {
        expect(backorder).toEqual({ ...mockBackorder, status: 'cancelled' });
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/backorders/${id}/cancel`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush({ ...mockBackorder, status: 'cancelled' });
    });
  });
});
