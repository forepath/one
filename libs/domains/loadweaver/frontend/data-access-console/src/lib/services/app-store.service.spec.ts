import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';

import type { AppSummary } from '../types/apps.types';
import { AppStoreService } from './app-store.service';
import { ConsoleEndpointService } from './console-endpoint.service';

const API = 'https://cp.example.com/api';

describe('AppStoreService (P1)', () => {
  let service: AppStoreService;
  let http: HttpTestingController;

  function setup(restApi?: string): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: `${API}/` } } } },
        ...(restApi
          ? [{ provide: ConsoleEndpointService, useValue: { restApi: () => restApi, fleetMode: true } }]
          : []),
      ],
    });
    service = TestBed.inject(AppStoreService);
    http = TestBed.inject(HttpTestingController);
  }

  afterEach(() => http.verify());

  it('reads catalogs, apps (with filters), an app and the installed apps', () => {
    setup();
    const seen: unknown[] = [];

    service.catalogs().subscribe((c) => seen.push(c));
    service.apps().subscribe((a) => seen.push(a));
    service.apps({ q: 'agen stra', catalog: 'official', trust: 'verified' }).subscribe();
    service.app('official', 'agenstra').subscribe();
    service.app('my cat', 'decabill', '1.2.0').subscribe();
    service.installed().subscribe((i) => seen.push(i));
    service.installed('shop').subscribe();

    http.expectOne(`${API}/apps/catalogs`).flush({ catalogs: [{ name: 'official' }], allowedTrust: ['official'] });
    http.expectOne(`${API}/apps`).flush({ apps: [{ name: 'agenstra' }] as AppSummary[] });
    http.expectOne(`${API}/apps?q=agen%20stra&catalog=official&trust=verified`).flush({ apps: [] });
    http.expectOne(`${API}/apps/official/agenstra`).flush({});
    http.expectOne(`${API}/apps/my%20cat/decabill?version=1.2.0`).flush({});
    http.expectOne(`${API}/apps/installed`).flush(null);
    http.expectOne(`${API}/apps/installed?project=shop`).flush({ apps: [] });

    expect(seen).toEqual([
      { catalogs: [{ name: 'official' }], allowedTrust: ['official'] },
      [{ name: 'agenstra' }],
      [],
    ]);
  });

  it('posts install, update and uninstall plans and the catalog refresh', () => {
    setup();
    const install = {
      project: 'shop',
      parameters: { domain: 'x.example', bundledPostgres: true },
      secrets: { 'db-password': 'secret://shop/db' },
      suggestions: ['policies' as const],
    };

    service.installPlan('official', 'agenstra', '1.0.0', install).subscribe();
    service.updatePlan('shop', 'agenstra', { version: '1.1.0' }).subscribe();
    service.uninstallPlan('shop', 'agenstra', { dataPolicy: 'backup' }).subscribe();
    service.uninstallPlan('shop', 'agenstra', { dataPolicy: 'delete', confirm: 'agenstra' }).subscribe();
    service.refreshCatalogs().subscribe();

    const reqs = http.match((r) => r.method === 'POST');

    expect(reqs.map((r) => r.request.url.replace(API, ''))).toEqual([
      '/apps/official/agenstra/1.0.0/plan',
      '/apps/installed/shop/agenstra/update-plan',
      '/apps/installed/shop/agenstra/uninstall-plan',
      '/apps/installed/shop/agenstra/uninstall-plan',
      '/apps/catalogs/refresh',
    ]);
    expect(reqs.map((r) => r.request.body)).toEqual([
      install,
      { version: '1.1.0' },
      { dataPolicy: 'backup' },
      { dataPolicy: 'delete', confirm: 'agenstra' },
      {},
    ]);
    reqs.forEach((r) => r.flush({}));
  });

  it('goes through the fleet relay of the active cluster in fleet mode', () => {
    setup('https://fleet.example.com/api/clusters/c1/relay');

    service.installed().subscribe();

    http.expectOne('https://fleet.example.com/api/clusters/c1/relay/apps/installed').flush([]);
  });
});
