import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { WorkspaceConfigService } from './workspace-config.service';

describe('WorkspaceConfigService', () => {
  let service: WorkspaceConfigService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        WorkspaceConfigService,
        {
          provide: ENVIRONMENT,
          useValue: { controller: { restApiUrl: 'http://localhost:3000' } },
        },
      ],
    });

    service = TestBed.inject(WorkspaceConfigService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('calls list endpoint', () => {
    service.listConfigurationOverrides('client-1').subscribe();
    const req = httpMock.expectOne('http://localhost:3000/clients/client-1/configuration-overrides');

    expect(req.request.method).toBe('GET');
    req.flush([]);
  });
});
