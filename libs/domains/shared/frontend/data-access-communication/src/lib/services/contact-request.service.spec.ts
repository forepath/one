import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { PUBLIC_CONTACT_REQUESTS_PATH } from '../constants/contact-request.constants';
import type { ContactRequestResponse } from '../types/contact-request.types';

import { ContactRequestService } from './contact-request.service';

describe('ContactRequestService', () => {
  let service: ContactRequestService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3300/api';
  const mockResponse: ContactRequestResponse = {
    accepted: true,
    referenceId: 'ref-123',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: {
            communication: {
              restApiUrl: apiUrl,
              turnstileSiteKey: 'test-site-key',
            },
          },
        },
      ],
    });

    service = TestBed.inject(ContactRequestService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('submit', () => {
    it('should POST contact request payload', (done) => {
      const payload = {
        name: 'Jane Doe',
        email: 'jane@example.com',
        message: 'Hello',
        turnstileToken: 'token-abc',
        phone: '+49123456789',
        company: 'Example GmbH',
      };

      service.submit(payload).subscribe((response) => {
        expect(response).toEqual(mockResponse);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/${PUBLIC_CONTACT_REQUESTS_PATH}`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush(mockResponse);
    });
  });
});
