import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';

import { DeploymentConnectionsService } from './deployment-connections.service';

describe('DeploymentConnectionsService', () => {
  const apiUrl = 'http://localhost:3100/api';
  const baseUrl = `${apiUrl}/connections/deployments`;
  let service: DeploymentConnectionsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: ENVIRONMENT, useValue: { console: { urls: { restApi: apiUrl } } } }],
    });
    service = TestBed.inject(DeploymentConnectionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lists connections with paging, search and provider filter', () => {
    service.list({ limit: 10, offset: 20, search: '  prod ', provider: 'gitlab' }).subscribe();
    service.list().subscribe();

    const [filtered, plain] = httpMock.match((r) => r.url === baseUrl);

    expect(filtered.request.params.get('limit')).toBe('10');
    expect(filtered.request.params.get('offset')).toBe('20');
    expect(filtered.request.params.get('search')).toBe('prod');
    expect(filtered.request.params.get('provider')).toBe('gitlab');
    expect(plain.request.params.keys()).toEqual([]);
    filtered.flush([]);
    plain.flush([]);
  });

  it('creates, updates, deletes and tests connections', () => {
    service.create({ label: 'GitHub', provider: 'github', authType: 'app', appId: '1' }).subscribe();
    service.update('c1', { label: 'Renamed' }).subscribe();
    service.delete('c1').subscribe();
    service.test('c1').subscribe();
    service.get('c1').subscribe();

    const create = httpMock.expectOne({ method: 'POST', url: baseUrl });

    expect(create.request.body).toEqual({ label: 'GitHub', provider: 'github', authType: 'app', appId: '1' });
    create.flush({});

    const update = httpMock.expectOne({ method: 'PUT', url: `${baseUrl}/c1` });

    expect(update.request.body).toEqual({ label: 'Renamed' });
    update.flush({});
    httpMock.expectOne({ method: 'DELETE', url: `${baseUrl}/c1` }).flush(null);
    httpMock.expectOne({ method: 'POST', url: `${baseUrl}/c1/test` }).flush({ ok: true, testedAt: 'now' });
    httpMock.expectOne({ method: 'GET', url: `${baseUrl}/c1` }).flush({});
  });
});
