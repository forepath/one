import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';

import { ConsolePostureService } from './posture.service';

describe('ConsolePostureService', () => {
  let service: ConsolePostureService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: 'https://cp.example.com/api/' } } } },
      ],
    });
    service = TestBed.inject(ConsolePostureService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('talks to the posture endpoints', () => {
    service.integrations().subscribe();
    http.expectOne('https://cp.example.com/api/posture/integrations').flush([]);

    service.create({ name: 'intune', type: 'intune', config: { tenantId: 't' } }).subscribe();
    const create = http.expectOne('https://cp.example.com/api/posture/integrations');

    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ name: 'intune', type: 'intune', config: { tenantId: 't' } });
    create.flush({});

    service.update('a/b', { enabled: false }).subscribe();
    expect(http.expectOne('https://cp.example.com/api/posture/integrations/a%2Fb').request.method).toBe('PATCH');

    service.test('i1').subscribe();
    http.expectOne('https://cp.example.com/api/posture/integrations/i1/test').flush({ ok: true, message: 'ok' });

    service.testUnsaved('kandji', { subdomain: 'acme' }).subscribe();
    expect(http.expectOne('https://cp.example.com/api/posture/integrations/test').request.body).toEqual({
      type: 'kandji',
      config: { subdomain: 'acme' },
    });

    service.sync('i1').subscribe();
    http.expectOne('https://cp.example.com/api/posture/integrations/i1/sync').flush(null);

    service.remove('i1').subscribe();
    expect(http.expectOne('https://cp.example.com/api/posture/integrations/i1').request.method).toBe('DELETE');

    service.updateCertificateTrust({ requireProof: false }).subscribe();
    expect(http.expectOne('https://cp.example.com/api/posture/certificates').request.method).toBe('PUT');
  });
});
