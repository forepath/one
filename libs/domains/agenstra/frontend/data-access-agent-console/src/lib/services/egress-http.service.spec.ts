import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';

import { OpencodeConfigService } from './opencode-config.service';
import { StatisticsService } from './statistics.service';

describe('Egress HTTP endpoints', () => {
  const apiUrl = 'http://localhost:3100/api';
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: ENVIRONMENT, useValue: { console: { urls: { restApi: apiUrl } } } }],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loads aggregate and client-scoped egress events with filters', () => {
    const service = TestBed.inject(StatisticsService);

    service.getEgressEvents({ clientId: 'c1', decision: 'blocked', kind: 'web', search: 'example' }).subscribe();
    const aggregate = httpMock.expectOne((request) => request.url === `${apiUrl}/statistics/egress-events`);

    expect(aggregate.request.params.get('clientId')).toBe('c1');
    expect(aggregate.request.params.get('decision')).toBe('blocked');
    expect(aggregate.request.params.get('kind')).toBe('web');
    expect(aggregate.request.params.get('search')).toBe('example');
    expect(aggregate.request.params.get('limit')).toBe('10');
    aggregate.flush({ data: [], total: 0, limit: 10, offset: 0 });

    service.getClientEgressEvents('c1', { clientId: 'c1', agentId: 'a1', offset: 20 }).subscribe();
    const scoped = httpMock.expectOne((request) => request.url === `${apiUrl}/clients/c1/statistics/egress-events`);

    expect(scoped.request.params.get('agentId')).toBe('a1');
    expect(scoped.request.params.get('offset')).toBe('20');
    expect(scoped.request.params.has('decision')).toBe(false);
    scoped.flush({ data: [], total: 0, limit: 10, offset: 20 });
  });

  it('reads the environment egress details and evaluates destinations', () => {
    const service = TestBed.inject(OpencodeConfigService);
    let evaluated: unknown;

    service.getAgentEgress('c1', 'a1').subscribe();
    httpMock.expectOne(`${apiUrl}/clients/c1/agents/a1/egress`).flush({ agentId: 'a1' });

    service.evaluateAgentEgress('c1', 'a1', 'https://example.org').subscribe((result) => (evaluated = result));
    const request = httpMock.expectOne(`${apiUrl}/clients/c1/agents/a1/egress/evaluate`);

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ destination: 'https://example.org' });
    request.flush({ host: 'example.org', decision: 'blocked', rule: 'deny_host', mode: 'enforce' });
    expect(evaluated).toEqual(expect.objectContaining({ decision: 'blocked' }));
  });
});
