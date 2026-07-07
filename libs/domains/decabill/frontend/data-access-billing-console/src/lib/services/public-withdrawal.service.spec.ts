import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { PublicWithdrawalService } from './public-withdrawal.service';

describe('PublicWithdrawalService', () => {
  let service: PublicWithdrawalService;
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

    service = TestBed.inject(PublicWithdrawalService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getAddressee', () => {
    it('should GET public withdrawal addressee', (done) => {
      const mockAddressee = {
        name: 'Acme GmbH',
        lines: ['Example Street 1'],
        vatId: 'DE123456789',
        email: 'billing@example.com',
      };

      service.getAddressee().subscribe((addressee) => {
        expect(addressee).toEqual(mockAddressee);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/public/withdrawal/addressee`);

      expect(req.request.method).toBe('GET');
      req.flush(mockAddressee);
    });
  });

  describe('requestWithdrawal', () => {
    it('should POST withdrawal request', (done) => {
      const dto = {
        subscriptionNumber: 'SUB-000001',
        customerName: 'Jane Doe',
        email: 'jane@example.com',
        orderedOn: '2024-01-01',
      };
      const mockResponse = {
        requestId: 'req-1',
        resumed: false,
        resumeStep: 'code',
        message: 'Check your email',
      };

      service.requestWithdrawal(dto).subscribe((response) => {
        expect(response).toEqual(mockResponse);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/public/withdrawal/request`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(mockResponse);
    });
  });

  describe('verifyCode', () => {
    it('should POST verify-code', (done) => {
      const dto = { requestId: 'req-1', code: 'ABC123' };
      const mockResponse = { resumeStep: 'acknowledge', message: 'Verified' };

      service.verifyCode(dto).subscribe((response) => {
        expect(response).toEqual(mockResponse);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/public/withdrawal/verify-code`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(mockResponse);
    });
  });

  describe('confirmWithdrawal', () => {
    it('should POST confirm', (done) => {
      const dto = { requestId: 'req-1', acknowledgeWithdrawal: true as const };
      const mockResponse = { message: 'Withdrawal submitted' };

      service.confirmWithdrawal(dto).subscribe((response) => {
        expect(response).toEqual(mockResponse);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/public/withdrawal/confirm`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(mockResponse);
    });
  });
});
