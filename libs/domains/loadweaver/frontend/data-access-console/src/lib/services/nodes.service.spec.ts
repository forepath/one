import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
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
