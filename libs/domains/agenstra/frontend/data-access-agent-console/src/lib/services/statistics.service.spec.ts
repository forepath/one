import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type {
  StatisticsChatIoListDto,
  StatisticsEntityEventListDto,
  StatisticsFilterDropListDto,
  StatisticsSummaryDto,
} from '../state/statistics/statistics.types';

import { StatisticsService } from './statistics.service';

describe('StatisticsService', () => {
  let service: StatisticsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3100/api';
  const mockSummary: StatisticsSummaryDto = {
    totalMessages: 100,
    totalWords: 500,
    totalChars: 2500,
    avgWordsPerMessage: 5,
    filterDropCount: 2,
    filterTypesBreakdown: [],
    filterFlagCount: 0,
    filterFlagsBreakdown: [],
  };
  const mockChatIoList: StatisticsChatIoListDto = {
    data: [],
    total: 0,
    limit: 10,
    offset: 0,
  };
  const mockFilterDropList: StatisticsFilterDropListDto = {
    data: [],
    total: 0,
    limit: 10,
    offset: 0,
  };
  const mockEntityEventList: StatisticsEntityEventListDto = {
    data: [],
    total: 0,
    limit: 10,
    offset: 0,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: {
            controller: {
              restApiUrl: apiUrl,
            },
          },
        },
      ],
    });

    service = TestBed.inject(StatisticsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getClientSummary', () => {
    it('should return summary for client', (done) => {
      const clientId = 'client-1';

      service.getClientSummary(clientId).subscribe((summary) => {
        expect(summary).toEqual(mockSummary);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/statistics/summary`);

      expect(req.request.method).toBe('GET');
      req.flush(mockSummary);
    });

    it('should include query params when provided', (done) => {
      const clientId = 'client-1';
      const params = { from: '2024-01-01', to: '2024-01-31', groupBy: 'day' as const };

      service.getClientSummary(clientId, params).subscribe((summary) => {
        expect(summary).toEqual(mockSummary);
        done();
      });

      const req = httpMock.expectOne(
        `${apiUrl}/clients/${clientId}/statistics/summary?from=2024-01-01&to=2024-01-31&groupBy=day`,
      );

      expect(req.request.method).toBe('GET');
      req.flush(mockSummary);
    });
  });

  describe('getClientChatIo', () => {
    it('should return chat I/O for client', (done) => {
      const clientId = 'client-1';
      const params = { clientId, limit: 10, offset: 0 };

      service.getClientChatIo(clientId, params).subscribe((data) => {
        expect(data).toEqual(mockChatIoList);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/statistics/chat-io?limit=10&offset=0`);

      expect(req.request.method).toBe('GET');
      req.flush(mockChatIoList);
    });

    it('should include search param when provided', (done) => {
      const clientId = 'client-1';
      const params = { clientId, search: 'input', limit: 10, offset: 0 };

      service.getClientChatIo(clientId, params).subscribe((data) => {
        expect(data).toEqual(mockChatIoList);
        done();
      });

      const req = httpMock.expectOne((r) => r.params.get('search') === 'input');

      expect(req.request.method).toBe('GET');
      req.flush(mockChatIoList);
    });
  });

  describe('getClientFilterDrops', () => {
    it('should return filter drops for client', (done) => {
      const clientId = 'client-1';
      const params = { clientId, limit: 10, offset: 0 };

      service.getClientFilterDrops(clientId, params).subscribe((data) => {
        expect(data).toEqual(mockFilterDropList);
        done();
      });

      const req = httpMock.expectOne((r) => r.url.startsWith(`${apiUrl}/clients/${clientId}/statistics/filter-drops`));

      expect(req.request.method).toBe('GET');
      req.flush(mockFilterDropList);
    });

    it('should include search param when provided', (done) => {
      const clientId = 'client-1';
      const params = { clientId, search: 'profanity', limit: 10, offset: 0 };

      service.getClientFilterDrops(clientId, params).subscribe((data) => {
        expect(data).toEqual(mockFilterDropList);
        done();
      });

      const req = httpMock.expectOne((r) => r.params.get('search') === 'profanity');

      expect(req.request.method).toBe('GET');
      req.flush(mockFilterDropList);
    });
  });

  describe('getClientEntityEvents', () => {
    it('should return entity events for client', (done) => {
      const clientId = 'client-1';
      const params = { clientId, limit: 10, offset: 0 };

      service.getClientEntityEvents(clientId, params).subscribe((data) => {
        expect(data).toEqual(mockEntityEventList);
        done();
      });

      const req = httpMock.expectOne((r) => r.url.startsWith(`${apiUrl}/clients/${clientId}/statistics/entity-events`));

      expect(req.request.method).toBe('GET');
      req.flush(mockEntityEventList);
    });

    it('should include search param when provided', (done) => {
      const clientId = 'client-1';
      const params = { clientId, search: 'agent', limit: 10, offset: 0 };

      service.getClientEntityEvents(clientId, params).subscribe((data) => {
        expect(data).toEqual(mockEntityEventList);
        done();
      });

      const req = httpMock.expectOne((r) => r.params.get('search') === 'agent');

      expect(req.request.method).toBe('GET');
      req.flush(mockEntityEventList);
    });
  });

  describe('getSummary (aggregate)', () => {
    it('should return aggregate summary', (done) => {
      service.getSummary().subscribe((summary) => {
        expect(summary).toEqual(mockSummary);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/statistics/summary`);

      expect(req.request.method).toBe('GET');
      req.flush(mockSummary);
    });

    it('should include clientId filter when provided', (done) => {
      service.getSummary({ clientId: 'client-1' }).subscribe((summary) => {
        expect(summary).toEqual(mockSummary);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/statistics/summary?clientId=client-1`);

      expect(req.request.method).toBe('GET');
      req.flush(mockSummary);
    });
  });

  describe('getChatIo (aggregate)', () => {
    it('should return aggregate chat I/O', (done) => {
      service.getChatIo().subscribe((data) => {
        expect(data).toEqual(mockChatIoList);
        done();
      });

      const req = httpMock.expectOne((r) => r.url.startsWith(`${apiUrl}/statistics/chat-io`));

      expect(req.request.method).toBe('GET');
      req.flush(mockChatIoList);
    });

    it('should include search param when provided', (done) => {
      service.getChatIo({ search: 'output' }).subscribe((data) => {
        expect(data).toEqual(mockChatIoList);
        done();
      });

      const req = httpMock.expectOne((r) => r.params.get('search') === 'output');

      expect(req.request.method).toBe('GET');
      req.flush(mockChatIoList);
    });
  });

  describe('getFilterDrops (aggregate)', () => {
    it('should return aggregate filter drops', (done) => {
      service.getFilterDrops().subscribe((data) => {
        expect(data).toEqual(mockFilterDropList);
        done();
      });

      const req = httpMock.expectOne((r) => r.url.startsWith(`${apiUrl}/statistics/filter-drops`));

      expect(req.request.method).toBe('GET');
      req.flush(mockFilterDropList);
    });

    it('should include search param when provided', (done) => {
      service.getFilterDrops({ search: 'spam' }).subscribe((data) => {
        expect(data).toEqual(mockFilterDropList);
        done();
      });

      const req = httpMock.expectOne((r) => r.params.get('search') === 'spam');

      expect(req.request.method).toBe('GET');
      req.flush(mockFilterDropList);
    });
  });

  describe('getEntityEvents (aggregate)', () => {
    it('should return aggregate entity events', (done) => {
      service.getEntityEvents().subscribe((data) => {
        expect(data).toEqual(mockEntityEventList);
        done();
      });

      const req = httpMock.expectOne((r) => r.url.startsWith(`${apiUrl}/statistics/entity-events`));

      expect(req.request.method).toBe('GET');
      req.flush(mockEntityEventList);
    });

    it('should include search param when provided', (done) => {
      service.getEntityEvents({ search: 'created' }).subscribe((data) => {
        expect(data).toEqual(mockEntityEventList);
        done();
      });

      const req = httpMock.expectOne((r) => r.params.get('search') === 'created');

      expect(req.request.method).toBe('GET');
      req.flush(mockEntityEventList);
    });
  });
});
