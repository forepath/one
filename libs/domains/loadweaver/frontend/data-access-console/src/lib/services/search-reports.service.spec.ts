import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';
import { firstValueFrom } from 'rxjs';

import { GlobalSearchService } from './global-search.service';
import { ReportsService } from './reports.service';
import { SlosService } from './slos.service';
import { StatusPagesService } from './status-pages.service';

const API = 'https://cp.example.com/api';

describe('search, SLO, status page and report services', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: `${API}/` } } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('searches, stars and records visits', async () => {
    const search = TestBed.inject(GlobalSearchService);
    const results = firstValueFrom(search.search('web', 10));
    const query = http.expectOne((r) => r.url === `${API}/search`);

    expect(query.request.params.get('q')).toBe('web');
    expect(query.request.params.get('limit')).toBe('10');
    query.flush({ results: [], actions: [] });
    expect(await results).toEqual({ results: [], actions: [] });

    void firstValueFrom(search.setFavourite('Deployment:shop/web', true));
    const star = http.expectOne(`${API}/search/favorites/Deployment%3Ashop%2Fweb`);

    expect(star.request.method).toBe('PUT');
    star.flush(null);

    void firstValueFrom(search.setFavourite('Node:n1', false));
    expect(http.expectOne(`${API}/search/favorites/Node%3An1`).request.method).toBe('DELETE');

    void firstValueFrom(search.visited('Node:n1'));
    const visit = http.expectOne(`${API}/search/recent`);

    expect(visit.request.body).toEqual({ item: 'Node:n1' });
  });

  it('runs API actions with their method and path', () => {
    const search = TestBed.inject(GlobalSearchService);

    void firstValueFrom(
      search.runAction({ title: 'Drain node n2', kind: 'api', request: { method: 'POST', path: '/nodes/n2/drain' } }),
    );
    expect(http.expectOne(`${API}/nodes/n2/drain`).request.method).toBe('POST');
    expect(() => search.runAction({ title: 'Create plan', kind: 'navigate', link: '/plans/new' })).toThrow();
  });

  it('reads SLOs, status pages and incidents', () => {
    void firstValueFrom(TestBed.inject(SlosService).list('shop'));
    expect(http.expectOne(`${API}/slos?project=shop`)).toBeTruthy();

    const pages = TestBed.inject(StatusPagesService);

    void firstValueFrom(pages.pages());
    expect(http.expectOne(`${API}/resources?kind=StatusPage`)).toBeTruthy();

    void firstValueFrom(pages.updateIncident('shop', 'i1', { status: 'resolved', message: 'Fixed.' }));
    const update = http.expectOne(`${API}/projects/shop/incidents/i1`);

    expect(update.request.method).toBe('PUT');
    expect(update.request.body).toEqual({ status: 'resolved', message: 'Fixed.' });
  });

  it('reads the report tree and downloads files and folders as blobs', () => {
    const reports = TestBed.inject(ReportsService);

    void firstValueFrom(reports.files());
    expect(http.expectOne(`${API}/reports/files`).request.params.has('path')).toBe(false);

    void firstValueFrom(reports.download('cluster/2026/09/report.html'));
    const file = http.expectOne((r) => r.url === `${API}/reports/files/download`);

    expect(file.request.params.get('path')).toBe('cluster/2026/09/report.html');
    expect(file.request.responseType).toBe('blob');

    void firstValueFrom(reports.archive('cluster/2026'));
    expect(http.expectOne((r) => r.url === `${API}/reports/files/archive`).request.responseType).toBe('blob');

    void firstValueFrom(reports.run({ scope: 'cluster', year: 2026, month: 9 }));
    expect(http.expectOne(`${API}/reports/run`).request.body).toEqual({ scope: 'cluster', year: 2026, month: 9 });
  });
});
