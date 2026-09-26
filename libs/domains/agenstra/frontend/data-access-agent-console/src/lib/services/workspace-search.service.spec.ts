import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { WorkspaceSearchService } from './workspace-search.service';

describe('WorkspaceSearchService', () => {
  let service: WorkspaceSearchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        WorkspaceSearchService,
        {
          provide: ENVIRONMENT,
          useValue: { controller: { restApiUrl: 'http://controller.test/api' } },
        },
      ],
    });
    service = TestBed.inject(WorkspaceSearchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('getStatus hits status endpoint', () => {
    service.getStatus('c1', 'a1').subscribe((status) => {
      expect(status.status).toBe('ready');
    });
    const req = http.expectOne('http://controller.test/api/clients/c1/agents/a1/workspace-search/status');

    expect(req.request.method).toBe('GET');
    req.flush({ status: 'ready', docCount: 2 });
  });

  it('search appends include, exclude, and mode params', () => {
    service.search('c1', 'a1', 'foo', ['src'], ['dist'], 'files').subscribe();
    const req = http.expectOne(
      (r) =>
        r.url === 'http://controller.test/api/clients/c1/agents/a1/workspace-search' &&
        r.params.get('q') === 'foo' &&
        r.params.get('mode') === 'files' &&
        r.params.getAll('include')?.includes('src') &&
        r.params.getAll('exclude')?.includes('dist'),
    );

    expect(req.request.method).toBe('GET');
    req.flush({ status: 'ready', hits: [], total: 0 });
  });

  it('reindex posts to reindex endpoint', () => {
    service.reindex('c1', 'a1').subscribe((body) => {
      expect(body.accepted).toBe(true);
    });
    const req = http.expectOne('http://controller.test/api/clients/c1/agents/a1/workspace-search/reindex');

    expect(req.request.method).toBe('POST');
    req.flush({ accepted: true });
  });
});
