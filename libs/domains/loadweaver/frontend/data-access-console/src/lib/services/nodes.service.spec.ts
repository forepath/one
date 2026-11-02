import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';

import { NodesService } from './nodes.service';

describe('NodesService.installScriptUrl', () => {
  function service(restApi: string, baseURI = 'https://console.example.com/de/') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi } } } },
        { provide: DOCUMENT, useValue: { baseURI } },
      ],
    });

    return TestBed.inject(NodesService);
  }

  it('resolves the relative production default against the page', () => {
    expect(service('/api').installScriptUrl()).toBe('https://console.example.com/api/install/install.sh');
    expect(service('/api/').installScriptUrl()).toBe('https://console.example.com/api/install/install.sh');
  });

  it('keeps absolute API URLs', () => {
    expect(service('https://cp.example.com/api').installScriptUrl()).toBe(
      'https://cp.example.com/api/install/install.sh',
    );
  });
});

describe('NodesService.platform', () => {
  it("reads the node's platform components", () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: '/api' } } } },
      ],
    });

    const http = TestBed.inject(HttpTestingController);
    let result: unknown;

    TestBed.inject(NodesService)
      .platform('lw-devnode-1')
      .subscribe((rows) => (result = rows));
    http.expectOne('/api/nodes/lw-devnode-1/platform').flush([{ id: 'etcd', component: 'etcd', state: 'running' }]);

    expect(result).toEqual([{ id: 'etcd', component: 'etcd', state: 'running' }]);
    http.verify();
  });
});
