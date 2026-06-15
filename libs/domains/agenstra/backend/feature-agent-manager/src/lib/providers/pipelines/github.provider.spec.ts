import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import axios, { AxiosError } from 'axios';

import { PipelineProviderCredentials } from '../pipeline-provider.interface';

import { GitHubProvider } from './github.provider';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GitHubProvider', () => {
  let provider: GitHubProvider;
  let mockAxiosInstance: {
    get: jest.Mock;
    post: jest.Mock;
  };
  const mockCredentials: PipelineProviderCredentials = {
    token: 'ghp_test-token',
  };
  const mockCredentialsWithBaseUrl: PipelineProviderCredentials = {
    token: 'ghp_test-token',
    baseUrl: 'https://github.example.com/api',
  };

  beforeEach(async () => {
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
    };

    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    const module: TestingModule = await Test.createTestingModule({
      providers: [GitHubProvider],
    }).compile();

    provider = module.get<GitHubProvider>(GitHubProvider);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getType', () => {
    it('should return github', () => {
      expect(provider.getType()).toBe('github');
    });
  });

  describe('getDisplayName', () => {
    it('should return GitHub Actions', () => {
      expect(provider.getDisplayName()).toBe('GitHub Actions');
    });
  });

  describe('listRepositories', () => {
    it('should list repositories successfully', async () => {
      const mockRepos = [
        {
          full_name: 'owner/repo1',
          name: 'repo1',
          default_branch: 'main',
          html_url: 'https://github.com/owner/repo1',
          private: false,
        },
        {
          full_name: 'owner/repo2',
          name: 'repo2',
          default_branch: 'master',
          html_url: 'https://github.com/owner/repo2',
          private: true,
        },
      ];

      mockAxiosInstance.get.mockResolvedValue({ data: mockRepos });

      const result = await provider.listRepositories(mockCredentials);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'owner/repo1',
        name: 'repo1',
        fullName: 'owner/repo1',
        defaultBranch: 'main',
        url: 'https://github.com/owner/repo1',
        private: false,
      });
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/user/repos', {
        params: {
          per_page: 100,
          sort: 'updated',
          type: 'all',
        },
      });
    });

    it('should handle errors', async () => {
      const error = new Error('API Error') as AxiosError;

      mockAxiosInstance.get.mockRejectedValue(error);

      await expect(provider.listRepositories(mockCredentials)).rejects.toThrow(BadRequestException);
    });

    it('should use custom base URL when provided', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: [] });

      await provider.listRepositories(mockCredentialsWithBaseUrl);

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://github.example.com/api',
        }),
      );
    });
  });

  describe('listBranches', () => {
    it('should list branches successfully', async () => {
      const mockRepo = { default_branch: 'main' };
      const mockBranches = [
        { name: 'main', commit: { sha: 'abc123' } },
        { name: 'develop', commit: { sha: 'def456' } },
      ];

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockRepo }).mockResolvedValueOnce({ data: mockBranches });

      const result = await provider.listBranches(mockCredentials, 'owner/repo');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'main',
        sha: 'abc123',
        default: true,
      });
      expect(result[1].default).toBe(false);
    });

    it('should throw error for invalid repository ID format', async () => {
      await expect(provider.listBranches(mockCredentials, 'invalid')).rejects.toThrow(BadRequestException);
    });
  });

  describe('listWorkflows', () => {
    it('should list workflows successfully', async () => {
      const mockWorkflows = {
        workflows: [
          { id: 123, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' },
          { id: 456, name: 'Deploy', path: '.github/workflows/deploy.yml', state: 'active' },
        ],
      };

      mockAxiosInstance.get.mockResolvedValue({ data: mockWorkflows });

      const result = await provider.listWorkflows(mockCredentials, 'owner/repo');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: '123',
        name: 'CI',
        path: '.github/workflows/ci.yml',
        state: 'active',
        canTrigger: true,
      });
    });
  });

  describe('triggerWorkflow', () => {
    it('should trigger workflow successfully', async () => {
      const mockWorkflow = { name: 'CI Workflow' };
      const mockRuns = {
        workflow_runs: [
          {
            id: 789,
            name: 'CI Workflow',
            status: 'queued',
            conclusion: null,
            head_branch: 'main',
            head_sha: 'abc123',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            run_started_at: null,
            workflow_id: 123,
            html_url: 'https://github.com/owner/repo/actions/runs/789',
          },
        ],
      };

      // Mock branch validation check (first GET call)
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: {} }) // Branch exists
        .mockResolvedValueOnce({ data: mockWorkflow }) // Get workflow name
        .mockResolvedValueOnce({ data: mockRuns }); // Get workflow runs
      mockAxiosInstance.post.mockResolvedValue({ status: 204 }); // GitHub returns 204 on success

      // Use fake timers to handle setTimeout
      jest.useFakeTimers();
      const resultPromise = provider.triggerWorkflow(mockCredentials, 'owner/repo', '123', 'main');

      jest.advanceTimersByTime(1000);
      jest.useRealTimers();

      const result = await resultPromise;

      expect(result.id).toBe('789');
      expect(result.status).toBe('queued');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/repos/owner/repo/git/ref/heads/main');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/repos/owner/repo/actions/workflows/123/dispatches', {
        ref: 'main',
        inputs: {},
      });
    });

    it('should include inputs when provided', async () => {
      const mockWorkflow = { name: 'CI Workflow' };
      const mockRuns = {
        workflow_runs: [
          {
            id: 789,
            name: 'CI Workflow',
            status: 'queued',
            conclusion: null,
            head_branch: 'main',
            head_sha: 'abc123',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            run_started_at: null,
            workflow_id: 123,
            html_url: 'https://github.com/owner/repo/actions/runs/789',
          },
        ],
      };

      // Mock branch validation check (first GET call)
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: {} }) // Branch exists
        .mockResolvedValueOnce({ data: mockWorkflow }) // Get workflow name
        .mockResolvedValueOnce({ data: mockRuns }); // Get workflow runs
      mockAxiosInstance.post.mockResolvedValue({ status: 204 }); // GitHub returns 204 on success

      // Use fake timers to handle setTimeout
      jest.useFakeTimers();
      const resultPromise = provider.triggerWorkflow(mockCredentials, 'owner/repo', '123', 'main', {
        environment: 'production',
      });

      jest.advanceTimersByTime(1000);
      jest.useRealTimers();

      await resultPromise;

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/repos/owner/repo/git/ref/heads/main');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/repos/owner/repo/actions/workflows/123/dispatches', {
        ref: 'main',
        inputs: { environment: 'production' },
      });
    });

    it('should throw error when branch does not exist', async () => {
      const branchError = {
        response: { status: 404 },
        message: 'Not Found',
      } as AxiosError;

      // First call
      mockAxiosInstance.get.mockRejectedValueOnce(branchError);
      await expect(provider.triggerWorkflow(mockCredentials, 'owner/repo', '123', 'nonexistent')).rejects.toThrow(
        BadRequestException,
      );

      // Second call - need to set up mocks again
      mockAxiosInstance.get.mockRejectedValueOnce(branchError);
      await expect(provider.triggerWorkflow(mockCredentials, 'owner/repo', '123', 'nonexistent')).rejects.toThrow(
        "Branch 'nonexistent' does not exist in the repository",
      );
    });

    it('should handle 422 error with workflow_dispatch message', async () => {
      const workflowDispatchError = {
        response: {
          status: 422,
          data: {
            message: 'No ref found for: main',
            errors: [{ message: 'Workflow does not have workflow_dispatch trigger' }],
          },
        },
        message: 'Request failed with status code 422',
      } as AxiosError;

      // First call - Mock branch validation check (first GET call succeeds)
      mockAxiosInstance.get.mockResolvedValueOnce({ data: {} });
      mockAxiosInstance.post.mockRejectedValueOnce(workflowDispatchError);
      await expect(provider.triggerWorkflow(mockCredentials, 'owner/repo', '123', 'main')).rejects.toThrow(
        BadRequestException,
      );

      // Second call - need to set up mocks again
      mockAxiosInstance.get.mockResolvedValueOnce({ data: {} });
      mockAxiosInstance.post.mockRejectedValueOnce(workflowDispatchError);
      await expect(provider.triggerWorkflow(mockCredentials, 'owner/repo', '123', 'main')).rejects.toThrow(
        'Workflow cannot be triggered. This usually means the workflow does not support manual triggers (workflow_dispatch)',
      );
    });

    it('should handle 422 error with message from response', async () => {
      const workflowDispatchError = {
        response: {
          status: 422,
          data: {
            message: 'No ref found for: main',
          },
        },
        message: 'Request failed with status code 422',
      } as AxiosError;

      // First call - Mock branch validation check (first GET call succeeds)
      mockAxiosInstance.get.mockResolvedValueOnce({ data: {} });
      mockAxiosInstance.post.mockRejectedValueOnce(workflowDispatchError);
      await expect(provider.triggerWorkflow(mockCredentials, 'owner/repo', '123', 'main')).rejects.toThrow(
        BadRequestException,
      );

      // Second call - need to set up mocks again
      mockAxiosInstance.get.mockResolvedValueOnce({ data: {} });
      mockAxiosInstance.post.mockRejectedValueOnce(workflowDispatchError);
      await expect(provider.triggerWorkflow(mockCredentials, 'owner/repo', '123', 'main')).rejects.toThrow(
        'Workflow cannot be triggered. This usually means the workflow does not support manual triggers (workflow_dispatch)',
      );
    });

    it('should handle 422 error with errors array', async () => {
      const workflowDispatchError = {
        response: {
          status: 422,
          data: {
            errors: [{ message: 'Workflow does not have workflow_dispatch trigger' }, { message: 'Invalid ref' }],
          },
        },
        message: 'Request failed with status code 422',
      } as AxiosError;

      // First call - Mock branch validation check (first GET call succeeds)
      mockAxiosInstance.get.mockResolvedValueOnce({ data: {} });
      mockAxiosInstance.post.mockRejectedValueOnce(workflowDispatchError);
      await expect(provider.triggerWorkflow(mockCredentials, 'owner/repo', '123', 'main')).rejects.toThrow(
        BadRequestException,
      );

      // Second call - need to set up mocks again
      mockAxiosInstance.get.mockResolvedValueOnce({ data: {} });
      mockAxiosInstance.post.mockRejectedValueOnce(workflowDispatchError);
      await expect(provider.triggerWorkflow(mockCredentials, 'owner/repo', '123', 'main')).rejects.toThrow(
        'Workflow cannot be triggered. This usually means the workflow does not support manual triggers (workflow_dispatch)',
      );
    });

    it('should handle other errors with detailed message', async () => {
      const genericError = {
        response: {
          status: 500,
          data: {
            message: 'Internal server error',
          },
        },
        message: 'Request failed with status code 500',
      } as AxiosError;

      // First call - Mock branch validation check (first GET call succeeds)
      mockAxiosInstance.get.mockResolvedValueOnce({ data: {} });
      mockAxiosInstance.post.mockRejectedValueOnce(genericError);
      await expect(provider.triggerWorkflow(mockCredentials, 'owner/repo', '123', 'main')).rejects.toThrow(
        BadRequestException,
      );

      // Second call - need to set up mocks again
      mockAxiosInstance.get.mockResolvedValueOnce({ data: {} });
      mockAxiosInstance.post.mockRejectedValueOnce(genericError);
      await expect(provider.triggerWorkflow(mockCredentials, 'owner/repo', '123', 'main')).rejects.toThrow(
        'Failed to trigger workflow: Internal server error',
      );
    });

    it('should continue if branch check fails with non-404 error', async () => {
      const mockWorkflow = { name: 'CI Workflow' };
      const mockRuns = {
        workflow_runs: [
          {
            id: 789,
            name: 'CI Workflow',
            status: 'queued',
            conclusion: null,
            head_branch: 'main',
            head_sha: 'abc123',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            run_started_at: null,
            workflow_id: 123,
            html_url: 'https://github.com/owner/repo/actions/runs/789',
          },
        ],
      };
      // Mock branch validation check fails with 500 (non-404), but we continue
      const branchError = {
        response: { status: 500 },
        message: 'Internal server error',
      } as AxiosError;

      mockAxiosInstance.get
        .mockRejectedValueOnce(branchError) // Branch check fails but not 404
        .mockResolvedValueOnce({ data: mockWorkflow }) // Get workflow name
        .mockResolvedValueOnce({ data: mockRuns }); // Get workflow runs
      mockAxiosInstance.post.mockResolvedValue({ status: 204 }); // GitHub returns 204 on success

      // Use fake timers to handle setTimeout
      jest.useFakeTimers();
      const resultPromise = provider.triggerWorkflow(mockCredentials, 'owner/repo', '123', 'main');

      jest.advanceTimersByTime(1000);
      jest.useRealTimers();

      const result = await resultPromise;

      expect(result.id).toBe('789');
      expect(result.status).toBe('queued');
    });
  });

  describe('getRunStatus', () => {
    it('should get run status successfully', async () => {
      const mockRun = {
        id: 789,
        name: 'CI Workflow',
        status: 'completed',
        conclusion: 'success',
        head_branch: 'main',
        head_sha: 'abc123',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        run_started_at: '2024-01-01T00:01:00Z',
        completed_at: '2024-01-01T00:05:00Z',
        workflow_id: 123,
        html_url: 'https://github.com/owner/repo/actions/runs/789',
      };
      const mockWorkflow = { name: 'CI Workflow' };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockRun }).mockResolvedValueOnce({ data: mockWorkflow });

      const result = await provider.getRunStatus(mockCredentials, 'owner/repo', '789');

      expect(result.id).toBe('789');
      expect(result.status).toBe('completed');
      expect(result.conclusion).toBe('success');
    });
  });

  describe('getRunLogs', () => {
    it('should get run logs successfully', async () => {
      const mockJobs = { jobs: [{ id: 1 }, { id: 2 }] };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockJobs });

      // Mock getJobLogs
      mockAxiosInstance.get
        .mockResolvedValueOnce({ status: 302, headers: { location: 'https://logs.example.com' } })
        .mockResolvedValueOnce({ status: 302, headers: { location: 'https://logs.example.com' } });

      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: 'Job 1 logs' })
        .mockResolvedValueOnce({ data: 'Job 2 logs' });

      const result = await provider.getRunLogs(mockCredentials, 'owner/repo', '789');

      expect(result).toContain('Job 1 logs');
      expect(result).toContain('Job 2 logs');
    });
  });

  describe('listRunJobs', () => {
    it('should list jobs successfully', async () => {
      const mockJobs = {
        jobs: [
          {
            id: 1,
            name: 'Build',
            status: 'completed',
            conclusion: 'success',
            started_at: '2024-01-01T00:01:00Z',
            completed_at: '2024-01-01T00:02:00Z',
          },
          {
            id: 2,
            name: 'Test',
            status: 'completed',
            conclusion: 'success',
            started_at: '2024-01-01T00:02:00Z',
            completed_at: '2024-01-01T00:03:00Z',
          },
        ],
      };

      mockAxiosInstance.get.mockResolvedValue({ data: mockJobs });

      const result = await provider.listRunJobs(mockCredentials, 'owner/repo', '789');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: '1',
        name: 'Build',
        status: 'completed',
        conclusion: 'success',
        startedAt: new Date('2024-01-01T00:01:00Z'),
        completedAt: new Date('2024-01-01T00:02:00Z'),
      });
    });
  });

  describe('cancelRun', () => {
    it('should cancel run successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: {} });

      await provider.cancelRun(mockCredentials, 'owner/repo', '789');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/repos/owner/repo/actions/runs/789/cancel');
    });
  });
});
