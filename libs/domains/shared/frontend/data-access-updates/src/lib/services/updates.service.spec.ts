import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { UPDATES_ADMIN_ENVIRONMENT } from '../tokens/updates-admin-environment';

import { UpdatesService } from './updates.service';

describe('UpdatesService', () => {
  let service: UpdatesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        UpdatesService,
        {
          provide: UPDATES_ADMIN_ENVIRONMENT,
          useValue: {
            apiUrl: 'https://api.example.com',
            updatesBasePath: 'admin/updates',
          },
        },
      ],
    });

    service = TestBed.inject(UpdatesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('loads full state', () => {
    service.getFullState().subscribe();

    const req = httpMock.expectOne('https://api.example.com/admin/updates');

    expect(req.request.method).toBe('GET');
    req.flush({ installedVersion: '1.0.0', instances: [] });
  });

  it('loads status summary', () => {
    service.getStatus().subscribe();

    const req = httpMock.expectOne('https://api.example.com/admin/updates/status');

    expect(req.request.method).toBe('GET');
    req.flush({ installedVersion: '1.0.0', updateState: 'unknown' });
  });

  it('triggers update check', () => {
    service.triggerCheck().subscribe();

    const req = httpMock.expectOne('https://api.example.com/admin/updates/check');

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ jobId: 'job-1', enqueuedAt: '2024-01-01T00:00:00Z' });
  });
});
