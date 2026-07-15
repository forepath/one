import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { CreateUsageRecordDto, UsageRecordResponse, UsageSummary } from '../types/billing.types';

import { UsageService } from './usage.service';

describe('UsageService', () => {
  let service: UsageService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';
  const subscriptionId = 'sub-1';
  const mockSummary: UsageSummary = {
    subscriptionId: 'sub-1',
    periodStart: '2024-01-01',
    periodEnd: '2024-01-31',
    usagePayload: { key: 'value' },
  };
  const mockRecord: UsageRecordResponse = {
    id: 'rec-1',
    subscriptionId: 'sub-1',
    periodStart: '2024-01-01',
    periodEnd: '2024-01-31',
    usageSource: 'api',
    usagePayload: {},
    createdAt: '2024-01-01T00:00:00Z',
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

    service = TestBed.inject(UsageService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getUsageSummary', () => {
    it('should return usage summary for a subscription', (done) => {
      service.getUsageSummary(subscriptionId).subscribe((summary) => {
        expect(summary).toEqual(mockSummary);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/usage/summary/${subscriptionId}`);

      expect(req.request.method).toBe('GET');
      req.flush(mockSummary);
    });
  });

  describe('recordUsage', () => {
    it('should post usage record and return response', (done) => {
      const dto: CreateUsageRecordDto = {
        subscriptionId: 'sub-1',
        periodStart: '2024-01-01',
        periodEnd: '2024-01-31',
        usagePayload: {},
      };

      service.recordUsage(dto).subscribe((record) => {
        expect(record).toEqual(mockRecord);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/admin/usage/record`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(mockRecord);
    });
  });
});
