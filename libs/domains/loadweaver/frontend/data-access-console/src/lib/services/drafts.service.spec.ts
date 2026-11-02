import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';
import { firstValueFrom } from 'rxjs';

import { DraftsService } from './drafts.service';

describe('DraftsService (3.36)', () => {
  let service: DraftsService;
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
    service = TestBed.inject(DraftsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists, creates and reads drafts', async () => {
    const list = firstValueFrom(service.list());

    http.expectOne(`${API}/drafts?status=open`).flush([]);
    expect(await list).toEqual([]);

    const created = firstValueFrom(service.create('Scale web', [{ op: 'delete', kind: 'Site', name: 'a' }]));
    const post = http.expectOne(`${API}/drafts`);

    expect(post.request.body).toEqual({ title: 'Scale web', ops: [{ op: 'delete', kind: 'Site', name: 'a' }] });
    post.flush({ id: ID });
    expect(await created).toEqual({ id: ID });

    void firstValueFrom(service.get(ID));
    http.expectOne(`${API}/drafts/${ID}`).flush({});
  });

  it('sends the version as If-Match on every write', async () => {
    void firstValueFrom(service.patch(ID, 3, { remove: ['Site//a'] }));

    const patch = http.expectOne(`${API}/drafts/${ID}`);

    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.headers.get('If-Match')).toBe('"3"');
    expect(patch.request.body).toEqual({ remove: ['Site//a'] });
    patch.flush({});

    void firstValueFrom(service.submit(ID, 4));

    const submit = http.expectOne(`${API}/drafts/${ID}/submit`);

    expect(submit.request.headers.get('If-Match')).toBe('"4"');
    submit.flush({});

    void firstValueFrom(service.discard(ID, 5));
    expect(http.expectOne(`${API}/drafts/${ID}/discard`).request.headers.get('If-Match')).toBe('"5"');

    void firstValueFrom(service.preview(ID));
    expect(http.expectOne(`${API}/drafts/${ID}/preview`).request.method).toBe('POST');
  });
});
