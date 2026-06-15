import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { CreateBranchDto } from '../dto/create-branch.dto';
import { ResolveConflictDto } from '../dto/resolve-conflict.dto';
import { AgentEntity, ContainerType } from '../entities/agent.entity';
import { AgentsRepository } from '../repositories/agents.repository';

import { AgentFileSystemService } from './agent-file-system.service';
import { AgentGitStateBroadcastService } from './agent-git-state-broadcast.service';
import { AgentsVcsService } from './agents-vcs.service';
import { AgentsService } from './agents.service';
import { DockerService } from './docker.service';

describe('AgentsVcsService', () => {
  let service: AgentsVcsService;
  let agentsService: jest.Mocked<AgentsService>;
  let agentsRepository: jest.Mocked<AgentsRepository>;
  let dockerService: jest.Mocked<DockerService>;
  let agentFileSystemService: jest.Mocked<AgentFileSystemService>;
  const mockAgentId = 'test-agent-uuid';
  const mockContainerId = 'test-container-id';
  const mockAgentEntity: AgentEntity = {
    id: mockAgentId,
    name: 'Test Agent',
    description: 'Test Description',
    hashedPassword: 'hashed-password',
    containerId: mockContainerId,
    volumePath: '/opt/agents/test-uuid',
    agentType: 'cursor',
    containerType: ContainerType.GENERIC,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockAgentsService = {
    findOne: jest.fn(),
  };
  const mockAgentsRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const mockDockerService = {
    sendCommandToContainer: jest.fn(),
  };
  const mockAgentFileSystemService = {
    readFile: jest.fn(),
  };
  const mockGitStateBroadcast = {
    notifyGitStateMayHaveChanged: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsVcsService,
        {
          provide: AgentsService,
          useValue: mockAgentsService,
        },
        {
          provide: AgentsRepository,
          useValue: mockAgentsRepository,
        },
        {
          provide: DockerService,
          useValue: mockDockerService,
        },
        {
          provide: AgentFileSystemService,
          useValue: mockAgentFileSystemService,
        },
        {
          provide: AgentGitStateBroadcastService,
          useValue: mockGitStateBroadcast,
        },
      ],
    }).compile();

    service = module.get<AgentsVcsService>(AgentsVcsService);
    agentsService = module.get(AgentsService);
    agentsRepository = module.get(AgentsRepository);
    dockerService = module.get(DockerService);
    agentFileSystemService = module.get(AgentFileSystemService);

    // Set default environment variables
    process.env.GIT_COMMIT_AUTHOR_NAME = 'Test Author';
    process.env.GIT_COMMIT_AUTHOR_EMAIL = 'test@example.com';
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.GIT_COMMIT_AUTHOR_NAME;
    delete process.env.GIT_COMMIT_AUTHOR_EMAIL;
  });

  describe('getStatus', () => {
    it('should return git status successfully', async () => {
      const mockStatusOutput = ' M file1.txt\nA  file2.txt\n?? file3.txt';
      const mockBranchOutput = 'main';
      const mockRemoteBranchExists = 'abc123\trefs/heads/main'; // Remote branch exists
      const mockTrackingOutput = '2 1';

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer
        .mockResolvedValueOnce(mockBranchOutput) // current branch: rev-parse --abbrev-ref HEAD
        .mockResolvedValueOnce(mockRemoteBranchExists) // remote branch exists: ls-remote
        .mockResolvedValueOnce(mockTrackingOutput) // tracking info: rev-list --left-right --count
        .mockResolvedValueOnce(mockStatusOutput); // status: status --porcelain

      const result = await service.getStatus(mockAgentId);

      expect(result).toBeDefined();
      expect(result.currentBranch).toBe('main');
      expect(result.aheadCount).toBe(2);
      expect(result.behindCount).toBe(1);
      expect(result.files).toHaveLength(3);
      expect(result.files[0].path).toBe('file1.txt');
      expect(result.files[0].status).toBe(' M'); // Porcelain format includes leading space for unstaged
      expect(result.files[0].type).toBe('unstaged');
    });

    it('should handle clean repository', async () => {
      const mockBranchOutput = 'main';
      const mockRemoteBranchExists = 'abc123\trefs/heads/main'; // Remote branch exists
      const mockTrackingOutput = '0 0';
      const mockStatusOutput = '';

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer
        .mockResolvedValueOnce(mockBranchOutput) // current branch
        .mockResolvedValueOnce(mockRemoteBranchExists) // remote branch exists
        .mockResolvedValueOnce(mockTrackingOutput) // tracking info
        .mockResolvedValueOnce(mockStatusOutput); // status

      const result = await service.getStatus(mockAgentId);

      expect(result.isClean).toBe(true);
      expect(result.files).toHaveLength(0);
    });

    it('should throw NotFoundException if agent has no container', async () => {
      const agentWithoutContainer = { ...mockAgentEntity, containerId: null };

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(agentWithoutContainer as any);

      await expect(service.getStatus(mockAgentId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getBranches', () => {
    it('should return list of branches', async () => {
      const mockCurrentBranch = 'main';
      const mockLocalBranches = `* main
  feature/test`;
      const mockRemoteBranches = `  remotes/origin/main
  remotes/origin/feature/test`;
      const mockCommitOutput = 'abc123|Test commit';

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer
        .mockResolvedValueOnce(mockCurrentBranch) // rev-parse --abbrev-ref HEAD
        .mockResolvedValueOnce(mockLocalBranches) // branch
        .mockResolvedValueOnce(mockRemoteBranches) // branch -r
        .mockResolvedValueOnce(mockCommitOutput) // log for main branch
        .mockResolvedValueOnce('') // ls-remote for main (no remote)
        .mockResolvedValueOnce(mockCommitOutput) // log for feature/test branch
        .mockResolvedValueOnce(''); // ls-remote for feature/test (no remote)

      const result = await service.getBranches(mockAgentId);

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((b) => b.name === 'main' && b.isCurrent)).toBe(true);
    });

    it('should filter out branches with invalid characters', async () => {
      const mockCurrentBranch = 'main';
      const mockLocalBranches = `* main
  \`invalid-branch
  feature/test
  branch.with..dots
  branch.ending.
  .branch-starting-with-dot`;
      const mockRemoteBranches = `  remotes/origin/main
  remotes/origin/feature/test`;
      const mockCommitOutput = 'abc123|Test commit';

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer
        .mockResolvedValueOnce(mockCurrentBranch) // rev-parse --abbrev-ref HEAD
        .mockResolvedValueOnce(mockLocalBranches) // branch
        .mockResolvedValueOnce(mockRemoteBranches) // branch -r
        .mockResolvedValueOnce(mockCommitOutput) // log for main branch
        .mockResolvedValueOnce('') // ls-remote for main (no remote)
        .mockResolvedValueOnce(mockCommitOutput) // log for feature/test branch
        .mockResolvedValueOnce(''); // ls-remote for feature/test (no remote)

      const result = await service.getBranches(mockAgentId);

      expect(result).toBeDefined();
      // Should only contain valid branches: main and feature/test
      // Invalid branches (with backticks, double dots, ending with dot, starting with dot) should be filtered out
      expect(result.length).toBe(2);
      expect(result.some((b) => b.name === 'main' && b.isCurrent)).toBe(true);
      expect(result.some((b) => b.name === 'feature/test' && !b.isCurrent)).toBe(true);
      // Invalid branches should be filtered out
      expect(result.some((b) => b.name.startsWith('`'))).toBe(false);
      expect(result.some((b) => b.name.includes('..'))).toBe(false);
      expect(result.some((b) => b.name.endsWith('.'))).toBe(false);
      expect(result.some((b) => b.name.startsWith('.'))).toBe(false);
      // Verify all returned branches are valid
      result.forEach((branch) => {
        expect(branch.name).toMatch(/^[a-zA-Z0-9._\-/]+$/);
        expect(branch.name).not.toMatch(/^\./); // Not starting with dot
        expect(branch.name).not.toMatch(/\.\./); // Not containing double dots
        expect(branch.name).not.toMatch(/\.$/); // Not ending with dot
      });
    });
  });

  describe('getFileDiff', () => {
    it('should return file diff for text file', async () => {
      const filePath = 'test-file.txt';
      const mockOriginalContent = 'Old content\nline 2\nline 3';
      const mockModifiedContent = Buffer.from('New content\nline 2\nline 3', 'utf-8').toString('base64');

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      // Mock isBinaryFile check (check-attr returns empty, so not binary)
      dockerService.sendCommandToContainer.mockResolvedValueOnce(''); // check-attr returns empty (not binary)
      // Mock original content from HEAD (show HEAD:file)
      dockerService.sendCommandToContainer.mockResolvedValueOnce(mockOriginalContent);
      // Mock readFile from agentFileSystemService
      agentFileSystemService.readFile.mockResolvedValue({
        content: mockModifiedContent,
        encoding: 'utf-8',
        isBinary: false,
      } as any);

      const result = await service.getFileDiff(mockAgentId, filePath);

      expect(result).toBeDefined();
      expect(result.path).toBe(filePath);
      expect(result.isBinary).toBe(false);
      expect(result.encoding).toBe('utf-8');
      expect(agentFileSystemService.readFile).toHaveBeenCalledWith(mockAgentId, filePath);
    });

    it('should handle binary files', async () => {
      const filePath = 'image.png';

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      // Mock isBinaryFile check (check-attr returns "binary: set")
      dockerService.sendCommandToContainer.mockResolvedValueOnce('binary: set'); // check-attr returns binary
      // Mock getFileSize for HEAD (cat-file -s)
      dockerService.sendCommandToContainer.mockResolvedValueOnce('1024'); // original size
      // Mock getFileSize for WORKING (stat -c %s)
      dockerService.sendCommandToContainer.mockResolvedValueOnce('2048'); // modified size

      const result = await service.getFileDiff(mockAgentId, filePath);

      expect(result.isBinary).toBe(true);
      expect(result.encoding).toBe('base64');
      expect(result.originalSize).toBe(1024);
      expect(result.modifiedSize).toBe(2048);
    });
  });

  describe('stageFiles', () => {
    it('should stage specific files', async () => {
      const files = ['file1.txt', 'file2.txt'];

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.stageFiles(mockAgentId, files);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('git add'),
        undefined,
        false,
      );
      expect(mockGitStateBroadcast.notifyGitStateMayHaveChanged).toHaveBeenCalledWith(mockAgentId);
    });

    it('should stage all files when empty array provided', async () => {
      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.stageFiles(mockAgentId, []);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('git add -A'),
        undefined,
        false,
      );
    });
  });

  describe('unstageFiles', () => {
    it('should unstage specific files', async () => {
      const files = ['file1.txt'];

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.unstageFiles(mockAgentId, files);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('git reset'),
        undefined,
        false,
      );
    });
  });

  describe('commit', () => {
    it('should commit with message and author config', async () => {
      const message = 'Test commit message';

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.commit(mockAgentId, message);

      // The commit command includes all config in a single call
      // Find the commit call and verify it contains the message and author config
      const commitCall = dockerService.sendCommandToContainer.mock.calls.find((call) => call[1].includes('commit'));

      expect(commitCall).toBeDefined();
      expect(commitCall[0]).toBe(mockContainerId);
      expect(commitCall[1]).toContain('commit');
      expect(commitCall[1]).toContain(message);
      expect(commitCall[2]).toBeUndefined();
      expect(commitCall[3]).toBe(false);
      // Verify author config is present (either from env vars or defaults)
      expect(commitCall[1]).toMatch(/user\.name/);
      expect(commitCall[1]).toMatch(/user\.email/);
    });
  });

  describe('push', () => {
    it('should push changes to remote', async () => {
      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer
        .mockResolvedValueOnce('main') // rev-parse --abbrev-ref HEAD
        .mockResolvedValueOnce('') // ls-remote (no remote branch)
        .mockResolvedValueOnce(''); // push command

      await service.push(mockAgentId);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('git push -u origin main'),
        undefined,
        true, // checkExitCode=true
      );
    });

    it('should force push using --force-with-lease when requested', async () => {
      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer
        .mockResolvedValueOnce('main') // rev-parse --abbrev-ref HEAD
        .mockResolvedValueOnce('refs/heads/main') // ls-remote (remote branch exists)
        .mockResolvedValueOnce(''); // push command

      await service.push(mockAgentId, true);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('git push --force-with-lease origin main'),
        undefined,
        true,
      );
    });
  });

  describe('pull', () => {
    it('should pull changes from remote', async () => {
      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer
        .mockResolvedValueOnce('main') // rev-parse --abbrev-ref HEAD
        .mockResolvedValueOnce(''); // pull command

      await service.pull(mockAgentId);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('git pull'),
        undefined,
        true, // checkExitCode=true
      );
    });
  });

  describe('fetch', () => {
    it('should fetch changes from remote', async () => {
      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.fetch(mockAgentId);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('git fetch'),
        undefined,
        true, // checkExitCode=true
      );
    });
  });

  describe('createBranch', () => {
    it('should create branch with conventional prefix', async () => {
      const dto: CreateBranchDto = {
        name: 'new-feature',
        useConventionalPrefix: true,
        conventionalType: 'feat',
      };

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.createBranch(mockAgentId, dto);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('feat/new-feature'),
        undefined,
        false,
      );
    });

    it('should create branch without prefix when disabled', async () => {
      const dto: CreateBranchDto = {
        name: 'custom-branch',
        useConventionalPrefix: false,
      };

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.createBranch(mockAgentId, dto);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('custom-branch'),
        undefined,
        false,
      );
    });
  });

  describe('switchBranch', () => {
    it('should switch to branch', async () => {
      const branchName = 'feature/test';

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.switchBranch(mockAgentId, branchName);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining(`git checkout ${branchName}`),
        undefined,
        false,
      );
    });
  });

  describe('deleteBranch', () => {
    it('should delete branch', async () => {
      const branchName = 'feature/old';

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer
        .mockResolvedValueOnce('main') // rev-parse --abbrev-ref HEAD (to check if it's current branch)
        .mockResolvedValueOnce(''); // branch -D command

      await service.deleteBranch(mockAgentId, branchName);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining(`git branch -D ${branchName}`),
        undefined,
        false,
      );
    });
  });

  describe('rebase', () => {
    it('should rebase onto branch', async () => {
      const branchName = 'main';

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.rebase(mockAgentId, branchName);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining(`git rebase ${branchName}`),
        undefined,
        false,
      );
    });
  });

  describe('resolveConflict', () => {
    it('should resolve conflict with "yours" strategy', async () => {
      const dto: ResolveConflictDto = {
        path: 'conflict-file.txt',
        strategy: 'yours',
      };

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer
        .mockResolvedValueOnce('') // checkout --theirs
        .mockResolvedValueOnce(''); // add

      await service.resolveConflict(mockAgentId, dto);

      // Check that --theirs was called (first call)
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        1,
        mockContainerId,
        expect.stringContaining('--theirs'),
        undefined,
        false,
      );
    });

    it('should resolve conflict with "mine" strategy', async () => {
      const dto: ResolveConflictDto = {
        path: 'conflict-file.txt',
        strategy: 'mine',
      };

      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer
        .mockResolvedValueOnce('') // checkout --ours
        .mockResolvedValueOnce(''); // add

      await service.resolveConflict(mockAgentId, dto);

      // Check that --ours was called (first call)
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        1,
        mockContainerId,
        expect.stringContaining('--ours'),
        undefined,
        false,
      );
    });
  });

  describe('prepareCleanWorkspace', () => {
    it('should fetch, checkout, reset, and clean', async () => {
      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');

      await service.prepareCleanWorkspace(mockAgentId, 'main');

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(4);
    });

    it('should reject invalid branch names', async () => {
      agentsService.findOne.mockResolvedValue({} as any);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      await expect(service.prepareCleanWorkspace(mockAgentId, 'bad;branch')).rejects.toThrow();
    });
  });
});
