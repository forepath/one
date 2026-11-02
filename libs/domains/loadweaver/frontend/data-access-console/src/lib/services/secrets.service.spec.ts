import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';
import { firstValueFrom } from 'rxjs';

import { ConsoleEndpointService } from './console-endpoint.service';
import { SecretsService, type SecretInUseError, type SecretSummary } from './secrets.service';

describe('SecretsService.listNames', () => {
  let service: SecretsService;
  let http: HttpTestingController;
  const endpoints = { restApi: jest.fn() };

  beforeEach(() => {
    endpoints.restApi.mockReturnValue('https://cp.example.com/api');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: '/api' } } } },
        { provide: ConsoleEndpointService, useValue: endpoints },
      ],
    });
    service = TestBed.inject(SecretsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const summary: SecretSummary = {
    project: 'shop',
    name: 'password',
    version: 2,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
    updatedBy: 'fleet:f:person',
    reserved: false,
    usedBy: [{ kind: 'Deployment', project: 'shop', name: 'app', pinnedVersion: 1 }],
  };

  it('maps project and cross-project list envelopes to summaries with encoded filters', async () => {
    const listed = firstValueFrom(service.list('shop'));
    http.expectOne('https://cp.example.com/api/projects/shop/secrets').flush({ items: [summary] });
    expect(await listed).toEqual([summary]);
    const all = firstValueFrom(service.listAll({ project: 'shop', q: 'DB & env', limit: 500 }));
    const req = http.expectOne((r) => r.url === 'https://cp.example.com/api/secrets');
    expect(req.request.params.get('project')).toBe('shop');
    expect(req.request.params.get('q')).toBe('DB & env');
    expect(req.request.params.get('limit')).toBe('500');
    req.flush({ items: [] });
    expect(await all).toEqual([]);
    const unfiltered = firstValueFrom(service.listAll());
    http.expectOne('https://cp.example.com/api/secrets').flush({ items: [summary] });
    expect(await unfiltered).toEqual([summary]);
  });

  it('puts the value only in a single PUT body and returns metadata, with no retry or retained field', async () => {
    endpoints.restApi.mockReturnValue('/fleet-api/clusters/c/api');
    const written = firstValueFrom(service.setValue('shop/x', 'password?x', 'private-value'));
    const req = http.expectOne('/fleet-api/clusters/c/api/projects/shop%2Fx/secrets/password%3Fx');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ value: 'private-value' });
    expect(req.request.urlWithParams).not.toContain('private-value');
    req.flush(summary);
    expect(await written).toEqual(summary);
    expect(Object.values(service)).not.toContain('private-value');
    const failed = firstValueFrom(service.setValue('shop', 'password', 'private-value'));
    http
      .expectOne('/fleet-api/clusters/c/api/projects/shop/secrets/password')
      .flush({}, { status: 500, statusText: 'Error' });
    await expect(failed).rejects.toMatchObject({ status: 500 });
    http.expectNone('/fleet-api/clusters/c/api/projects/shop/secrets/password');
  });

  it('deletes with no body and propagates the 409 usedBy error unchanged', async () => {
    const deleted = firstValueFrom(service.delete('shop', 'password'));
    const req = http.expectOne('https://cp.example.com/api/projects/shop/secrets/password');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toBeNull();
    req.flush(null, { status: 204, statusText: 'No Content' });
    await deleted;
    const failed = firstValueFrom(service.delete('shop', 'password'));
    const error: SecretInUseError = {
      message: 'secret is in use; remove the references first',
      usedBy: summary.usedBy,
    };
    http
      .expectOne('https://cp.example.com/api/projects/shop/secrets/password')
      .flush(error, { status: 409, statusText: 'Conflict' });
    await expect(failed).rejects.toMatchObject({ status: 409, error });
  });

  it('builds the names-only project URL and sends literal q and limit, mapping the response', async () => {
    const found = firstValueFrom(service.listNames('shop', { q: 'DB & env', limit: 2 }));
    const request = http.expectOne((r) => r.url === 'https://cp.example.com/api/projects/shop/secrets/names');

    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys().sort()).toEqual(['limit', 'q']);
    expect(request.request.params.get('q')).toBe('DB & env');
    expect(request.request.params.get('limit')).toBe('2');
    const response = { items: [{ name: 'db-password' }, { name: 'env' }] };

    request.flush(response);
    expect(await found).toEqual(response);
  });

  it('defaults to 50, omits absent q and preserves an empty result', async () => {
    const found = firstValueFrom(service.listNames('shop'));
    const request = http.expectOne('https://cp.example.com/api/projects/shop/secrets/names?limit=50');

    expect(request.request.params.has('q')).toBe(false);
    request.flush({ items: [] });
    expect(await found).toEqual({ items: [] });
  });

  it('encodes the project path rather than interpreting it as a URL', async () => {
    const found = firstValueFrom(service.listNames('shop/other?x=1'));

    http
      .expectOne('https://cp.example.com/api/projects/shop%2Fother%3Fx%3D1/secrets/names?limit=50')
      .flush({ items: [] });
    await found;
  });

  it('follows the current fleet relay endpoint on each call', async () => {
    for (const cluster of ['cluster-a', 'cluster-b']) {
      endpoints.restApi.mockReturnValue(`/fleet-api/clusters/${cluster}/api`);
      const found = firstValueFrom(service.listNames('shop', { q: '', limit: 200 }));

      http
        .expectOne(`/fleet-api/clusters/${cluster}/api/projects/shop/secrets/names?limit=200&q=`)
        .flush({ items: [] });
      await found;
    }
  });

  it('propagates authorization errors without falling back to the legacy metadata list', async () => {
    const found = firstValueFrom(service.listNames('shop'));

    http
      .expectOne('https://cp.example.com/api/projects/shop/secrets/names?limit=50')
      .flush({}, { status: 403, statusText: 'Forbidden' });
    await expect(found).rejects.toMatchObject({ status: 403 });
  });
});
