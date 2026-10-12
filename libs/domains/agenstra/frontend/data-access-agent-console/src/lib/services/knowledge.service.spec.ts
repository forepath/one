import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';

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
            console: {
              urls: {
                restApi: apiUrl,
              },
            },
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

  it('uploadTextFiles should POST to /knowledge/upload', (done) => {
    const dto = {
      clientId: 'c1',
      files: [{ filename: 'notes.md', content: '# Hello' }],
    };

    service.uploadTextFiles(dto).subscribe((result) => {
      expect(result.created).toEqual([mockNode]);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/knowledge/upload`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush({ created: [mockNode], updated: [], rejected: [] });
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

  describe('attachments', () => {
    const attachment = {
      id: 'att-1',
      clientId: 'c1',
      ownerType: 'knowledge_page' as const,
      ownerId: 'p1',
      fileName: 'notes.md',
      contentType: 'text/markdown',
      byteSize: 7,
      contentSha256: 'abc',
      downloadUrl: '/api/attachments/att-1/download',
      createdByUserId: null,
      createdAt: '2026-01-01T00:00:00Z',
    };

    it('listAttachments should GET page attachments', (done) => {
      service.listAttachments('p1').subscribe((rows) => {
        expect(rows).toEqual([attachment]);
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/knowledge/p1/attachments`);

      expect(req.request.method).toBe('GET');
      req.flush([attachment]);
    });

    it('uploadAttachment should POST multipart form data', (done) => {
      const file = new File(['# notes'], 'notes.md', { type: 'text/markdown' });

      service.uploadAttachment('p1', file).subscribe((row) => {
        expect(row).toEqual(attachment);
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/knowledge/p1/attachments`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body instanceof FormData).toBe(true);
      req.flush(attachment);
    });

    it('downloadAttachment should GET shared download endpoint as blob', (done) => {
      service.downloadAttachment(attachment).subscribe((blob) => {
        expect(blob.size).toBe(7);
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/attachments/att-1/download`);

      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['# notes']));
    });

    it('deleteAttachment should DELETE page attachment metadata', (done) => {
      service.deleteAttachment('p1', 'att-1').subscribe(() => done());
      const req = httpMock.expectOne(`${apiUrl}/knowledge/p1/attachments/att-1`);

      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });
});
