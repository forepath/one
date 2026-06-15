import { initialDeploymentsState, type DeploymentsState } from './deployments.reducer';
import {
  selectBranches,
  selectCancelingRun,
  selectCreatingConfiguration,
  selectDeletingConfiguration,
  selectDeploymentConfiguration,
  selectDeploymentsError,
  selectDeploymentsState,
  selectJobById,
  selectJobLogs,
  selectJobs,
  selectJobsByStatus,
  selectLoadingConfiguration,
  selectLoadingDeploymentBranches,
  selectLoadingJobLogs,
  selectLoadingRepositories,
  selectLoadingRunJobs,
  selectLoadingRunLogs,
  selectLoadingRunStatus,
  selectLoadingRuns,
  selectLoadingWorkflows,
  selectRepositories,
  selectRunById,
  selectRunLogs,
  selectRuns,
  selectRunsByConclusion,
  selectRunsByStatus,
  selectTriggeringWorkflow,
  selectUpdatingConfiguration,
  selectWorkflows,
} from './deployments.selectors';
import type { Branch, DeploymentConfiguration, DeploymentRun, Job, Repository, Workflow } from './deployments.types';

describe('Deployments Selectors', () => {
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
  const createState = (overrides?: Partial<DeploymentsState>): DeploymentsState => ({
    ...initialDeploymentsState,
    ...overrides,
  });

  describe('selectDeploymentsState', () => {
    it('should select the deployments feature state', () => {
      const state = createState();
      const rootState = { deployments: state };
      const result = selectDeploymentsState(rootState as any);

      expect(result).toEqual(state);
    });
  });

  describe('selectDeploymentConfiguration', () => {
    it('should select deployment configuration', () => {
      const state = createState({ configuration: mockConfiguration });
      const rootState = { deployments: state };
      const result = selectDeploymentConfiguration(rootState as any);

      expect(result).toEqual(mockConfiguration);
    });

    it('should return null when no configuration exists', () => {
      const state = createState();
      const rootState = { deployments: state };
      const result = selectDeploymentConfiguration(rootState as any);

      expect(result).toBeNull();
    });
  });

  describe('selectRepositories', () => {
    it('should select repositories', () => {
      const state = createState({ repositories: [mockRepository] });
      const rootState = { deployments: state };
      const result = selectRepositories(rootState as any);

      expect(result).toEqual([mockRepository]);
    });
  });

  describe('selectBranches', () => {
    it('should select branches', () => {
      const state = createState({ branches: [mockBranch] });
      const rootState = { deployments: state };
      const result = selectBranches(rootState as any);

      expect(result).toEqual([mockBranch]);
    });
  });

  describe('selectWorkflows', () => {
    it('should select workflows', () => {
      const state = createState({ workflows: [mockWorkflow] });
      const rootState = { deployments: state };
      const result = selectWorkflows(rootState as any);

      expect(result).toEqual([mockWorkflow]);
    });
  });

  describe('selectRuns', () => {
    it('should select runs', () => {
      const state = createState({ runs: [mockRun] });
      const rootState = { deployments: state };
      const result = selectRuns(rootState as any);

      expect(result).toEqual([mockRun]);
    });
  });

  describe('selectJobs', () => {
    it('should select jobs', () => {
      const state = createState({ jobs: [mockJob] });
      const rootState = { deployments: state };
      const result = selectJobs(rootState as any);

      expect(result).toEqual([mockJob]);
    });
  });

  describe('selectRunLogs', () => {
    it('should select run logs', () => {
      const state = createState({ runLogs: 'Log content' });
      const rootState = { deployments: state };
      const result = selectRunLogs(rootState as any);

      expect(result).toBe('Log content');
    });
  });

  describe('selectJobLogs', () => {
    it('should select job logs', () => {
      const state = createState({ jobLogs: 'Job log content' });
      const rootState = { deployments: state };
      const result = selectJobLogs(rootState as any);

      expect(result).toBe('Job log content');
    });
  });

  describe('selectRunById', () => {
    it('should select a run by ID', () => {
      const run2 = { ...mockRun, id: 'run-2' };
      const state = createState({ runs: [mockRun, run2] });
      const rootState = { deployments: state };
      const selector = selectRunById('run-2');
      const result = selector(rootState as any);

      expect(result).toEqual(run2);
    });

    it('should return undefined for non-existent run', () => {
      const state = createState({ runs: [mockRun] });
      const rootState = { deployments: state };
      const selector = selectRunById('non-existent');
      const result = selector(rootState as any);

      expect(result).toBeUndefined();
    });
  });

  describe('selectRunsByStatus', () => {
    it('should filter runs by status', () => {
      const run2 = { ...mockRun, id: 'run-2', status: 'in_progress' };
      const run3 = { ...mockRun, id: 'run-3', status: 'completed' };
      const state = createState({ runs: [mockRun, run2, run3] });
      const rootState = { deployments: state };
      const selector = selectRunsByStatus('completed');
      const result = selector(rootState as any);

      expect(result).toEqual([mockRun, run3]);
    });
  });

  describe('selectRunsByConclusion', () => {
    it('should filter runs by conclusion', () => {
      const run2 = { ...mockRun, id: 'run-2', conclusion: 'failure' };
      const state = createState({ runs: [mockRun, run2] });
      const rootState = { deployments: state };
      const selector = selectRunsByConclusion('success');
      const result = selector(rootState as any);

      expect(result).toEqual([mockRun]);
    });
  });

  describe('selectJobById', () => {
    it('should select a job by ID', () => {
      const job2 = { ...mockJob, id: 'job-2' };
      const state = createState({ jobs: [mockJob, job2] });
      const rootState = { deployments: state };
      const selector = selectJobById('job-2');
      const result = selector(rootState as any);

      expect(result).toEqual(job2);
    });
  });

  describe('selectJobsByStatus', () => {
    it('should filter jobs by status', () => {
      const job2 = { ...mockJob, id: 'job-2', status: 'in_progress' };
      const state = createState({ jobs: [mockJob, job2] });
      const rootState = { deployments: state };
      const selector = selectJobsByStatus('completed');
      const result = selector(rootState as any);

      expect(result).toEqual([mockJob]);
    });
  });

  describe('loading state selectors', () => {
    it('should select loadingConfiguration', () => {
      const state = createState({ loadingConfiguration: true });
      const rootState = { deployments: state };
      const result = selectLoadingConfiguration(rootState as any);

      expect(result).toBe(true);
    });

    it('should select loadingRepositories', () => {
      const state = createState({ loadingRepositories: true });
      const rootState = { deployments: state };
      const result = selectLoadingRepositories(rootState as any);

      expect(result).toBe(true);
    });

    it('should select loadingBranches', () => {
      const state = createState({ loadingBranches: true });
      const rootState = { deployments: state };
      const result = selectLoadingDeploymentBranches(rootState as any);

      expect(result).toBe(true);
    });

    it('should select loadingWorkflows', () => {
      const state = createState({ loadingWorkflows: true });
      const rootState = { deployments: state };
      const result = selectLoadingWorkflows(rootState as any);

      expect(result).toBe(true);
    });

    it('should select loadingRuns', () => {
      const state = createState({ loadingRuns: true });
      const rootState = { deployments: state };
      const result = selectLoadingRuns(rootState as any);

      expect(result).toBe(true);
    });

    it('should select loadingRunStatus', () => {
      const state = createState({ loadingRunStatus: true });
      const rootState = { deployments: state };
      const result = selectLoadingRunStatus(rootState as any);

      expect(result).toBe(true);
    });

    it('should select loadingRunLogs', () => {
      const state = createState({ loadingRunLogs: true });
      const rootState = { deployments: state };
      const result = selectLoadingRunLogs(rootState as any);

      expect(result).toBe(true);
    });

    it('should select loadingRunJobs', () => {
      const state = createState({ loadingRunJobs: true });
      const rootState = { deployments: state };
      const result = selectLoadingRunJobs(rootState as any);

      expect(result).toBe(true);
    });

    it('should select loadingJobLogs', () => {
      const state = createState({ loadingJobLogs: true });
      const rootState = { deployments: state };
      const result = selectLoadingJobLogs(rootState as any);

      expect(result).toBe(true);
    });

    it('should select creatingConfiguration', () => {
      const state = createState({ creatingConfiguration: true });
      const rootState = { deployments: state };
      const result = selectCreatingConfiguration(rootState as any);

      expect(result).toBe(true);
    });

    it('should select updatingConfiguration', () => {
      const state = createState({ updatingConfiguration: true });
      const rootState = { deployments: state };
      const result = selectUpdatingConfiguration(rootState as any);

      expect(result).toBe(true);
    });

    it('should select deletingConfiguration', () => {
      const state = createState({ deletingConfiguration: true });
      const rootState = { deployments: state };
      const result = selectDeletingConfiguration(rootState as any);

      expect(result).toBe(true);
    });

    it('should select triggeringWorkflow', () => {
      const state = createState({ triggeringWorkflow: true });
      const rootState = { deployments: state };
      const result = selectTriggeringWorkflow(rootState as any);

      expect(result).toBe(true);
    });

    it('should select cancelingRun', () => {
      const state = createState({ cancelingRun: true });
      const rootState = { deployments: state };
      const result = selectCancelingRun(rootState as any);

      expect(result).toBe(true);
    });
  });

  describe('selectDeploymentsError', () => {
    it('should select error', () => {
      const state = createState({ error: 'Test error' });
      const rootState = { deployments: state };
      const result = selectDeploymentsError(rootState as any);

      expect(result).toBe('Test error');
    });
  });
});
