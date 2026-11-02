import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';
import { firstValueFrom } from 'rxjs';

import { ResourcesService } from './resources.service';

describe('ResourcesService.search (reference pickers, 2026-10-29)', () => {
  let service: ResourcesService;
  let http: HttpTestingController;
  const API = 'https://cp.example.com/api';
  const res = (name: string, project?: string) => ({
    apiVersion: 'loadweaver.com/v1',
    kind: 'WorkloadGroup',
    metadata: { name, ...(project ? { project } : {}) },
    spec: {},
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: `${API}/` } } } },
      ],
    });
    service = TestBed.inject(ResourcesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends kind, project, q and limit', async () => {
    const found = firstValueFrom(service.search('WorkloadGroup', { project: 'shop', q: ' We ', limit: 20 }));

    http.expectOne(`${API}/resources?kind=WorkloadGroup&project=shop&q=we&limit=20`).flush([res('web', 'shop')]);
    expect((await found).map((r) => r.metadata.name)).toEqual(['web']);
  });

  it('filters on the client too (older control planes ignore project / q / limit)', async () => {
    const found = firstValueFrom(service.search('WorkloadGroup', { project: 'shop', q: 'w', limit: 1 }));

    http
      .expectOne((r) => r.url === `${API}/resources`)
      .flush([res('web', 'shop'), res('www', 'shop'), res('web', 'billing'), res('db', 'shop')]);
    expect((await found).map((r) => `${r.metadata.project}/${r.metadata.name}`)).toEqual(['shop/web']);
  });
});
