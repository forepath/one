import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of } from 'rxjs';

import { DeploymentsService } from '../../services/deployments.service';

import {
  createDeploymentConfiguration,
  createDeploymentConfigurationSuccess,
  loadDeploymentConfiguration,
  loadDeploymentConfigurationFailure,
  loadDeploymentConfigurationSuccess,
  loadRunLogs,
  loadRunLogsSuccess,
  triggerWorkflow,
  triggerWorkflowSuccess,
} from './deployments.actions';
import {
  createDeploymentConfiguration$,
  loadDeploymentConfiguration$,
  loadRunLogs$,
  triggerWorkflow$,
} from './deployments.effects';

describe('DeploymentsEffects', () => {
  let actions$: Actions;
  let deploymentsService: DeploymentsService;
  let httpMock: HttpTestingController;
  const mockEnvironment: Environment = {
    controller: {
      restApiUrl: 'https://api.example.com',
    },
  } as Environment;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        provideMockActions(() => actions$),
        DeploymentsService,
        {
          provide: ENVIRONMENT,
          useValue: mockEnvironment,
        },
      ],
    });

    deploymentsService = TestBed.inject(DeploymentsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('loadDeploymentConfiguration$', () => {
    it('should dispatch success action on successful load', (done) => {
      const mockConfiguration = {
        id: 'config-1',
        agentId: 'agent-1',
        providerType: 'github',
        repositoryId: 'owner/repo',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      actions$ = of(loadDeploymentConfiguration({ clientId: 'client-1', agentId: 'agent-1' }));

      const effects = loadDeploymentConfiguration$(actions$, deploymentsService);

      effects.subscribe((action) => {
        expect(action).toEqual(loadDeploymentConfigurationSuccess({ configuration: mockConfiguration }));
        done();
      });

      const req = httpMock.expectOne(
        'https://api.example.com/clients/client-1/agents/agent-1/deployments/configuration',
      );

      expect(req.request.method).toBe('GET');
      req.flush(mockConfiguration);
    });

    it('should dispatch failure action on error', (done) => {
      actions$ = of(loadDeploymentConfiguration({ clientId: 'client-1', agentId: 'agent-1' }));

      const effects = loadDeploymentConfiguration$(actions$, deploymentsService);

      effects.subscribe((action) => {
        expect(action).toEqual(loadDeploymentConfigurationFailure({ error: expect.any(String) }));
        done();
      });

      const req = httpMock.expectOne(
        'https://api.example.com/clients/client-1/agents/agent-1/deployments/configuration',
      );

      req.error(new ErrorEvent('Network error'));
    });
  });

  describe('createDeploymentConfiguration$', () => {
    it('should dispatch success action on successful create', (done) => {
      const mockConfiguration = {
        id: 'config-1',
        agentId: 'agent-1',
        providerType: 'github',
        repositoryId: 'owner/repo',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const dto = { providerType: 'github', repositoryId: 'owner/repo', providerToken: 'token' };

      actions$ = of(createDeploymentConfiguration({ clientId: 'client-1', agentId: 'agent-1', dto }));

      const effects = createDeploymentConfiguration$(actions$, deploymentsService);

      effects.subscribe((action) => {
        expect(action).toEqual(createDeploymentConfigurationSuccess({ configuration: mockConfiguration }));
        done();
      });

      const req = httpMock.expectOne(
        'https://api.example.com/clients/client-1/agents/agent-1/deployments/configuration',
      );

      expect(req.request.method).toBe('POST');
      req.flush(mockConfiguration);
    });
  });

  describe('triggerWorkflow$', () => {
    it('should dispatch success action on successful trigger', (done) => {
      const mockRun = {
        id: 'run-1',
        configurationId: 'config-1',
        providerRunId: 'provider-run-1',
        runName: 'Test Run',
        status: 'queued',
        ref: 'main',
        sha: 'abc123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const dto = { workflowId: 'workflow-1', ref: 'main' };

      actions$ = of(triggerWorkflow({ clientId: 'client-1', agentId: 'agent-1', dto }));

      const effects = triggerWorkflow$(actions$, deploymentsService);

      effects.subscribe((action) => {
        expect(action).toEqual(triggerWorkflowSuccess({ run: mockRun }));
        done();
      });

      const req = httpMock.expectOne(
        'https://api.example.com/clients/client-1/agents/agent-1/deployments/workflows/trigger',
      );

      expect(req.request.method).toBe('POST');
      req.flush(mockRun);
    });
  });

  describe('loadRunLogs$', () => {
    it('should dispatch success action with logs', (done) => {
      const mockResponse = { logs: 'Log content' };

      actions$ = of(loadRunLogs({ clientId: 'client-1', agentId: 'agent-1', runId: 'run-1' }));

      const effects = loadRunLogs$(actions$, deploymentsService);

      effects.subscribe((action) => {
        expect(action).toEqual(loadRunLogsSuccess({ logs: 'Log content' }));
        done();
      });

      const req = httpMock.expectOne(
        'https://api.example.com/clients/client-1/agents/agent-1/deployments/runs/run-1/logs',
      );

      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });
});
