import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';

import type { EnvironmentProgress } from '../state/environment-progress/environment-progress.types';

import { EnvironmentProgressService } from './environment-progress.service';

describe('EnvironmentProgressService', () => {
  let service: EnvironmentProgressService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3100/api';
  const clientId = 'client-1';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: ENVIRONMENT, useValue: { console: { urls: { restApi: apiUrl } } } }],
    });

    service = TestBed.inject(EnvironmentProgressService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should list running environment progress of a workspace', (done) => {
    const operations: EnvironmentProgress[] = [
      {
        operationId: 'op-1',
        agentId: null,
        agentName: 'New',
        operation: 'create',
        status: 'running',
        step: 'pullingImage',
        stepIndex: 1,
        stepCount: 6,
        progress: 42,
        startedAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:01Z',
      },
    ];

    service.listClientEnvironmentProgress(clientId).subscribe((result) => {
      expect(result).toEqual(operations);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/progress`);

    expect(req.request.method).toBe('GET');
    req.flush(operations);
  });
});
