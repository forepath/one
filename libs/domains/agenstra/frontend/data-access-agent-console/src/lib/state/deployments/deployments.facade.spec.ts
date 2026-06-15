import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import {
  cancelRun,
  createDeploymentConfiguration,
  deleteDeploymentConfiguration,
  loadBranches,
  loadDeploymentConfiguration,
  loadJobLogs,
  loadRepositories,
  loadRunJobs,
  loadRunLogs,
  loadRunStatus,
  loadRuns,
  loadWorkflows,
  triggerWorkflow,
  updateDeploymentConfiguration,
} from './deployments.actions';
import { DeploymentsFacade } from './deployments.facade';
import type { DeploymentsState } from './deployments.reducer';

describe('DeploymentsFacade', () => {
  let facade: DeploymentsFacade;
  let store: MockStore<{ deployments: DeploymentsState }>;
  const initialState = {
    deployments: {
      configuration: null,
      repositories: [],
      branches: [],
      workflows: [],
      runs: [],
      jobs: [],
      runLogs: null,
      jobLogs: null,
      loadingConfiguration: false,
      loadingRepositories: false,
      loadingBranches: false,
      loadingWorkflows: false,
      loadingRuns: false,
      loadingRunStatus: false,
      loadingRunLogs: false,
      loadingRunJobs: false,
      loadingJobLogs: false,
      creatingConfiguration: false,
      updatingConfiguration: false,
      deletingConfiguration: false,
      triggeringWorkflow: false,
      cancelingRun: false,
      error: null,
    },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DeploymentsFacade, provideMockStore({ initialState })],
    });

    facade = TestBed.inject(DeploymentsFacade);
    store = TestBed.inject(MockStore);
  });

  it('should be created', () => {
    expect(facade).toBeTruthy();
  });

  describe('loadConfiguration', () => {
    it('should dispatch loadDeploymentConfiguration action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.loadConfiguration('client-1', 'agent-1');

      expect(spy).toHaveBeenCalledWith(loadDeploymentConfiguration({ clientId: 'client-1', agentId: 'agent-1' }));
    });
  });

  describe('createConfiguration', () => {
    it('should dispatch createDeploymentConfiguration action', () => {
      const spy = jest.spyOn(store, 'dispatch');
      const dto = { providerType: 'github', repositoryId: 'owner/repo', providerToken: 'token' };

      facade.createConfiguration('client-1', 'agent-1', dto);

      expect(spy).toHaveBeenCalledWith(
        createDeploymentConfiguration({ clientId: 'client-1', agentId: 'agent-1', dto }),
      );
    });
  });

  describe('updateConfiguration', () => {
    it('should dispatch updateDeploymentConfiguration action', () => {
      const spy = jest.spyOn(store, 'dispatch');
      const dto = { repositoryId: 'owner/new-repo' };

      facade.updateConfiguration('client-1', 'agent-1', dto);

      expect(spy).toHaveBeenCalledWith(
        updateDeploymentConfiguration({ clientId: 'client-1', agentId: 'agent-1', dto }),
      );
    });
  });

  describe('deleteConfiguration', () => {
    it('should dispatch deleteDeploymentConfiguration action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.deleteConfiguration('client-1', 'agent-1');

      expect(spy).toHaveBeenCalledWith(deleteDeploymentConfiguration({ clientId: 'client-1', agentId: 'agent-1' }));
    });
  });

  describe('loadRepositories', () => {
    it('should dispatch loadRepositories action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.loadRepositories('client-1', 'agent-1');

      expect(spy).toHaveBeenCalledWith(loadRepositories({ clientId: 'client-1', agentId: 'agent-1' }));
    });
  });

  describe('loadBranches', () => {
    it('should dispatch loadBranches action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.loadBranches('client-1', 'agent-1', 'owner/repo');

      expect(spy).toHaveBeenCalledWith(
        loadBranches({ clientId: 'client-1', agentId: 'agent-1', repositoryId: 'owner/repo' }),
      );
    });
  });

  describe('loadWorkflows', () => {
    it('should dispatch loadWorkflows action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.loadWorkflows('client-1', 'agent-1', 'owner/repo', 'main');

      expect(spy).toHaveBeenCalledWith(
        loadWorkflows({ clientId: 'client-1', agentId: 'agent-1', repositoryId: 'owner/repo', branch: 'main' }),
      );
    });
  });

  describe('loadRuns', () => {
    it('should dispatch loadRuns action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.loadRuns('client-1', 'agent-1', 10, 0);

      expect(spy).toHaveBeenCalledWith(loadRuns({ clientId: 'client-1', agentId: 'agent-1', limit: 10, offset: 0 }));
    });
  });

  describe('triggerWorkflow', () => {
    it('should dispatch triggerWorkflow action', () => {
      const spy = jest.spyOn(store, 'dispatch');
      const dto = { workflowId: 'workflow-1', ref: 'main' };

      facade.triggerWorkflow('client-1', 'agent-1', dto);

      expect(spy).toHaveBeenCalledWith(triggerWorkflow({ clientId: 'client-1', agentId: 'agent-1', dto }));
    });
  });

  describe('loadRunStatus', () => {
    it('should dispatch loadRunStatus action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.loadRunStatus('client-1', 'agent-1', 'run-1');

      expect(spy).toHaveBeenCalledWith(loadRunStatus({ clientId: 'client-1', agentId: 'agent-1', runId: 'run-1' }));
    });
  });

  describe('loadRunLogs', () => {
    it('should dispatch loadRunLogs action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.loadRunLogs('client-1', 'agent-1', 'run-1');

      expect(spy).toHaveBeenCalledWith(loadRunLogs({ clientId: 'client-1', agentId: 'agent-1', runId: 'run-1' }));
    });
  });

  describe('cancelRun', () => {
    it('should dispatch cancelRun action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.cancelRun('client-1', 'agent-1', 'run-1');

      expect(spy).toHaveBeenCalledWith(cancelRun({ clientId: 'client-1', agentId: 'agent-1', runId: 'run-1' }));
    });
  });

  describe('loadRunJobs', () => {
    it('should dispatch loadRunJobs action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.loadRunJobs('client-1', 'agent-1', 'run-1');

      expect(spy).toHaveBeenCalledWith(loadRunJobs({ clientId: 'client-1', agentId: 'agent-1', runId: 'run-1' }));
    });
  });

  describe('loadJobLogs', () => {
    it('should dispatch loadJobLogs action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.loadJobLogs('client-1', 'agent-1', 'run-1', 'job-1');

      expect(spy).toHaveBeenCalledWith(
        loadJobLogs({ clientId: 'client-1', agentId: 'agent-1', runId: 'run-1', jobId: 'job-1' }),
      );
    });
  });
});
