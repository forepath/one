import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';

import { AgentGraphsService } from './agent-graphs.service';

describe('AgentGraphsService', () => {
  const apiUrl = 'http://localhost:3100/api';
  const graphUrl = `${apiUrl}/clients/c1/agents/a1/graph`;
  let service: AgentGraphsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: ENVIRONMENT, useValue: { console: { urls: { restApi: apiUrl } } } }],
    });
    service = TestBed.inject(AgentGraphsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('reads status and overview of an environment', () => {
    service.getStatus('c1', 'a1').subscribe();
    service.getOverview('c1', 'a1').subscribe();

    httpMock.expectOne((r) => r.url === `${graphUrl}/status` && r.method === 'GET').flush({});
    httpMock.expectOne((r) => r.url === `${graphUrl}/overview` && r.method === 'GET').flush({});
  });

  it('loads a document with layer, limit and types (omitting unset params)', () => {
    service.getDocument('c1', 'a1', { layer: 'paths', limit: 2000, types: ['file', 'directory'] }).subscribe();
    service.getDocument('c1', 'a1').subscribe();

    const [full, plain] = httpMock.match((r) => r.url === graphUrl);

    expect(full.request.params.get('layer')).toBe('paths');
    expect(full.request.params.get('limit')).toBe('2000');
    expect(full.request.params.get('types')).toBe('file,directory');
    expect(plain.request.params.keys()).toEqual([]);
    full.flush({});
    plain.flush({});
  });

  it('searches and passes node ids as query parameters', () => {
    service.search('c1', 'a1', { query: 'auth', layer: 'code', limit: 20 }).subscribe();
    service.getNode('c1', 'a1', 'symbol:src/a.ts#Foo', 'code').subscribe();
    service.getNeighbors('c1', 'a1', 'file:src/a.ts', { layer: 'code', depth: 2, limit: 100 }).subscribe();
    service.getPath('c1', 'a1', 'file:a', 'file:b').subscribe();
    service.getFile('c1', 'a1', 'src/a.ts').subscribe();

    const search = httpMock.expectOne((r) => r.url === `${graphUrl}/search`);

    expect(search.request.params.get('query')).toBe('auth');
    expect(search.request.params.get('layer')).toBe('code');
    expect(search.request.params.get('limit')).toBe('20');
    expect(search.request.params.has('types')).toBe(false);
    search.flush({ query: 'auth', hits: [], byType: {} });

    const node = httpMock.expectOne((r) => r.url === `${graphUrl}/nodes`);

    expect(node.request.params.get('id')).toBe('symbol:src/a.ts#Foo');
    expect(node.request.params.get('layer')).toBe('code');
    node.flush({});

    const neighbors = httpMock.expectOne((r) => r.url === `${graphUrl}/neighbors`);

    expect(neighbors.request.params.get('id')).toBe('file:src/a.ts');
    expect(neighbors.request.params.get('depth')).toBe('2');
    expect(neighbors.request.params.get('limit')).toBe('100');
    neighbors.flush({});

    const path = httpMock.expectOne((r) => r.url === `${graphUrl}/path`);

    expect(path.request.params.get('from')).toBe('file:a');
    expect(path.request.params.get('to')).toBe('file:b');
    expect(path.request.params.has('layer')).toBe(false);
    path.flush({});

    const file = httpMock.expectOne((r) => r.url === `${graphUrl}/file`);

    expect(file.request.params.get('path')).toBe('src/a.ts');
    file.flush({});
  });

  it('reads prompt references and queues a rebuild', () => {
    service.getReferences('c1', 'a1', { promptId: 'p1', limit: 50 }).subscribe();
    service.refresh('c1', 'a1').subscribe();

    const references = httpMock.expectOne((r) => r.url === `${graphUrl}/references`);

    expect(references.request.params.get('promptId')).toBe('p1');
    expect(references.request.params.get('limit')).toBe('50');
    references.flush({ environmentId: 'a1', prompts: [] });

    const refresh = httpMock.expectOne((r) => r.url === `${graphUrl}/refresh`);

    expect(refresh.request.method).toBe('POST');
    refresh.flush({ environmentId: 'a1', queued: true, status: 'building' });
  });

  it('loads workspace graph pages per layer and refreshes the snapshot', () => {
    service.getWorkspaceGraph('c1', { layer: 'knowledge', limit: 3000, offset: 2000 }).subscribe();
    service.refreshWorkspaceSnapshot('c1').subscribe();

    const workspace = httpMock.expectOne((r) => r.url === `${apiUrl}/clients/c1/graph`);

    expect(workspace.request.params.get('layer')).toBe('knowledge');
    expect(workspace.request.params.get('limit')).toBe('3000');
    expect(workspace.request.params.get('offset')).toBe('2000');
    workspace.flush({});
    httpMock.expectOne((r) => r.url === `${apiUrl}/clients/c1/graph/snapshot/refresh` && r.method === 'POST').flush({});
  });

  it('loads the global graph and its status', () => {
    service.getGlobalGraph({ layer: 'all', limit: 5000 }).subscribe();
    service.getGlobalStatus().subscribe();

    const global = httpMock.expectOne((r) => r.url === `${apiUrl}/graph/global`);

    expect(global.request.params.get('limit')).toBe('5000');
    expect(global.request.params.get('layer')).toBe('all');
    global.flush({});
    httpMock.expectOne(`${apiUrl}/graph/global/status`).flush([]);
  });
});
