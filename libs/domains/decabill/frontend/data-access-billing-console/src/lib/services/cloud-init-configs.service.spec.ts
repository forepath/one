import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { CloudInitConfigResponse } from '../types/billing.types';

import { CloudInitConfigsService } from './cloud-init-configs.service';

describe('CloudInitConfigsService', () => {
  let service: CloudInitConfigsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: { billing: { restApiUrl: apiUrl } },
        },
      ],
    });

    service = TestBed.inject(CloudInitConfigsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists cloud init configs', (done) => {
    const mock: CloudInitConfigResponse[] = [
      {
        id: 'cfg-1',
        key: 'my-app',
        name: 'My App',
        provisioningMode: 'simple',
        dockerImage: 'nginx:alpine',
        containerPort: 8080,
        hostPort: 80,
        workDir: '/opt/custom-app',
        environmentVariables: [],
        isActive: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ];

    service.listCloudInitConfigs().subscribe((list) => {
      expect(list).toEqual(mock);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/cloud-init-configs`);
    expect(req.request.method).toBe('GET');
    req.flush(mock);
  });
});
