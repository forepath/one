import { createHash } from 'node:crypto';

import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';

import { ConsoleEndpointService } from './console-endpoint.service';
import { UpdatesService } from './updates.service';

describe('UpdatesService', () => {
  let service: UpdatesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: 'https://cp.example.com/api/' } } } },
      ],
    });
    service = TestBed.inject(UpdatesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads status, releases and update plans', () => {
    service.status().subscribe();
    service.releases().subscribe();
    service.rollouts(20).subscribe();
    service.rollout('r 1').subscribe();

    http.expectOne('https://cp.example.com/api/updates/status').flush({});
    http.expectOne('https://cp.example.com/api/updates/releases').flush([]);
    http.expectOne('https://cp.example.com/api/updates/rollouts?limit=20').flush([]);
    http.expectOne('https://cp.example.com/api/updates/rollouts/r%201').flush({});
  });

  it('downloads releases and plans updates', () => {
    service.download('1.2.0-beta.1').subscribe();
    service.createRollout({ version: '1.2.0', host: true }).subscribe();

    const download = http.expectOne('https://cp.example.com/api/updates/releases/1.2.0-beta.1/download');
    const create = http.expectOne('https://cp.example.com/api/updates/rollouts');

    expect(download.request.method).toBe('POST');
    expect(create.request.body).toEqual({ version: '1.2.0', host: true });
    download.flush({ version: '1.2.0-beta.1', status: 'importing' });
    create.flush({});
  });

  it('sends emergency only with an approval', () => {
    service.act('r1', 'approve', true).subscribe();
    service.act('r1', 'pause', true).subscribe();
    service.act('r1', 'approve').subscribe();

    const [emergency, pause, approve] = [
      http.expectOne((r) => r.url.endsWith('/rollouts/r1/approve') && !!r.body?.emergency),
      http.expectOne('https://cp.example.com/api/updates/rollouts/r1/pause'),
      http.expectOne((r) => r.url.endsWith('/rollouts/r1/approve') && !r.body?.emergency),
    ];

    expect(emergency.request.body).toEqual({ emergency: true });
    expect(pause.request.body).toEqual({});
    expect(approve.request.body).toEqual({});
    [emergency, pause, approve].forEach((r) => r.flush({}));
  });

  it('streams a bundle as application/x-tar with upload progress', () => {
    const file = new File(['bundle'], 'loadweaver-bundle-1.2.0.tar');
    const events: HttpEventType[] = [];

    service.uploadBundle(file).subscribe((event) => events.push(event.type));

    const upload = http.expectOne('https://cp.example.com/api/updates/bundles');

    expect(upload.request.method).toBe('POST');
    expect(upload.request.body).toBe(file);
    expect(upload.request.headers.get('Content-Type')).toBe('application/x-tar');
    expect(upload.request.reportProgress).toBe(true);
    // Natively no digest (the cluster checks one only when declared).
    expect(upload.request.headers.has('X-Loadweaver-Content-SHA256')).toBe(false);
    upload.event({ type: HttpEventType.UploadProgress, loaded: 3, total: 6 });
    upload.flush({ version: '1.2.0' });

    expect(events).toContain(HttpEventType.UploadProgress);
    expect(events).toContain(HttpEventType.Response);
  });
});

describe('UpdatesService in fleet mode (2026-10-27)', () => {
  it('declares the bundle SHA-256 so the relay can bind it into the claim', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: 'https://cp.example.com/api/' } } } },
        {
          provide: ConsoleEndpointService,
          useValue: { fleetMode: true, restApi: () => 'https://fleet.example.com/api/clusters/c1/api' },
        },
      ],
    });

    const http = TestBed.inject(HttpTestingController);
    const file = new File(['bundle'], 'loadweaver-bundle-1.2.0.tar');

    TestBed.inject(UpdatesService).uploadBundle(file).subscribe();
    // The digest is computed before the request starts.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const upload = http.expectOne('https://fleet.example.com/api/clusters/c1/api/updates/bundles');

    expect(upload.request.headers.get('X-Loadweaver-Content-SHA256')).toBe(
      createHash('sha256').update('bundle').digest('hex'),
    );
    upload.flush({ version: '1.2.0' });
    http.verify();
  });
});
