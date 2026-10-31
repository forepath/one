import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';
import { firstValueFrom } from 'rxjs';

import { ConsoleSavedViewsService } from './saved-views.service';

describe('ConsoleSavedViewsService (3.37)', () => {
  let service: ConsoleSavedViewsService;
  let http: HttpTestingController;
  const API = 'https://cp.example.com/api';
  const ID = '0b7c6a52-3f7a-4f43-9d1e-2b9a4f0c1d2e';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: `${API}/` } } } },
      ],
    });
    service = TestBed.inject(ConsoleSavedViewsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists all views or one scope', async () => {
    const all = firstValueFrom(service.list());

    http.expectOne(`${API}/views`).flush([]);
    expect(await all).toEqual([]);

    const plans = firstValueFrom(service.list('plans'));

    http.expectOne(`${API}/views?scope=plans`).flush([{ id: ID }]);
    expect(await plans).toEqual([{ id: ID }]);
  });

  it('creates, updates and removes views', async () => {
    const created = firstValueFrom(service.create({ scope: 'audit', name: 'Mine', state: { q: 'actor:me' } }));
    const post = http.expectOne(`${API}/views`);

    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ scope: 'audit', name: 'Mine', state: { q: 'actor:me' } });
    post.flush({ id: ID });
    expect(await created).toEqual({ id: ID });

    void firstValueFrom(service.update(ID, { name: 'Renamed' }));

    const patch = http.expectOne(`${API}/views/${ID}`);

    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ name: 'Renamed' });
    patch.flush({ id: ID });

    const removed = firstValueFrom(service.remove(ID));
    const del = http.expectOne(`${API}/views/${ID}`);

    expect(del.request.method).toBe('DELETE');
    del.flush(null, { status: 204, statusText: 'No Content' });
    await removed;
  });

  it('calls nothing in fleet mode without an active cluster (fleet views, LW-25)', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ENVIRONMENT,
          useValue: {
            mode: 'fleet',
            console: { urls: { restApi: `${API}/` } },
            fleet: { apiUrl: 'https://fleet.example.com/api', websocketUrl: '' },
          },
        },
      ],
    });
    sessionStorage.removeItem('loadweaver-fleet-active-cluster');

    const fleet = TestBed.inject(ConsoleSavedViewsService);

    http = TestBed.inject(HttpTestingController);
    expect(fleet.available()).toBe(false);
    expect(await firstValueFrom(fleet.list('fleet-overview'))).toEqual([]);
    await expect(firstValueFrom(fleet.create({ scope: 'fleet-overview', name: 'x', state: {} }))).rejects.toThrow(
      'saved views need an active cluster',
    );
    http.expectNone(() => true);
  });
});
