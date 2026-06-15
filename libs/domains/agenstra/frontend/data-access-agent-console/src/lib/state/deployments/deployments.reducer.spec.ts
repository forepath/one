import {
  cancelRun,
  cancelRunSuccess,
  createDeploymentConfiguration,
  createDeploymentConfigurationSuccess,
  deleteDeploymentConfiguration,
  deleteDeploymentConfigurationSuccess,
  loadBranches,
  loadBranchesSuccess,
  loadDeploymentConfiguration,
  loadDeploymentConfigurationFailure,
  loadDeploymentConfigurationSuccess,
  loadJobLogs,
  loadJobLogsSuccess,
  loadRepositories,
  loadRepositoriesSuccess,
  loadRunJobs,
  loadRunJobsSuccess,
  loadRunLogs,
  loadRunLogsSuccess,
  loadRunStatus,
  loadRunStatusSuccess,
  loadRuns,
  loadRunsSuccess,
  loadWorkflows,
  loadWorkflowsSuccess,
  triggerWorkflow,
  triggerWorkflowSuccess,
  updateDeploymentConfiguration,
  updateDeploymentConfigurationSuccess,
} from './deployments.actions';
import { deploymentsReducer, initialDeploymentsState, type DeploymentsState } from './deployments.reducer';
import type { Branch, DeploymentConfiguration, DeploymentRun, Job, Repository, Workflow } from './deployments.types';

describe('DeploymentsReducer', () => {
  const mockConfiguration: DeploymentConfiguration = {
    id: 'config-1',
    agentId: 'agent-1',
    providerType: 'github',
    repositoryId: 'owner/repo',
    defaultBranch: 'main',
    workflowId: 'workflow.yml',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockRepository: Repository = {
    id: 'repo-1',
    name: 'test-repo',
    fullName: 'owner/test-repo',
    defaultBranch: 'main',
    url: 'https://github.com/owner/test-repo',
    private: false,
  };
  const mockBranch: Branch = {
    name: 'main',
    sha: 'abc123',
    default: true,
  };
  const mockWorkflow: Workflow = {
    id: 'workflow-1',
    name: 'CI Workflow',
    path: '.github/workflows/ci.yml',
    state: 'active',
    canTrigger: true,
  };
  const mockRun: DeploymentRun = {
    id: 'run-1',
    configurationId: 'config-1',
    providerRunId: 'provider-run-1',
    runName: 'Test Run',
    status: 'completed',
    conclusion: 'success',
    ref: 'main',
    sha: 'abc123',
    workflowId: 'workflow-1',
    workflowName: 'CI Workflow',
    startedAt: new Date('2024-01-01'),
    completedAt: new Date('2024-01-01'),
    htmlUrl: 'https://github.com/owner/repo/actions/runs/1',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockJob: Job = {
    id: 'job-1',
    name: 'Build',
    status: 'completed',
    conclusion: 'success',
    startedAt: new Date('2024-01-01'),
    completedAt: new Date('2024-01-01'),
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };
      const state = deploymentsReducer(undefined, action as any);

      expect(state).toEqual(initialDeploymentsState);
    });
  });

  describe('loadDeploymentConfiguration', () => {
    it('should set loadingConfiguration to true and clear error', () => {
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        error: 'Previous error',
      };
      const newState = deploymentsReducer(
        state,
        loadDeploymentConfiguration({ clientId: 'client-1', agentId: 'agent-1' }),
      );

      expect(newState.loadingConfiguration).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadDeploymentConfigurationSuccess', () => {
    it('should store configuration and set loadingConfiguration to false', () => {
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        loadingConfiguration: true,
      };
      const newState = deploymentsReducer(
        state,
        loadDeploymentConfigurationSuccess({ configuration: mockConfiguration }),
      );

      expect(newState.configuration).toEqual(mockConfiguration);
      expect(newState.loadingConfiguration).toBe(false);
      expect(newState.error).toBeNull();
    });

    it('should handle null configuration', () => {
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        loadingConfiguration: true,
      };
      const newState = deploymentsReducer(state, loadDeploymentConfigurationSuccess({ configuration: null }));

      expect(newState.configuration).toBeNull();
      expect(newState.loadingConfiguration).toBe(false);
    });
  });

  describe('loadDeploymentConfigurationFailure', () => {
    it('should set error and set loadingConfiguration to false', () => {
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        loadingConfiguration: true,
      };
      const newState = deploymentsReducer(
        state,
        loadDeploymentConfigurationFailure({ error: 'Failed to load configuration' }),
      );

      expect(newState.loadingConfiguration).toBe(false);
      expect(newState.error).toBe('Failed to load configuration');
    });
  });

  describe('createDeploymentConfiguration', () => {
    it('should set creatingConfiguration to true', () => {
      const newState = deploymentsReducer(
        initialDeploymentsState,
        createDeploymentConfiguration({
          clientId: 'client-1',
          agentId: 'agent-1',
          dto: { providerType: 'github', repositoryId: 'owner/repo', providerToken: 'token' },
        }),
      );

      expect(newState.creatingConfiguration).toBe(true);
    });
  });

  describe('createDeploymentConfigurationSuccess', () => {
    it('should store configuration and set creatingConfiguration to false', () => {
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        creatingConfiguration: true,
      };
      const newState = deploymentsReducer(
        state,
        createDeploymentConfigurationSuccess({ configuration: mockConfiguration }),
      );

      expect(newState.configuration).toEqual(mockConfiguration);
      expect(newState.creatingConfiguration).toBe(false);
    });
  });

  describe('updateDeploymentConfiguration', () => {
    it('should set updatingConfiguration to true', () => {
      const newState = deploymentsReducer(
        initialDeploymentsState,
        updateDeploymentConfiguration({
          clientId: 'client-1',
          agentId: 'agent-1',
          dto: { repositoryId: 'owner/new-repo' },
        }),
      );

      expect(newState.updatingConfiguration).toBe(true);
    });
  });

  describe('updateDeploymentConfigurationSuccess', () => {
    it('should update configuration and set updatingConfiguration to false', () => {
      const updatedConfig = { ...mockConfiguration, repositoryId: 'owner/new-repo' };
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        configuration: mockConfiguration,
        updatingConfiguration: true,
      };
      const newState = deploymentsReducer(
        state,
        updateDeploymentConfigurationSuccess({ configuration: updatedConfig }),
      );

      expect(newState.configuration).toEqual(updatedConfig);
      expect(newState.updatingConfiguration).toBe(false);
    });
  });

  describe('deleteDeploymentConfiguration', () => {
    it('should set deletingConfiguration to true', () => {
      const newState = deploymentsReducer(
        initialDeploymentsState,
        deleteDeploymentConfiguration({ clientId: 'client-1', agentId: 'agent-1' }),
      );

      expect(newState.deletingConfiguration).toBe(true);
    });
  });

  describe('deleteDeploymentConfigurationSuccess', () => {
    it('should clear configuration and set deletingConfiguration to false', () => {
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        configuration: mockConfiguration,
        deletingConfiguration: true,
      };
      const newState = deploymentsReducer(state, deleteDeploymentConfigurationSuccess());

      expect(newState.configuration).toBeNull();
      expect(newState.deletingConfiguration).toBe(false);
    });
  });

  describe('loadRepositories', () => {
    it('should set loadingRepositories to true', () => {
      const newState = deploymentsReducer(
        initialDeploymentsState,
        loadRepositories({ clientId: 'client-1', agentId: 'agent-1' }),
      );

      expect(newState.loadingRepositories).toBe(true);
    });
  });

  describe('loadRepositoriesSuccess', () => {
    it('should store repositories and set loadingRepositories to false', () => {
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        loadingRepositories: true,
      };
      const newState = deploymentsReducer(state, loadRepositoriesSuccess({ repositories: [mockRepository] }));

      expect(newState.repositories).toEqual([mockRepository]);
      expect(newState.loadingRepositories).toBe(false);
    });
  });

  describe('loadBranches', () => {
    it('should set loadingBranches to true', () => {
      const newState = deploymentsReducer(
        initialDeploymentsState,
        loadBranches({ clientId: 'client-1', agentId: 'agent-1', repositoryId: 'owner/repo' }),
      );

      expect(newState.loadingBranches).toBe(true);
    });
  });

  describe('loadBranchesSuccess', () => {
    it('should store branches and set loadingBranches to false', () => {
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        loadingBranches: true,
      };
      const newState = deploymentsReducer(state, loadBranchesSuccess({ branches: [mockBranch] }));

      expect(newState.branches).toEqual([mockBranch]);
      expect(newState.loadingBranches).toBe(false);
    });
  });

  describe('loadWorkflows', () => {
    it('should set loadingWorkflows to true', () => {
      const newState = deploymentsReducer(
        initialDeploymentsState,
        loadWorkflows({ clientId: 'client-1', agentId: 'agent-1', repositoryId: 'owner/repo' }),
      );

      expect(newState.loadingWorkflows).toBe(true);
    });
  });

  describe('loadWorkflowsSuccess', () => {
    it('should store workflows and set loadingWorkflows to false', () => {
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        loadingWorkflows: true,
      };
      const newState = deploymentsReducer(state, loadWorkflowsSuccess({ workflows: [mockWorkflow] }));

      expect(newState.workflows).toEqual([mockWorkflow]);
      expect(newState.loadingWorkflows).toBe(false);
    });
  });

  describe('loadRuns', () => {
    it('should set loadingRuns to true', () => {
      const newState = deploymentsReducer(
        initialDeploymentsState,
        loadRuns({ clientId: 'client-1', agentId: 'agent-1' }),
      );

      expect(newState.loadingRuns).toBe(true);
    });
  });

  describe('loadRunsSuccess', () => {
    it('should store runs and set loadingRuns to false', () => {
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        loadingRuns: true,
      };
      const newState = deploymentsReducer(state, loadRunsSuccess({ runs: [mockRun] }));

      expect(newState.runs).toEqual([mockRun]);
      expect(newState.loadingRuns).toBe(false);
    });
  });

  describe('triggerWorkflow', () => {
    it('should set triggeringWorkflow to true', () => {
      const newState = deploymentsReducer(
        initialDeploymentsState,
        triggerWorkflow({
          clientId: 'client-1',
          agentId: 'agent-1',
          dto: { workflowId: 'workflow-1', ref: 'main' },
        }),
      );

      expect(newState.triggeringWorkflow).toBe(true);
    });
  });

  describe('triggerWorkflowSuccess', () => {
    it('should add run to runs array and set triggeringWorkflow to false', () => {
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        triggeringWorkflow: true,
        runs: [],
      };
      const newState = deploymentsReducer(state, triggerWorkflowSuccess({ run: mockRun }));

      expect(newState.runs).toEqual([mockRun]);
      expect(newState.triggeringWorkflow).toBe(false);
    });
  });

  describe('loadRunStatus', () => {
    it('should set loadingRunStatus to true', () => {
      const newState = deploymentsReducer(
        initialDeploymentsState,
        loadRunStatus({ clientId: 'client-1', agentId: 'agent-1', runId: 'run-1' }),
      );

      expect(newState.loadingRunStatus).toBe(true);
    });
  });

  describe('loadRunStatusSuccess', () => {
    it('should update run in runs array and set loadingRunStatus to false', () => {
      const updatedRun = { ...mockRun, status: 'in_progress' };
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        runs: [mockRun],
        loadingRunStatus: true,
      };
      const newState = deploymentsReducer(state, loadRunStatusSuccess({ run: updatedRun }));

      expect(newState.runs).toEqual([updatedRun]);
      expect(newState.loadingRunStatus).toBe(false);
    });
  });

  describe('loadRunLogs', () => {
    it('should set loadingRunLogs to true', () => {
      const newState = deploymentsReducer(
        initialDeploymentsState,
        loadRunLogs({ clientId: 'client-1', agentId: 'agent-1', runId: 'run-1' }),
      );

      expect(newState.loadingRunLogs).toBe(true);
    });
  });

  describe('loadRunLogsSuccess', () => {
    it('should store run logs and set loadingRunLogs to false', () => {
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        loadingRunLogs: true,
      };
      const newState = deploymentsReducer(state, loadRunLogsSuccess({ logs: 'Log content' }));

      expect(newState.runLogs).toBe('Log content');
      expect(newState.loadingRunLogs).toBe(false);
    });
  });

  describe('cancelRun', () => {
    it('should set cancelingRun to true', () => {
      const newState = deploymentsReducer(
        initialDeploymentsState,
        cancelRun({ clientId: 'client-1', agentId: 'agent-1', runId: 'run-1' }),
      );

      expect(newState.cancelingRun).toBe(true);
    });
  });

  describe('cancelRunSuccess', () => {
    it('should set cancelingRun to false', () => {
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        cancelingRun: true,
      };
      const newState = deploymentsReducer(state, cancelRunSuccess());

      expect(newState.cancelingRun).toBe(false);
    });
  });

  describe('loadRunJobs', () => {
    it('should set loadingRunJobs to true', () => {
      const newState = deploymentsReducer(
        initialDeploymentsState,
        loadRunJobs({ clientId: 'client-1', agentId: 'agent-1', runId: 'run-1' }),
      );

      expect(newState.loadingRunJobs).toBe(true);
    });
  });

  describe('loadRunJobsSuccess', () => {
    it('should store jobs and set loadingRunJobs to false', () => {
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        loadingRunJobs: true,
      };
      const newState = deploymentsReducer(state, loadRunJobsSuccess({ jobs: [mockJob] }));

      expect(newState.jobs).toEqual([mockJob]);
      expect(newState.loadingRunJobs).toBe(false);
    });
  });

  describe('loadJobLogs', () => {
    it('should set loadingJobLogs to true', () => {
      const newState = deploymentsReducer(
        initialDeploymentsState,
        loadJobLogs({ clientId: 'client-1', agentId: 'agent-1', runId: 'run-1', jobId: 'job-1' }),
      );

      expect(newState.loadingJobLogs).toBe(true);
    });
  });

  describe('loadJobLogsSuccess', () => {
    it('should store job logs and set loadingJobLogs to false', () => {
      const state: DeploymentsState = {
        ...initialDeploymentsState,
        loadingJobLogs: true,
      };
      const newState = deploymentsReducer(state, loadJobLogsSuccess({ logs: 'Job log content' }));

      expect(newState.jobLogs).toBe('Job log content');
      expect(newState.loadingJobLogs).toBe(false);
    });
  });
});
