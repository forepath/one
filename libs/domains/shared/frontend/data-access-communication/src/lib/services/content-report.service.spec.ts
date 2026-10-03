import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { ContentReportService } from './content-report.service';

describe('ContentReportService', () => {
  let service: ContentReportService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        ContentReportService,
        {
          provide: ENVIRONMENT,
          useValue: {
            communication: {
              urls: {
                restApi: 'https://api.example.com/api',
              },
            },
          },
        },
      ],
    });

    service = TestBed.inject(ContentReportService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('posts multipart form data for a DSA report', () => {
    service
      .submit({
        reportType: 'dsa',
        turnstileToken: 'token',
        name: 'Alex',
        email: 'alex@example.com',
        contentUrls: 'https://example.com/1',
        explanation: 'Illegal',
        goodFaithConfirmed: true,
      })
      .subscribe();

    const req = httpMock.expectOne('https://api.example.com/api/public/content-reports');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeInstanceOf(FormData);
    expect((req.request.body as FormData).get('reportType')).toBe('dsa');
    req.flush({ accepted: true, referenceId: '9' });
  });
});
