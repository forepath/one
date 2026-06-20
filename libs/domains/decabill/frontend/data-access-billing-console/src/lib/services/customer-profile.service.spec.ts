import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { CustomerProfileDto, CustomerProfileResponse } from '../types/billing.types';

import { CustomerProfileService } from './customer-profile.service';

describe('CustomerProfileService', () => {
  let service: CustomerProfileService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';
  const mockProfile: CustomerProfileResponse = {
    id: 'cp-1',
    userId: 'user-1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
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

    service = TestBed.inject(CustomerProfileService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getCustomerProfile', () => {
    it('should return the current user customer profile', (done) => {
      service.getCustomerProfile().subscribe((profile) => {
        expect(profile).toEqual(mockProfile);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/customer-profile`);

      expect(req.request.method).toBe('GET');
      req.flush(mockProfile);
    });
  });

  describe('updateCustomerProfile', () => {
    it('should post profile and return updated customer profile', (done) => {
      const dto: CustomerProfileDto = { firstName: 'Jane' };
      const updated = { ...mockProfile, firstName: 'Jane' };

      service.updateCustomerProfile(dto).subscribe((profile) => {
        expect(profile).toEqual(updated);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/customer-profile`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(updated);
    });
  });
});
