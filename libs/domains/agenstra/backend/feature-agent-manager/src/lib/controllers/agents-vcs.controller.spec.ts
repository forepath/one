import { Test, TestingModule } from '@nestjs/testing';

import { CreateBranchDto } from '../dto/create-branch.dto';
import { GitBranchDto } from '../dto/git-branch.dto';
import { GitDiffDto } from '../dto/git-diff.dto';
import { GitStatusDto } from '../dto/git-status.dto';
import { PrepareCleanWorkspaceDto } from '../dto/prepare-clean-workspace.dto';
import { AgentsVcsService } from '../services/agents-vcs.service';

import { AgentsVcsController } from './agents-vcs.controller';

describe('AgentsVcsController', () => {
  let controller: AgentsVcsController;
  let service: jest.Mocked<AgentsVcsService>;
  const mockAgentId = 'test-agent-uuid';
  const mockGitStatus: GitStatusDto = {
    currentBranch: 'main',
    isClean: false,
    hasUnpushedCommits: true,
    aheadCount: 2,
    behindCount: 0,
    files: [
      {
        path: 'file1.txt',
        status: 'M',
        type: 'unstaged',
      },
    ],
  };
  const mockBranches: GitBranchDto[] = [
    {
      name: 'main',
      ref: 'refs/heads/main',
      isCurrent: true,
      isRemote: false,
      commit: 'abc123',
      message: 'Test commit',
      aheadCount: 2,
      behindCount: 0,
    },
  ];
  const mockGitDiff: GitDiffDto = {
    path: 'file1.txt',
    originalContent: Buffer.from('Old content', 'utf-8').toString('base64'),
    modifiedContent: Buffer.from('New content', 'utf-8').toString('base64'),
    encoding: 'utf-8',
    isBinary: false,
  };
  const mockService = {
    getStatus: jest.fn(),
    getBranches: jest.fn(),
    getFileDiff: jest.fn(),
    stageFiles: jest.fn(),
    unstageFiles: jest.fn(),
    commit: jest.fn(),
    push: jest.fn(),
    pull: jest.fn(),
    fetch: jest.fn(),
    prepareCleanWorkspace: jest.fn(),
    rebase: jest.fn(),
    createBranch: jest.fn(),
    switchBranch: jest.fn(),
    deleteBranch: jest.fn(),
    resolveConflict: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsVcsController],
      providers: [
        {
          provide: AgentsVcsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AgentsVcsController>(AgentsVcsController);
    service = module.get(AgentsVcsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getStatus', () => {
    it('should return git status', async () => {
      service.getStatus.mockResolvedValue(mockGitStatus);

      const result = await controller.getStatus(mockAgentId);

      expect(result).toEqual(mockGitStatus);
      expect(service.getStatus).toHaveBeenCalledWith(mockAgentId);
    });
  });

  describe('getBranches', () => {
    it('should return list of branches', async () => {
      service.getBranches.mockResolvedValue(mockBranches);

      const result = await controller.getBranches(mockAgentId);

      expect(result).toEqual(mockBranches);
      expect(service.getBranches).toHaveBeenCalledWith(mockAgentId);
    });
  });

  describe('getFileDiff', () => {
    it('should return file diff', async () => {
      const filePath = 'file1.txt';

      service.getFileDiff.mockResolvedValue(mockGitDiff);

      const result = await controller.getFileDiff(mockAgentId, filePath);

      expect(result).toEqual(mockGitDiff);
      expect(service.getFileDiff).toHaveBeenCalledWith(mockAgentId, filePath);
    });

    it('should throw error if file path is missing', async () => {
      await expect(controller.getFileDiff(mockAgentId, '')).rejects.toThrow();
    });
  });

  describe('stageFiles', () => {
    it('should stage files', async () => {
      const dto = { files: ['file1.txt'] };

      service.stageFiles.mockResolvedValue(undefined);

      await controller.stageFiles(mockAgentId, dto);

      expect(service.stageFiles).toHaveBeenCalledWith(mockAgentId, dto.files || []);
    });
  });

  describe('unstageFiles', () => {
    it('should unstage files', async () => {
      const dto = { files: ['file1.txt'] };

      service.unstageFiles.mockResolvedValue(undefined);

      await controller.unstageFiles(mockAgentId, dto);

      expect(service.unstageFiles).toHaveBeenCalledWith(mockAgentId, dto.files || []);
    });
  });

  describe('commit', () => {
    it('should commit changes', async () => {
      const dto = { message: 'Test commit' };

      service.commit.mockResolvedValue(undefined);

      await controller.commit(mockAgentId, dto);

      expect(service.commit).toHaveBeenCalledWith(mockAgentId, dto.message);
    });
  });

  describe('push', () => {
    it('should push changes', async () => {
      service.push.mockResolvedValue(undefined);

      await controller.push(mockAgentId, { force: false });

      expect(service.push).toHaveBeenCalledWith(mockAgentId, false);
    });

    it('should force push when requested', async () => {
      service.push.mockResolvedValue(undefined);

      await controller.push(mockAgentId, { force: true });

      expect(service.push).toHaveBeenCalledWith(mockAgentId, true);
    });
  });

  describe('pull', () => {
    it('should pull changes', async () => {
      service.pull.mockResolvedValue(undefined);

      await controller.pull(mockAgentId);

      expect(service.pull).toHaveBeenCalledWith(mockAgentId);
    });
  });

  describe('fetch', () => {
    it('should fetch changes', async () => {
      service.fetch.mockResolvedValue(undefined);

      await controller.fetch(mockAgentId);

      expect(service.fetch).toHaveBeenCalledWith(mockAgentId);
    });
  });

  describe('prepareCleanWorkspace', () => {
    it('should delegate to service with base branch', async () => {
      const body: PrepareCleanWorkspaceDto = { baseBranch: 'main' };

      service.prepareCleanWorkspace.mockResolvedValue(undefined);

      await controller.prepareCleanWorkspace(mockAgentId, body);

      expect(service.prepareCleanWorkspace).toHaveBeenCalledWith(mockAgentId, 'main');
    });
  });

  describe('rebase', () => {
    it('should rebase branch', async () => {
      const dto = { branch: 'main' };

      service.rebase.mockResolvedValue(undefined);

      await controller.rebase(mockAgentId, dto);

      expect(service.rebase).toHaveBeenCalledWith(mockAgentId, dto.branch);
    });
  });

  describe('createBranch', () => {
    it('should create branch', async () => {
      const dto: CreateBranchDto = {
        name: 'new-feature',
        useConventionalPrefix: true,
        conventionalType: 'feat',
      };

      service.createBranch.mockResolvedValue(undefined);

      await controller.createBranch(mockAgentId, dto);

      expect(service.createBranch).toHaveBeenCalledWith(mockAgentId, dto);
    });
  });

  describe('switchBranch', () => {
    it('should switch branch', async () => {
      const branchName = 'feature/test';

      service.switchBranch.mockResolvedValue(undefined);

      await controller.switchBranch(mockAgentId, branchName);

      expect(service.switchBranch).toHaveBeenCalledWith(mockAgentId, branchName);
    });
  });

  describe('deleteBranch', () => {
    it('should delete branch', async () => {
      const branchName = 'feature/old';

      service.deleteBranch.mockResolvedValue(undefined);

      await controller.deleteBranch(mockAgentId, branchName);

      expect(service.deleteBranch).toHaveBeenCalledWith(mockAgentId, branchName);
    });
  });

  describe('resolveConflict', () => {
    it('should resolve conflict', async () => {
      const dto = {
        path: 'conflict-file.txt',
        strategy: 'yours' as const,
      };

      service.resolveConflict.mockResolvedValue(undefined);

      await controller.resolveConflict(mockAgentId, dto);

      expect(service.resolveConflict).toHaveBeenCalledWith(mockAgentId, dto);
    });
  });
});
