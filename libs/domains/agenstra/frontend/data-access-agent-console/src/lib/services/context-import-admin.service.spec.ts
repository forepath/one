import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { ContextImportAdminService } from './context-import-admin.service';

describe('ContextImportAdminService', () => {
  let service: ContextImportAdminService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3100/api';
  const baseUrl = `${apiUrl}/imports/atlassian`;

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
    service = TestBed.inject(ContextImportAdminService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listConnections', () => {
    it('should GET /connections without query params when params omitted', (done) => {
      service.listConnections().subscribe((res) => {
        expect(res).toEqual([]);
        done();
      });
      const req = httpMock.expectOne(`${baseUrl}/connections`);

      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys().length).toBe(0);
      req.flush([]);
    });

    it('should pass limit and offset when provided', (done) => {
      service.listConnections({ limit: 10, offset: 20 }).subscribe(() => done());
      const req = httpMock.expectOne((r) => r.url.startsWith(`${baseUrl}/connections`));

      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.params.get('offset')).toBe('20');
      req.flush([]);
    });
  });

  it('getConnection should GET /connections/:id', (done) => {
    const dto = {
      id: 'c1',
      baseUrl: 'https://x.atlassian.net',
      accountEmail: 'a@b.com',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    service.getConnection('c1').subscribe((c) => {
      expect(c).toEqual(dto);
      done();
    });
    const req = httpMock.expectOne(`${baseUrl}/connections/c1`);

    expect(req.request.method).toBe('GET');
    req.flush(dto);
  });

  it('createConnection should POST dto', (done) => {
    const body = { baseUrl: 'https://x.atlassian.net', accountEmail: 'a@b.com', apiToken: 't' };
    const created = {
      id: 'c1',
      ...body,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    service.createConnection(body).subscribe((c) => {
      expect(c.id).toBe('c1');
      done();
    });
    const req = httpMock.expectOne(`${baseUrl}/connections`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush(created);
  });

  it('updateConnection should PUT dto', (done) => {
    service.updateConnection('c1', { label: 'L' }).subscribe(() => done());
    const req = httpMock.expectOne(`${baseUrl}/connections/c1`);

    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ label: 'L' });
    req.flush({});
  });

  it('deleteConnection should DELETE', (done) => {
    service.deleteConnection('c1').subscribe(() => done());
    const req = httpMock.expectOne(`${baseUrl}/connections/c1`);

    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('testConnection should POST empty body', (done) => {
    service.testConnection('c1').subscribe((r) => {
      expect(r.ok).toBe(true);
      done();
    });
    const req = httpMock.expectOne(`${baseUrl}/connections/c1/test`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ ok: true });
  });

  describe('listConfigs', () => {
    it('should GET /configs without params when omitted', (done) => {
      service.listConfigs().subscribe(() => done());
      const req = httpMock.expectOne(`${baseUrl}/configs`);

      expect(req.request.params.keys().length).toBe(0);
      req.flush([]);
    });

    it('should pass pagination params', (done) => {
      service.listConfigs({ limit: 5, offset: 15 }).subscribe(() => done());
      const req = httpMock.expectOne((r) => r.url.startsWith(`${baseUrl}/configs`));

      expect(req.request.params.get('limit')).toBe('5');
      expect(req.request.params.get('offset')).toBe('15');
      req.flush([]);
    });
  });

  it('getConfig should GET /configs/:id', (done) => {
    service.getConfig('f1').subscribe(() => done());
    const req = httpMock.expectOne(`${baseUrl}/configs/f1`);

    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('createConfig should POST dto', (done) => {
    const dto = {
      provider: 'atlassian' as const,
      importKind: 'jira' as const,
      atlassianConnectionId: 'c1',
      clientId: 'cl1',
    };

    service.createConfig(dto).subscribe(() => done());
    const req = httpMock.expectOne(`${baseUrl}/configs`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush({ ...dto, id: 'f1', enabled: true, createdAt: '', updatedAt: '' });
  });

  it('updateConfig should PUT dto', (done) => {
    service.updateConfig('f1', { enabled: false }).subscribe(() => done());
    const req = httpMock.expectOne(`${baseUrl}/configs/f1`);

    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('deleteConfig should DELETE', (done) => {
    service.deleteConfig('f1').subscribe(() => done());
    const req = httpMock.expectOne(`${baseUrl}/configs/f1`);

    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('runConfig should POST', (done) => {
    service.runConfig('f1').subscribe(() => done());
    const req = httpMock.expectOne(`${baseUrl}/configs/f1/run`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(null);
  });

  it('clearMarkers should DELETE markers endpoint', (done) => {
    service.clearMarkers('f1').subscribe(() => done());
    const req = httpMock.expectOne(`${baseUrl}/configs/f1/markers`);

    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
