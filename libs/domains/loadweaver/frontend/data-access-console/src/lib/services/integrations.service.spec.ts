import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';

import { ConsoleEndpointService } from './console-endpoint.service';
import { IntegrationsService } from './integrations.service';

describe('IntegrationsService', () => {
  let http: HttpTestingController;

  const configure = (restApi: () => string = () => 'https://cp.example.com/api') => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: 'https://cp.example.com/api/' } } } },
        { provide: ConsoleEndpointService, useValue: { restApi } },
      ],
    });
    http = TestBed.inject(HttpTestingController);

    return TestBed.inject(IntegrationsService);
  };

  afterEach(() => http.verify());

  it('reads the env status and unwraps { env }', () => {
    const service = configure();
    let status: unknown;

    service.status().subscribe((s) => (status = s));
    http
      .expectOne('https://cp.example.com/api/integrations')
      .flush({ env: [{ id: 'smtp', label: 'Email (SMTP)', active: true, details: { server: 'smtp:587' } }] });

    expect(status).toEqual([{ id: 'smtp', label: 'Email (SMTP)', active: true, details: { server: 'smtp:587' } }]);
  });

  it('posts a connection test and passes the result through', () => {
    const service = configure();
    let result: unknown;

    service.test('BackupTarget', 'offsite').subscribe((r) => (result = r));

    const req = http.expectOne('https://cp.example.com/api/integrations/test');

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ kind: 'BackupTarget', name: 'offsite' });
    req.flush({ ok: false, message: 'bucket backups has no object lock', durationMs: 120 });

    expect(result).toEqual({ ok: false, message: 'bucket backups has no object lock', durationMs: 120 });
  });

  it('goes through the fleet relay in fleet mode', () => {
    const service = configure(() => 'https://fleet.example.com/api/fleet/clusters/c1/relay');

    service.status().subscribe();
    http.expectOne('https://fleet.example.com/api/fleet/clusters/c1/relay/integrations').flush({ env: [] });
  });
});
