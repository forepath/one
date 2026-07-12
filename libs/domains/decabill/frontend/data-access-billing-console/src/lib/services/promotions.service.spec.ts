import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { PromotionsService } from './promotions.service';

describe('PromotionsService', () => {
  let service: PromotionsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';

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

    service = TestBed.inject(PromotionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('validates promotion codes', (done) => {
    const dto = { code: 'SAVE10', redemptionContext: 'new' as const, planId: 'plan-1' };
    const response = { valid: true, code: 'SAVE10' };

    service.validate(dto).subscribe((result) => {
      expect(result).toEqual(response);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/promotions/validate`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush(response);
  });

  it('redeems promotion codes', (done) => {
    const dto = {
      code: 'SAVE10',
      redemptionContext: 'existing' as const,
      subscriptionId: 'sub-1',
      benefitStartsAt: '2026-01-01T00:00:00.000Z',
    };
    const response = { id: 'red-1', code: 'SAVE10' };

    service.redeem(dto).subscribe((result) => {
      expect(result).toEqual(response);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/promotions/redeem`);
    expect(req.request.body).toEqual(dto);
    req.flush(response);
  });

  it('lists active and historical redemptions with params', (done) => {
    const response = { items: [], total: 0, limit: 10, offset: 0 };

    service.listActive({ limit: 10, offset: 0 }).subscribe((result) => {
      expect(result).toEqual(response);
      done();
    });

    const req = httpMock.expectOne((request) => request.url === `${apiUrl}/promotions/active`);
    expect(req.request.params.get('limit')).toBe('10');
    expect(req.request.params.get('offset')).toBe('0');
    req.flush(response);
  });
});
