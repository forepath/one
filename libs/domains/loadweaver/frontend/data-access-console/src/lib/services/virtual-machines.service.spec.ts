import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';

import { VirtualMachinesService } from './virtual-machines.service';

const API = 'https://cp.example.com/api';

describe('VirtualMachinesService (VM image catalog, 3.42)', () => {
  let service: VirtualMachinesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: `${API}/` } } } },
      ],
    });
    service = TestBed.inject(VirtualMachinesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the catalog and, separately, the upstream lookup', () => {
    const catalog = jest.fn();
    const upstream = jest.fn();

    service.catalog().subscribe(catalog);
    service.upstreamCatalog().subscribe(upstream);

    http.expectOne({ method: 'GET', url: `${API}/vm-images/catalog` }).flush({ entries: [] });
    http
      .expectOne({ method: 'GET', url: `${API}/vm-images/catalog/upstream` })
      .flush({ entries: [], warnings: ['fedora: timeout'] });

    expect(catalog).toHaveBeenCalledWith({ entries: [] });
    expect(upstream).toHaveBeenCalledWith({ entries: [], warnings: ['fedora: timeout'] });
  });

  it('imports with a SHA-512 instead of a SHA-256', () => {
    service.importImage('my shop', { url: 'https://example.com/a.qcow2', sha512: 'ab', ref: 'debian:13' }).subscribe();

    const request = http.expectOne({ method: 'POST', url: `${API}/projects/my%20shop/vm-images/import` });

    expect(request.request.body).toEqual({ url: 'https://example.com/a.qcow2', sha512: 'ab', ref: 'debian:13' });
    request.flush({});
  });
});
