import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { KnowledgeService } from './knowledge.service';

describe('KnowledgeService', () => {
  let service: KnowledgeService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3100/api';
  const mockNode = {
    id: 'n1',
    shas: { short: 'abc', long: 'abc123' },
    clientId: 'c1',
    nodeType: 'page' as const,
    parentId: null,
    title: 'T',
    content: '',
    sortOrder: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: {
            controller: { restApiUrl: apiUrl },
          },
        },
      ],
    });
    service = TestBed.inject(KnowledgeService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('listByClient should GET /knowledge with clientId', (done) => {
    service.listByClient('c1').subscribe((nodes) => {
      expect(nodes).toEqual([mockNode]);
      done();
    });
    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/knowledge`);

    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('clientId')).toBe('c1');
    req.flush([mockNode]);
  });

  it('getTree should GET /knowledge/tree', (done) => {
    service.getTree('c1').subscribe(() => done());
    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/knowledge/tree`);

    expect(req.request.params.get('clientId')).toBe('c1');
    req.flush([]);
  });

  it('create should POST dto', (done) => {
    const dto = { nodeType: 'folder' as const, title: 'F' };

    service.create(dto).subscribe(() => done());
    const req = httpMock.expectOne(`${apiUrl}/knowledge`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush(mockNode);
  });

  it('update should PATCH', (done) => {
    service.update('n1', { title: 'X' }).subscribe(() => done());
    const req = httpMock.expectOne(`${apiUrl}/knowledge/n1`);

    expect(req.request.method).toBe('PATCH');
    req.flush(mockNode);
  });

  it('duplicate should POST', (done) => {
    service.duplicate('n1').subscribe(() => done());
    const req = httpMock.expectOne(`${apiUrl}/knowledge/n1/duplicate`);

    expect(req.request.method).toBe('POST');
    req.flush(mockNode);
  });

  it('delete omits releaseExternalSyncMarker when false', (done) => {
    service.delete('n1', false).subscribe(() => done());
    const req = httpMock.expectOne(
      (r) => r.url === `${apiUrl}/knowledge/n1` || r.url.startsWith(`${apiUrl}/knowledge/n1?`),
    );

    expect(req.request.params.keys().length).toBe(0);
    req.flush(null);
  });

  it('delete sets releaseExternalSyncMarker when true', (done) => {
    service.delete('n1', true).subscribe(() => done());
    const req = httpMock.expectOne((r) => r.url.startsWith(`${apiUrl}/knowledge/n1`));

    expect(req.request.params.get('releaseExternalSyncMarker')).toBe('true');
    req.flush(null);
  });

  it('listRelations should pass query params', (done) => {
    service.listRelations('c1', 'page', 'n1').subscribe(() => done());
    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/knowledge/relations`);

    expect(req.request.params.get('clientId')).toBe('c1');
    expect(req.request.params.get('sourceType')).toBe('page');
    expect(req.request.params.get('sourceId')).toBe('n1');
    req.flush([]);
  });

  it('createRelation should POST', (done) => {
    const dto = {
      clientId: 'c1',
      sourceType: 'page' as const,
      sourceId: 'n1',
      targetType: 'page' as const,
      targetNodeId: 'n2',
    };

    service.createRelation(dto).subscribe(() => done());
    const req = httpMock.expectOne(`${apiUrl}/knowledge/relations`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush({ id: 'r1', ...dto, createdAt: '' });
  });

  it('deleteRelation should DELETE', (done) => {
    service.deleteRelation('r1').subscribe(() => done());
    const req = httpMock.expectOne(`${apiUrl}/knowledge/relations/r1`);

    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('listActivity should use default limit and offset', (done) => {
    service.listActivity('p1').subscribe(() => done());
    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/knowledge/p1/activity`);

    expect(req.request.params.get('limit')).toBe('50');
    expect(req.request.params.get('offset')).toBe('0');
    req.flush([]);
  });

  it('listActivity should pass custom limit and offset', (done) => {
    service.listActivity('p1', 10, 30).subscribe(() => done());
    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/knowledge/p1/activity`);

    expect(req.request.params.get('limit')).toBe('10');
    expect(req.request.params.get('offset')).toBe('30');
    req.flush([]);
  });
});
