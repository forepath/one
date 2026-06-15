import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import axios, { AxiosError } from 'axios';

import { PipelineProviderCredentials } from '../pipeline-provider.interface';

import { GitLabProvider } from './gitlab.provider';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GitLabProvider', () => {
  let provider: GitLabProvider;
  let mockAxiosInstance: {
    get: jest.Mock;
    post: jest.Mock;
  };
  const mockCredentials: PipelineProviderCredentials = {
    token: 'glpat-test-token',
  };
  const mockCredentialsWithBaseUrl: PipelineProviderCredentials = {
    token: 'glpat-test-token',
    baseUrl: 'https://gitlab.example.com',
  };

  beforeEach(async () => {
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
    };

    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    const module: TestingModule = await Test.createTestingModule({
      providers: [GitLabProvider],
    }).compile();

    provider = module.get<GitLabProvider>(GitLabProvider);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getType', () => {
    it('should return gitlab', () => {
      expect(provider.getType()).toBe('gitlab');
    });
  });

  describe('getDisplayName', () => {
    it('should return GitLab CI/CD', () => {
      expect(provider.getDisplayName()).toBe('GitLab CI/CD');
    });
  });

  describe('listRepositories', () => {
    it('should list repositories successfully', async () => {
      const mockProjects = [
        {
          id: 1,
          path: 'project1',
          path_with_namespace: 'group/project1',
          default_branch: 'main',
          web_url: 'https://gitlab.com/group/project1',
          visibility: 'public',
        },
        {
          id: 2,
          path: 'project2',
          path_with_namespace: 'group/project2',
          default_branch: 'master',
          web_url: 'https://gitlab.com/group/project2',
          visibility: 'private',
        },
      ];

      mockAxiosInstance.get.mockResolvedValue({ data: mockProjects });

      const result = await provider.listRepositories(mockCredentials);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'group/project1',
        name: 'project1',
        fullName: 'group/project1',
        defaultBranch: 'main',
        url: 'https://gitlab.com/group/project1',
        private: false,
      });
      expect(result[1].private).toBe(true);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/projects', {
        params: {
          per_page: 100,
          order_by: 'last_activity_at',
          sort: 'desc',
          membership: true,
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
          baseURL: 'https://gitlab.example.com/api/v4',
        }),
      );
    });

    it('should handle base URL with /api/v4 already present', async () => {
      const credentials: PipelineProviderCredentials = {
        token: 'glpat-test-token',
        baseUrl: 'https://gitlab.example.com/api/v4',
      };

      mockAxiosInstance.get.mockResolvedValue({ data: [] });

      await provider.listRepositories(credentials);

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://gitlab.example.com/api/v4',
        }),
      );
    });
  });

  describe('listBranches', () => {
    it('should list branches successfully', async () => {
      const mockProject = { default_branch: 'main' };
      const mockBranches = [
        { name: 'main', commit: { id: 'abc123' } },
        { name: 'develop', commit: { id: 'def456' } },
      ];

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockProject }).mockResolvedValueOnce({ data: mockBranches });

      const result = await provider.listBranches(mockCredentials, 'group/project');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'main',
        sha: 'abc123',
        default: true,
      });
      expect(result[1].default).toBe(false);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/projects/group%2Fproject/repository/branches', {
        params: {
          per_page: 100,
        },
      });
    });

    it('should handle missing default branch', async () => {
      const mockProject = { default_branch: null };
      const mockBranches = [{ name: 'main', commit: { id: 'abc123' } }];

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockProject }).mockResolvedValueOnce({ data: mockBranches });

      const result = await provider.listBranches(mockCredentials, 'group/project');

      expect(result[0].default).toBe(true); // Should default to main
    });
  });

  describe('listWorkflows', () => {
    it('should list workflows successfully', async () => {
      const mockProject = { default_branch: 'main' };
      const mockPipelines = [
        { id: 1, ref: 'main', status: 'success', source: 'push' },
        { id: 2, ref: 'main', status: 'success', source: 'manual' },
      ];

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockProject }).mockResolvedValueOnce({ data: mockPipelines });

      const result = await provider.listWorkflows(mockCredentials, 'group/project', 'main');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toEqual({
        id: 'pipeline-main',
        name: 'Pipeline for main',
        path: '.gitlab-ci.yml',
        state: 'active',
        canTrigger: true,
      });
    });
  });

  describe('triggerWorkflow', () => {
    it('should trigger pipeline successfully', async () => {
      const mockPipeline = {
        id: 789,
        ref: 'main',
        sha: 'abc123',
        status: 'pending',
        web_url: 'https://gitlab.com/group/project/-/pipelines/789',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        started_at: null,
        finished_at: null,
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockPipeline });
      mockAxiosInstance.get.mockResolvedValue({ data: mockPipeline });

      jest.useFakeTimers();
      const resultPromise = provider.triggerWorkflow(mockCredentials, 'group/project', 'pipeline-main', 'main');

      jest.advanceTimersByTime(1000);
      jest.useRealTimers();

      const result = await resultPromise;

      expect(result.id).toBe('789');
      expect(result.status).toBe('queued');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/projects/group%2Fproject/pipeline', {
        ref: 'main',
      });
    });

    it('should include variables when provided', async () => {
      const mockPipeline = {
        id: 789,
        ref: 'main',
        sha: 'abc123',
        status: 'pending',
        web_url: 'https://gitlab.com/group/project/-/pipelines/789',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        started_at: null,
        finished_at: null,
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockPipeline });
      mockAxiosInstance.get.mockResolvedValue({ data: mockPipeline });

      jest.useFakeTimers();
      const resultPromise = provider.triggerWorkflow(mockCredentials, 'group/project', 'pipeline-main', 'main', {
        environment: 'production',
      });

      jest.advanceTimersByTime(1000);
      jest.useRealTimers();

      await resultPromise;

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/projects/group%2Fproject/pipeline', {
        ref: 'main',
        variables: [{ key: 'environment', value: 'production' }],
      });
    });
  });

  describe('getRunStatus', () => {
    it('should get pipeline status successfully', async () => {
      const mockPipeline = {
        id: 789,
        ref: 'main',
        sha: 'abc123',
        status: 'success',
        web_url: 'https://gitlab.com/group/project/-/pipelines/789',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        started_at: '2024-01-01T00:01:00Z',
        finished_at: '2024-01-01T00:05:00Z',
      };

      mockAxiosInstance.get.mockResolvedValue({ data: mockPipeline });

      const result = await provider.getRunStatus(mockCredentials, 'group/project', '789');

      expect(result.id).toBe('789');
      expect(result.status).toBe('completed');
      expect(result.conclusion).toBe('success');
    });
  });

  describe('getRunLogs', () => {
    it('should get pipeline logs successfully', async () => {
      const mockJobs = [{ id: 1 }, { id: 2 }];

      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: mockJobs })
        .mockResolvedValueOnce({ data: 'Job 1 logs' })
        .mockResolvedValueOnce({ data: 'Job 2 logs' });

      const result = await provider.getRunLogs(mockCredentials, 'group/project', '789');

      expect(result).toContain('Job 1 logs');
      expect(result).toContain('Job 2 logs');
    });
  });

  describe('listRunJobs', () => {
    it('should list jobs successfully', async () => {
      const mockJobs = [
        {
          id: 1,
          name: 'build',
          status: 'success',
          started_at: '2024-01-01T00:01:00Z',
          finished_at: '2024-01-01T00:02:00Z',
        },
        {
          id: 2,
          name: 'test',
          status: 'success',
          started_at: '2024-01-01T00:02:00Z',
          finished_at: '2024-01-01T00:03:00Z',
        },
      ];

      mockAxiosInstance.get.mockResolvedValue({ data: mockJobs });

      const result = await provider.listRunJobs(mockCredentials, 'group/project', '789');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: '1',
        name: 'build',
        status: 'completed',
        conclusion: 'success',
        startedAt: new Date('2024-01-01T00:01:00Z'),
        completedAt: new Date('2024-01-01T00:02:00Z'),
      });
    });
  });

  describe('getJobLogs', () => {
    it('should get job logs successfully', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: 'Job log content' });

      const result = await provider.getJobLogs(mockCredentials, 'group/project', '789', '1');

      expect(result).toBe('Job log content');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/projects/group%2Fproject/jobs/1/trace', {
        responseType: 'text',
      });
    });

    it('should return empty string for 404 errors', async () => {
      const error = { response: { status: 404 } } as AxiosError;

      mockAxiosInstance.get.mockRejectedValue(error);

      const result = await provider.getJobLogs(mockCredentials, 'group/project', '789', '1');

      expect(result).toBe('');
    });
  });

  describe('cancelRun', () => {
    it('should cancel pipeline successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: {} });

      await provider.cancelRun(mockCredentials, 'group/project', '789');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/projects/group%2Fproject/pipelines/789/cancel');
    });
  });
});
