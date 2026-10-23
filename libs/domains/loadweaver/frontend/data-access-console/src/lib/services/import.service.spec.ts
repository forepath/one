import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';

import { ImportService } from './import.service';

describe('ImportService', () => {
  let service: ImportService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: 'https://cp.example.com/api/' } } } },
      ],
    });
    service = TestBed.inject(ImportService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('calls the import endpoints', () => {
    service.list().subscribe();
    http.expectOne('https://cp.example.com/api/imports').flush([]);

    service.get('host1').subscribe();
    http.expectOne('https://cp.example.com/api/imports/host1').flush({});

    service.discover('host1').subscribe();
    expect(http.expectOne('https://cp.example.com/api/imports/host1/discover').request.method).toBe('POST');

    service.saveSelection('host1', { items: [{ item: 'compose:shop', choice: 'ignore' }] }).subscribe();
    const put = http.expectOne('https://cp.example.com/api/imports/host1/selection');

    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ items: [{ item: 'compose:shop', choice: 'ignore' }] });

    service.createPlan('host1').subscribe();
    expect(http.expectOne('https://cp.example.com/api/imports/host1/plan').request.method).toBe('POST');

    service.discard('host1').subscribe();
    expect(http.expectOne('https://cp.example.com/api/imports/host1').request.method).toBe('DELETE');
  });
});
